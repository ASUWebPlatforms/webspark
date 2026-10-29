<?php

namespace Drupal\asu_createai_provider\Plugin\AiProvider;

use Drupal\Component\Serialization\Json;
use Drupal\Core\Config\ImmutableConfig;
use Drupal\Core\StringTranslation\TranslatableMarkup;
use Drupal\ai\Attribute\AiProvider;
use Drupal\ai\Base\AiProviderClientBase;
use Drupal\ai\Dto\ChatProviderLimitsDto;
use Drupal\ai\Enum\AiProviderCapability;
use Drupal\ai\Exception\AiRateLimitException;
use Drupal\ai\Exception\AiResponseErrorException;
use Drupal\ai\Exception\AiSetupFailureException;
use Drupal\ai\OperationType\Chat\ChatInput;
use Drupal\ai\OperationType\Chat\ChatInterface;
use Drupal\ai\OperationType\Chat\ChatMessage;
use Drupal\ai\OperationType\Chat\ChatOutput;
use Drupal\ai\OperationType\Chat\Tools\ToolsFunctionOutput;
use Drupal\asu_createai_provider\CreateAiChatMessageIterator;
use Drupal\Core\PrivateKey;
use GuzzleHttp\Exception\GuzzleException;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Session\SessionInterface;
use Symfony\Component\Yaml\Yaml;

/**
 * Plugin implementation of the 'createai' AI provider.
 *
 * CreateAI (ASU AIML) exposes an OpenAI-compatible API. A CreateAI Service
 * Token resolves the model server-side, so this provider always sends
 * `model: "defaults"` and exposes one synthetic model ID per configured
 * agent (a Service Token + endpoint pair), letting a site configure
 * several distinct CreateAI projects/chatbots and pick between them per
 * consumer (e.g. a different agent for ai_ckeditor than for ai_agents).
 * Whichever agent is marked as the site's default_agent is additionally
 * exposed under the legacy DEFAULT_MODEL_ID, so config saved before
 * multi-agent support existed keeps resolving correctly.
 */
#[AiProvider(
  id: 'createai',
  label: new TranslatableMarkup('CreateAI'),
)]
class CreateAiProvider extends AiProviderClientBase implements ChatInterface {

  /**
   * The legacy synthetic model ID for whichever agent is the site default.
   */
  public const DEFAULT_MODEL_ID = 'createai_project_default';

  /**
   * Model ID prefix for every non-default configured agent.
   */
  public const AGENT_MODEL_PREFIX = 'agent_';

  /**
   * The only documented CreateAI OpenAI-compatible hostnames.
   *
   * A loose substring check (e.g. "contains api-main") would let an
   * endpoint such as https://evil.example.com/api-main pass validation and
   * send the service token to an attacker-controlled host, so requests are
   * only ever sent to one of these exact hosts.
   */
  private const ALLOWED_HOSTS = [
    'api-main.aiml.asu.edu',
    'api-main-poc.aiml.asu.edu',
    'api-main-beta.aiml.asu.edu',
  ];

  /**
   * The CreateAI service token, once loaded.
   *
   * @var string
   */
  protected string $apiKey = '';

  /**
   * The session service, used to build a stable session_id header.
   *
   * @var \Symfony\Component\HttpFoundation\Session\SessionInterface
   */
  protected SessionInterface $session;

