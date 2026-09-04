<?php

namespace Drupal\asu_createai_provider\Plugin\AiProvider;

use Drupal\Component\Serialization\Json;
use Drupal\Core\Config\ImmutableConfig;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
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
 * `model: "defaults"` and exposes a single synthetic model ID
 * (createai_project_default) for the AI module's model-selection UI.
 */
#[AiProvider(
  id: 'createai',
  label: new TranslatableMarkup('CreateAI'),
)]
class CreateAiProvider extends AiProviderClientBase implements ContainerFactoryPluginInterface, ChatInterface {

  /**
   * The single synthetic model ID exposed by this provider.
   */
  public const DEFAULT_MODEL_ID = 'createai_project_default';

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
    return [self::DEFAULT_MODEL_ID => 'CreateAI project default'];
  }

  /**
   * {@inheritdoc}
   */
  public function isUsable(?string $operation_type = NULL, array $capabilities = []): bool {
    $config = $this->getConfig();
    if (!$config->get('endpoint_url') || !$config->get('api_key')) {
      return FALSE;
    }
    $declared = $config->get('capabilities') ?? [];
    if (empty($declared['chat']) && empty($declared['chat_with_rag'])) {
      return FALSE;
    }
    if ($operation_type !== NULL) {
      return in_array($operation_type, $this->getSupportedOperationTypes(), TRUE);
    }
    return TRUE;
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
    if (!$this->apiKey) {
      $this->setAuthentication($this->loadApiKey());
    }

    $messages = $this->normalizeMessages($input);
    $streamed = $input instanceof ChatInput && $input->isStreamedOutput();

    $payload = [
      'model' => 'defaults',
      'messages' => $messages,
      'stream' => $streamed,
    ] + $this->configuration;

    $headers = $this->buildHeaders();
    $url = $this->getBaseUrl() . '/chat/completions';

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

    if ($content === '') {
      // See §6.6 of the CreateAI implementation plan: a token/environment
      // mismatch returns HTTP 200 with empty content instead of an auth
      // error. Log distinctly so support can spot this quickly.
      $this->loggerFactory->get('asu_createai_provider')->warning(
        'CreateAI returned an empty chat response for endpoint @url. This usually indicates the configured service token environment does not match the endpoint URL.',
        ['@url' => $this->getConfig()->get('endpoint_url')]
      );
    }

    $message = new ChatMessage($data['choices'][0]['message']['role'] ?? 'assistant', $content);
    $output = new ChatOutput($message, $data, []);

    $rate_limits = $this->extractRateLimits($response->getHeaders());
    if ($rate_limits && !$rate_limits->empty()) {
      $output->setRateLimits($rate_limits);
    }

    return $output;
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
      $messages[] = [
        'role' => $role,
        'content' => $message->getText(),
      ];
    }
    return $messages;
  }

  /**
   * Builds the request headers, including CreateAI's optional headers.
   */
  protected function buildHeaders(): array {
    $config = $this->getConfig();
    $headers = [
      'Authorization' => 'Bearer ' . $this->apiKey,
      'Content-Type' => 'application/json',
    ];
    if ($config->get('enable_search')) {
      $headers['enable_search'] = 'true';
    }
    if ($config->get('enable_history')) {
      $headers['enable_history'] = 'true';
      $headers['session_id'] = $this->buildSessionCorrelationId();
    }
    return $headers;
  }

  /**
   * Builds an opaque, non-reversible per-session correlation ID.
   *
   * CreateAI's session_id header only needs to correlate turns within a
   * conversation; it must never be the real Drupal session ID, since that
   * value is bearer credential material for the visitor's session and
   * could be replayed if disclosed (e.g. via CreateAI logs or monitoring).
   * HMAC-ing it with Drupal's private key yields a stable, provider-scoped
   * ID that cannot be used to reconstruct or replay the original session.
   */
  protected function buildSessionCorrelationId(): string {
    $session_id = $this->session->getId() ?: $this->session->start();
    return hash_hmac('sha256', $session_id, $this->privateKey->get());
  }

  /**
   * Returns the normalized OpenAI-compatible base URL (always ends /v1).
   *
   * @throws \Drupal\ai\Exception\AiSetupFailureException
   *   If the configured endpoint is not a recognized CreateAI host.
   */
  protected function getBaseUrl(): string {
    try {
      return self::normalizeEndpoint((string) $this->getConfig()->get('endpoint_url'));
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