  /**
   * The private key service, used to derive an opaque session correlation ID.
   *
   * @var \Drupal\Core\PrivateKey
   */
  protected PrivateKey $privateKey;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    $instance = parent::create($container, $configuration, $plugin_id, $plugin_definition);
    $instance->session = $container->get('session');
    $instance->privateKey = $container->get('private_key');
    return $instance;
  }

  /**
   * Validates and normalizes a CreateAI endpoint URL.
   *
   * Only exact, documented CreateAI hostnames over HTTPS are accepted.
   * This parses the URL and compares components exactly, rather than a
   * substring match, to prevent SSRF and service-token disclosure to an
   * unintended host.
   *
   * @param string $endpoint
   *   The endpoint URL as entered by the site builder.
   *
   * @return string
   *   The normalized base URL, always in the form https://<host>/v1.
   *
   * @throws \InvalidArgumentException
   *   If the endpoint is not one of the documented CreateAI hosts.
   */
  public static function normalizeEndpoint(string $endpoint): string {
    $parts = parse_url(trim($endpoint));
    $host = strtolower($parts['host'] ?? '');
    $path = isset($parts['path']) ? rtrim($parts['path'], '/') : '';

    if (
      $parts === FALSE
      || ($parts['scheme'] ?? '') !== 'https'
      || !in_array($host, self::ALLOWED_HOSTS, TRUE)
      || isset($parts['user']) || isset($parts['pass'])
      || (isset($parts['port']) && (int) $parts['port'] !== 443)
      || !in_array($path, ['', '/v1'], TRUE)
      || isset($parts['query']) || isset($parts['fragment'])
    ) {
      throw new \InvalidArgumentException(sprintf(
        'Invalid CreateAI endpoint "%s". It must be https://<host>/v1 where <host> is one of: %s.',
        $endpoint,
        implode(', ', self::ALLOWED_HOSTS)
      ));
    }

    return "https://{$host}/v1";
  }

  /**
   * {@inheritdoc}
   */
  public function getConfiguredModels(?string $operation_type = NULL, array $capabilities = []): array {
    if ($operation_type !== NULL && !in_array($operation_type, $this->getSupportedOperationTypes(), TRUE)) {
      return [];
    }
    if (!$this->supportsRequestedCapabilities($capabilities)) {
      return [];
    }
    $models = [];
    foreach ($this->getAgentDefinitions() as $model_id => $agent) {
      $models[$model_id] = $agent['label'];
    }
    return $models;
  }

  /**
   * {@inheritdoc}
   */
  public function isUsable(?string $operation_type = NULL, array $capabilities = []): bool {
    if ($operation_type !== NULL && !in_array($operation_type, $this->getSupportedOperationTypes(), TRUE)) {
      return FALSE;
    }
    if (!$this->supportsRequestedCapabilities($capabilities)) {
      return FALSE;
    }
    // Usable as long as at least one configured agent is complete; a site
    // that has only set up an additional agent (and left the legacy default
    // agent blank) must not be treated as fully unconfigured.
    return $this->getAgentDefinitions() !== [];
  }

  /**
   * Checks the requested framework capabilities against what this provider supports.
   *
   * Support is identical for every configured agent.
   */
  protected function supportsRequestedCapabilities(array $capabilities): bool {
    if (!$capabilities) {
      return TRUE;
    }
    $supported = array_map(
      static fn (AiProviderCapability $capability): string => $capability->value,
      $this->getSupportedCapabilities()
    );
    // Callers may pass capability enums other than AiProviderCapability (e.g.
    // AiModelCapability). Casting a backed enum with (string) throws a fatal
    // Error rather than returning a value, so check for \BackedEnum broadly
    // instead of only the one enum type this provider itself declares.
    $requested = array_map(
      static fn ($capability): string => $capability instanceof \BackedEnum ? $capability->value : (string) $capability,
      $capabilities
    );
    return !array_diff($requested, $supported);
  }

  /**
   * Builds the complete, ready-to-use agent definitions, keyed by model ID.
   *
   * An agent is only included if it has both an endpoint URL and a Service
   * Token key, and has declared at least one capability — the same
   * completeness gate the single-agent version of isUsable() used to
   * apply. The agent whose 'id' matches the configured default_agent is
   * keyed under the legacy DEFAULT_MODEL_ID so config saved before
   * multi-agent support existed (e.g. ai.settings.default_providers,
   * ai_ckeditor's per-feature 'provider' selections) keeps resolving to
   * whichever agent is currently marked default. Every other agent is
   * keyed 'agent_<id>'.
   *
   * @return array<string, array{id: string, label: string, endpoint_url: string, api_key: string, enable_search: bool, enable_history: bool}>
   *   Agent definitions keyed by model ID.
   */
  protected function getAgentDefinitions(): array {
    $config = $this->getConfig();
    $default_agent_id = (string) ($config->get('default_agent') ?? '');

    $definitions = [];
    foreach ((array) ($config->get('agents') ?? []) as $agent) {
      $id = (string) ($agent['id'] ?? '');
      if ($id === '' || empty($agent['endpoint_url']) || empty($agent['api_key'])) {
        continue;
      }
      $declared = $agent['capabilities'] ?? [];
      if (empty($declared['chat']) && empty($declared['chat_with_rag'])) {
        continue;
      }
      $model_id = $id === $default_agent_id ? self::DEFAULT_MODEL_ID : self::AGENT_MODEL_PREFIX . $id;
      $definitions[$model_id] = [
        'id' => $id,
        'label' => (string) ($agent['label'] ?? $id),
        'endpoint_url' => (string) $agent['endpoint_url'],
        'api_key' => (string) $agent['api_key'],
        'enable_search' => !empty($agent['enable_search']),
        'enable_history' => !empty($agent['enable_history']),
      ];
    }
    return $definitions;
  }

  /**
   * Resolves one agent's full definition by model ID.
   *
   * @throws \Drupal\ai\Exception\AiSetupFailureException
   *   If no complete, configured agent matches the given model ID.
   */
  protected function resolveAgent(string $model_id): array {
    $agents = $this->getAgentDefinitions();
    if (!isset($agents[$model_id])) {
      throw new AiSetupFailureException(sprintf(
        'CreateAI agent for model "%s" is not configured, or is missing an endpoint URL, Service Token, or declared capability.',
        $model_id,
      ));
    }
    return $agents[$model_id];
  }

  /**
   * {@inheritdoc}
   */
  public function getSupportedOperationTypes(): array {
    return ['chat'];
  }

  /**
   * {@inheritdoc}
   */
  public function getSupportedCapabilities(): array {
    return [
      AiProviderCapability::StreamChatOutput,
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getConfig(): ImmutableConfig {
    return $this->configFactory->get('asu_createai_provider.settings');
  }

  /**
   * {@inheritdoc}
   */
  public function getApiDefinition(): array {
    $module_path = $this->moduleHandler->getModule('asu_createai_provider')->getPath();
    return Yaml::parseFile($module_path . '/definitions/api_defaults.yml');
  }

  /**
   * {@inheritdoc}
   */
  public function getModelSettings(string $model_id, array $generalConfig = []): array {
    return $generalConfig;
  }

  /**
   * {@inheritdoc}
   */
  public function setAuthentication(mixed $authentication): void {
    $this->apiKey = (string) $authentication;
  }

  /**
   * {@inheritdoc}
   */
  public function getMaxInputTokens(string $model_id): int {
    return 128000;
  }

  /**
   * {@inheritdoc}
   */
  public function getMaxOutputTokens(string $model_id): int {
    return (int) ($this->configuration['max_tokens'] ?? 1024);
  }

  /**
   * {@inheritdoc}
   */
  public function chat(array|string|ChatInput $input, string $model_id, array $tags = []): ChatOutput {
    // Everything, including agent resolution, is inside the try/finally: if
    // resolveAgent() throws (e.g. an invalid model_id) while a runtime
    // authentication override from a PRIOR call is still sitting in
    // $this->apiKey, the finally block must still clear it — otherwise that
    // stale token would leak into the NEXT chat() call on this same plugin
    // instance, possibly for a different agent.
    try {
      $agent = $this->resolveAgent($model_id);

      // Only resolve+set the token from config if nothing has already set
      // one for this call. ProviderProxy's PreGenerateResponseEvent can
      // call setAuthentication() with a caller-supplied override just
      // before invoking chat(), and that override must win.
      if ($this->apiKey === '') {
        $key = $this->keyRepository->getKey($agent['api_key'])?->getKeyValue();
        if (!$key) {
          throw new AiSetupFailureException(sprintf(
            'Could not load the CreateAI Service Token for agent "%s", please check its Key configuration.',
            $agent['id'],
          ));
        }
        $this->setAuthentication($key);
      }

      $messages = $this->normalizeMessages($input);
      $streamed = $input instanceof ChatInput && $input->isStreamedOutput();

      $payload = [
        'model' => 'defaults',
        'messages' => $messages,
        'stream' => $streamed,
      ] + $this->configuration;

      // Forward ai_agents'/any consumer's tool definitions in CreateAI's
      // OpenAI-compatible 'tools' shape, same contract ai_provider_openai
      // uses. Untested against CreateAI's actual backend support for this —
      // it advertises OpenAI compatibility for /v1/chat/completions, but
      // whether tool calling specifically is honored is unverified.
      if ($input instanceof ChatInput && $input->getChatTools()) {
        $payload['tools'] = $input->getChatTools()->renderToolsArray();
      }

      $headers = $this->buildHeaders($agent);
      $url = $this->getBaseUrl($agent['endpoint_url']) . '/chat/completions';

      // The http_client_factory service always returns a concrete Guzzle
      // client, but the parent class only type-hints the PSR-18 interface
      // (which lacks ->request()), so annotate the concrete type here.
      /** @var \GuzzleHttp\ClientInterface $client */
      $client = $this->httpClient;

      if ($streamed) {
        try {
          $response = $client->request('POST', $url, [
            'headers' => $headers,
            'json' => $payload,
            'stream' => TRUE,
            'allow_redirects' => FALSE,
          ]);
        }
        catch (GuzzleException $e) {
          throw new AiResponseErrorException($e->getMessage());
        }

        // Known gap: CreateAiChatMessageIterator only reads delta.content and
        // never reads/accumulates delta.tool_calls, so a streamed response
        // that requests a tool call is silently dropped (no error, tool call
        // just never surfaces). Tool calling is only supported on the
        // non-streamed path below. Use non-streamed chat for any ai_agents-
        // driven request until the iterator is updated to accumulate
        // tool_calls deltas the way core's OpenAiTypeStreamedChatMessageIterator does.
        $iterator = new CreateAiChatMessageIterator($this->sseChunks($response->getBody()));
        $iterator->setProviderId('createai');
        $iterator->setModelId($model_id);
        $iterator->setTags($tags);
        return new ChatOutput($iterator, [], []);
      }

      try {
        $response = $client->request('POST', $url, [
          'headers' => $headers,
          'json' => $payload,
          'allow_redirects' => FALSE,
        ]);
      }
      catch (GuzzleException $e) {
        if (stripos($e->getMessage(), 'Too Many Requests') !== FALSE) {
          throw new AiRateLimitException($e->getMessage());
        }
        throw new AiResponseErrorException($e->getMessage());
      }

      $data = Json::decode((string) $response->getBody());
      $content = $data['choices'][0]['message']['content'] ?? '';
      $tool_calls = $data['choices'][0]['message']['tool_calls'] ?? [];

      if ($content === '' && empty($tool_calls)) {
        // See §6.6 of the CreateAI implementation plan: a token/environment
        // mismatch returns HTTP 200 with empty content instead of an auth
        // error. Log distinctly so support can spot this quickly. Skipped
        // when tool_calls are present: a pure tool-call turn legitimately has
        // empty content per the OpenAI-compatible convention, that's not a
        // token/environment mismatch.
        $this->loggerFactory->get('asu_createai_provider')->warning(
          'CreateAI returned an empty chat response for agent @agent (endpoint @url). This usually indicates the configured service token environment does not match the endpoint URL.',
          ['@agent' => $agent['id'], '@url' => $agent['endpoint_url']]
        );
      }

      $message = new ChatMessage($data['choices'][0]['message']['role'] ?? 'assistant', $content);

      // Parse any tool calls the model requested, so ai_agents/ai_automators
      // can execute the matching FunctionCallInterface plugin(s).
      if ($input instanceof ChatInput && $input->getChatTools() && !empty($tool_calls)) {
        $tools = [];
        foreach ($tool_calls as $tool_call) {
          // Defensive: CreateAI's tool-calling response shape is untested
          // against a real endpoint. Constructing ToolsFunctionOutput with a
          // NULL/missing argument array or empty name throws an uncaught
          // TypeError (its parameters are non-nullable) that ai_agents'
          // catch (\Exception $e) does not catch, since TypeError extends
          // \Error — fall back to safe defaults instead of crashing the
          // whole agent run over one malformed tool call.
          $raw_arguments = $tool_call['function']['arguments'] ?? '{}';
          $arguments = Json::decode($raw_arguments);
          if (!is_array($arguments)) {
            $arguments = [];
          }
          $name = $tool_call['function']['name'] ?? '';
          $function = $name !== '' ? $input->getChatTools()->getFunctionByName($name) : NULL;
          $tools[] = new ToolsFunctionOutput($function, (string) ($tool_call['id'] ?? ''), $arguments);
        }
        $message->setTools($tools);
      }

      $output = new ChatOutput($message, $data, []);

      $rate_limits = $this->extractRateLimits($response->getHeaders());
      if ($rate_limits && !$rate_limits->empty()) {
        $output->setRateLimits($rate_limits);
      }

      return $output;
    }
    finally {
      // Never let this call's resolved token leak into the next chat() call
      // on this same plugin instance, which may target a different agent.
      $this->apiKey = '';
    }
  }

  /**
   * Normalizes AI module chat input into an OpenAI-style messages array.
   */
  protected function normalizeMessages(array|string|ChatInput $input): array {
    if (!($input instanceof ChatInput)) {
      return is_array($input) ? $input : [['role' => 'user', 'content' => (string) $input]];
    }

    $messages = [];
    if ($input->getSystemPrompt()) {
      $messages[] = [
        'role' => 'system',
        'content' => $input->getSystemPrompt(),
      ];
    }
    foreach ($input->getMessages() as $message) {
      $role = $message->getRole();
      if ($role === 'model') {
        $role = 'assistant';
      }
      $new_message = [
        'role' => $role,
        'content' => $message->getText(),
      ];
      // A message that IS a tool's result (sent back to the model after we
      // executed a function it asked for).
      if ($message->getToolsId()) {
        $new_message['tool_call_id'] = $message->getToolsId();
      }
      // A prior assistant message that itself requested tool calls.
      if ($message->getTools()) {
        $new_message['tool_calls'] = $message->getRenderedTools();
      }
      $messages[] = $new_message;
    }
    return $messages;
  }

  /**
   * Builds the request headers, including CreateAI's optional headers.
   *
   * @param array $agent
   *   The resolved agent definition from getAgentDefinitions().
   */
  protected function buildHeaders(array $agent): array {
    $headers = [
      'Authorization' => 'Bearer ' . $this->apiKey,
      'Content-Type' => 'application/json',
    ];
    if ($agent['enable_search']) {
      $headers['enable_search'] = 'true';
    }
    if ($agent['enable_history']) {
      $headers['enable_history'] = 'true';
      $headers['session_id'] = $this->buildSessionCorrelationId($agent['id']);
    }
    return $headers;
  }

  /**
   * Builds an opaque, non-reversible per-session, per-agent correlation ID.
   *
   * CreateAI's session_id header only needs to correlate turns within a
   * conversation; it must never be the real Drupal session ID, since that
   * value is bearer credential material for the visitor's session and
   * could be replayed if disclosed (e.g. via CreateAI logs or monitoring).
   * HMAC-ing it with Drupal's private key yields a stable, provider-scoped
   * ID that cannot be used to reconstruct or replay the original session.
   * The agent ID is mixed into the HMAC input so two different agents used
   * in the same Drupal session get distinct session_id values — otherwise
   * CreateAI could correlate a visitor's history across two unrelated
   * CreateAI projects/agents.
   *
   * @param string $agent_id
   *   The resolved agent's machine name.
   */
  protected function buildSessionCorrelationId(string $agent_id): string {
    // SessionInterface::start() returns bool, not the new session ID — it
    // must never be assigned to $session_id directly, or every anonymous
    // visitor without an existing session would collapse onto the same
    // literal "1" correlation ID.
    if (!$this->session->isStarted()) {
      $this->session->start();
    }
    $session_id = $this->session->getId();
    return hash_hmac('sha256', $agent_id . ':' . $session_id, $this->privateKey->get());
  }

  /**
   * Returns the normalized OpenAI-compatible base URL (always ends /v1).
   *
   * @param string $endpoint_url
   *   The resolved agent's endpoint URL.
   *
   * @throws \Drupal\ai\Exception\AiSetupFailureException
   *   If the configured endpoint is not a recognized CreateAI host.
   */
  protected function getBaseUrl(string $endpoint_url): string {
    try {
      return self::normalizeEndpoint($endpoint_url);
    }
    catch (\InvalidArgumentException $e) {
      throw new AiSetupFailureException($e->getMessage());
    }
  }

  /**
   * Parses a streamed HTTP body of Server-Sent Events into decoded chunks.
   *
   * @param \Psr\Http\Message\StreamInterface $body
   *   The streamed response body.
   *
   * @return \Generator
   *   A generator of decoded JSON chunks from `data:` lines.
   */
  protected function sseChunks($body): \Generator {
    $buffer = '';
    while (!$body->eof()) {
      $buffer .= $body->read(1024);
      while (($pos = strpos($buffer, "\n\n")) !== FALSE) {
        $event = substr($buffer, 0, $pos);
        $buffer = substr($buffer, $pos + 2);
        foreach (explode("\n", $event) as $line) {
          if (!str_starts_with($line, 'data:')) {
            continue;
          }
          $data = trim(substr($line, 5));
          if ($data === '[DONE]' || $data === '') {
            continue;
          }
          $decoded = json_decode($data, TRUE);
          if (is_array($decoded)) {
            yield $decoded;
          }
        }
      }
    }
  }

  /**
   * Builds a rate limit DTO from response headers, if CreateAI sends them.
   */
  protected function extractRateLimits(array $headers): ?ChatProviderLimitsDto {
    $get = static function (array $headers, string $name): ?int {
      foreach ($headers as $key => $values) {
        if (strcasecmp($key, $name) === 0 && !empty($values)) {
          return (int) reset($values);
        }
      }
      return NULL;
    };

    $limits = new ChatProviderLimitsDto(
      rateLimitMaxRequests: $get($headers, 'X-RateLimit-Limit-Requests'),
      rateLimitMaxTokens: $get($headers, 'X-RateLimit-Limit-Tokens'),
      rateLimitRemainingRequests: $get($headers, 'X-RateLimit-Remaining-Requests'),
      rateLimitRemainingTokens: $get($headers, 'X-RateLimit-Remaining-Tokens'),
      rateLimitResetRequests: $get($headers, 'X-RateLimit-Reset-Requests'),
      rateLimitResetTokens: $get($headers, 'X-RateLimit-Reset-Tokens'),
    );

    return $limits->empty() ? NULL : $limits;
  }

}
