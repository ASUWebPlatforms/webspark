<?php

namespace Drupal\asu_createai_provider\Form;

use Drupal\Component\Serialization\Json;
use Drupal\Core\Ajax\AjaxResponse;
use Drupal\Core\Ajax\HtmlCommand;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\asu_createai_provider\Plugin\AiProvider\CreateAiProvider;
use Drupal\key\KeyRepositoryInterface;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\GuzzleException;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Configure the CreateAI provider settings.
 *
 * Supports one or more named "agents" (each its own CreateAI project /
 * Service Token + endpoint), so a site can e.g. use a different CreateAI
 * chatbot for CKEditor's AI Assistant than for AI Agents. Agent groups are
 * rendered as a simple repeatable set of details elements (classic Drupal
 * "Add another item" pattern), not a dynamic AJAX table, to keep row
 * add/remove state simple and robust.
 */
class CreateAiConfigForm extends ConfigFormBase {

  /**
   * Constructs a new CreateAiConfigForm.
   */
  public function __construct(
    ConfigFactoryInterface $config_factory,
    protected KeyRepositoryInterface $keyRepository,
    protected ClientInterface $httpClient,
  ) {
    parent::__construct($config_factory);
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('config.factory'),
      $container->get('key.repository'),
      $container->get('http_client'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'asu_createai_provider_settings_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return ['asu_createai_provider.settings'];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $config = $this->config('asu_createai_provider.settings');
    $form['#tree'] = TRUE;

    $stored_agents = array_values((array) ($config->get('agents') ?? []));
    $default_agent_id = (string) ($config->get('default_agent') ?? '');

    if ($form_state->get('agent_count') === NULL) {
      $form_state->set('agent_count', max(1, count($stored_agents)));
    }
    $agent_count = (int) $form_state->get('agent_count');

    $default_delta = 0;
    foreach ($stored_agents as $delta => $stored) {
      if (($stored['id'] ?? '') === $default_agent_id) {
        $default_delta = $delta;
        break;
      }
    }

    $form['intro'] = [
      '#markup' => '<p>' . $this->t('Configure one or more CreateAI projects ("agents"), each with its own Service Token and endpoint. Mark one as the site default; AI features that use the legacy single-model selector (or do not otherwise specify an agent) use whichever one is marked default.') . '</p>',
    ];

    $default_options = [];
    $form['agents'] = [
      '#type' => 'container',
      '#tree' => TRUE,
      '#prefix' => '<div id="createai-agents-wrapper">',
      '#suffix' => '</div>',
    ];

    for ($delta = 0; $delta < $agent_count; $delta++) {
      $stored = $stored_agents[$delta] ?? [];
      $label = (string) ($stored['label'] ?? ($delta === 0 ? 'CreateAI project default' : ''));
      $default_options[$delta] = $label !== '' ? $label : $this->t('Agent @num', ['@num' => $delta + 1]);

      $form['agents'][$delta] = [
        '#type' => 'details',
        '#title' => $label !== '' ? $label : $this->t('CreateAI agent @num', ['@num' => $delta + 1]),
        '#open' => TRUE,
      ];

      $form['agents'][$delta]['label'] = [
        '#type' => 'textfield',
        '#title' => $this->t('Label'),
        '#description' => $this->t('Shown to site builders wherever this agent can be picked (e.g. the AI Assistant provider dropdown in CKEditor).'),
        '#default_value' => $label,
        '#required' => TRUE,
      ];

      $form['agents'][$delta]['id'] = [
        '#type' => 'machine_name',
        '#title' => $this->t('Machine name'),
        '#default_value' => $stored['id'] ?? ($delta === 0 ? 'default' : ''),
        '#machine_name' => [
          'source' => ['agents', $delta, 'label'],
          'exists' => [static::class, 'agentIdExists'],
          'replace_pattern' => '[^a-z0-9_]+',
        ],
        '#required' => TRUE,
        '#disabled' => !empty($stored['id']),
      ];

      $form['agents'][$delta]['endpoint_url'] = [
        '#type' => 'url',
        '#title' => $this->t('Endpoint URL'),
        '#description' => $this->t('The CreateAI OpenAI-compatible base URL for this agent, e.g. %prod, %poc or %beta.', [
          '%prod' => 'https://api-main.aiml.asu.edu/v1',
          '%poc' => 'https://api-main-poc.aiml.asu.edu/v1',
          '%beta' => 'https://api-main-beta.aiml.asu.edu/v1',
        ]),
        '#default_value' => $stored['endpoint_url'] ?? '',
        '#required' => TRUE,
      ];

      $form['agents'][$delta]['api_key'] = [
        '#type' => 'key_select',
        '#title' => $this->t('CreateAI service token'),
        '#description' => $this->t("Select or create a Key that stores this agent's CreateAI Service Token. Do not use a Developer or Project Owner token."),
        '#default_value' => $stored['api_key'] ?? '',
        '#required' => TRUE,
        '#key_filters' => ['type' => 'authentication'],
      ];

      $form['agents'][$delta]['capabilities'] = [
        '#type' => 'fieldset',
        '#title' => $this->t('Declared capabilities'),
        '#description' => $this->t('Manually declare what this CreateAI project can do. There is no capability-discovery endpoint, so this must match how the project was built in CreateAI.'),
      ];
      $form['agents'][$delta]['capabilities']['chat'] = [
        '#type' => 'checkbox',
        '#title' => $this->t('Chat'),
        '#default_value' => $stored['capabilities']['chat'] ?? FALSE,
      ];
      $form['agents'][$delta]['capabilities']['chat_with_rag'] = [
        '#type' => 'checkbox',
        '#title' => $this->t('Chat with RAG'),
        '#default_value' => $stored['capabilities']['chat_with_rag'] ?? FALSE,
      ];

      $form['agents'][$delta]['enable_search'] = [
        '#type' => 'checkbox',
        '#title' => $this->t('Enable RAG (enable_search)'),
        '#description' => $this->t("Sends the enable_search header on every request, so answers are grounded in this CreateAI project's own knowledge base."),
        '#default_value' => $stored['enable_search'] ?? FALSE,
      ];

      $form['agents'][$delta]['enable_history'] = [
        '#type' => 'checkbox',
        '#title' => $this->t('Enable conversation history (enable_history)'),
        '#description' => $this->t('Sends the enable_history header and a session_id so CreateAI can remember earlier turns in the same visitor session.'),
        '#default_value' => $stored['enable_history'] ?? FALSE,
      ];

      // Only revalidate THIS agent's own fields — an empty array here would
      // skip validation (and thus population) of every submitted value,
      // including endpoint_url/api_key, leaving testConnection() with
      // nothing to probe.
      $wrapper_id = 'createai-agent-' . $delta . '-test-connection-wrapper';
      $form['agents'][$delta]['test_connection'] = [
        '#type' => 'container',
        '#attributes' => ['id' => $wrapper_id],
      ];
      $form['agents'][$delta]['test_connection']['button'] = [
        '#type' => 'button',
        '#value' => $this->t('Test connection'),
        '#name' => 'createai_test_connection_' . $delta,
        '#limit_validation_errors' => [
          ['agents', $delta, 'endpoint_url'],
          ['agents', $delta, 'api_key'],
        ],
        '#ajax' => [
          'callback' => '::testConnection',
          'wrapper' => $wrapper_id,
        ],
      ];
      $form['agents'][$delta]['test_connection']['result'] = [
        '#type' => 'markup',
        '#markup' => '',
      ];
    }

    // Nested inside the 'agents' container (alongside the numeric deltas)
    // rather than as a separate top-level element, so the "Add another
    // agent" AJAX rebuild — which only replaces #createai-agents-wrapper —
    // also refreshes this radios list with the newly added agent's option.
    $form['agents']['default_agent'] = [
      '#type' => 'radios',
      '#title' => $this->t('Default agent'),
      '#description' => $this->t('Used by AI features that do not explicitly pick a CreateAI agent.'),
      '#options' => $default_options,
      '#default_value' => $default_delta,
      '#weight' => -10,
    ];

    $form['add_agent'] = [
      '#type' => 'submit',
      '#value' => $this->t('Add another CreateAI agent'),
      '#submit' => ['::addAgentSubmit'],
      '#limit_validation_errors' => [],
      '#ajax' => [
        'callback' => '::agentsAjaxCallback',
        'wrapper' => 'createai-agents-wrapper',
      ],
    ];

    return parent::buildForm($form, $form_state);
  }

  /**
   * Machine name uniqueness check for the per-agent 'id' element.
   *
   * Compares against the element's own #default_value rather than matching
   * form delta to stored config array position: an already-saved agent's id
   * field is #disabled, so it always resubmits its own default value
   * unchanged (never a real collision with itself), while a new agent's
   * default value is '' (any non-empty match against a stored id is a real
   * collision). This avoids relying on form delta lining up with stored
   * config array index, which drifts apart if agents are ever reordered or
   * a middle one removed. Duplicates among not-yet-saved slots in the same
   * submission are caught separately in validateForm().
   */
  public static function agentIdExists($value, array $element, FormStateInterface $form_state): bool {
    $default_value = $element['#default_value'] ?? '';
    if ($value === $default_value) {
      return FALSE;
    }
    $config = \Drupal::config('asu_createai_provider.settings');
    foreach ((array) ($config->get('agents') ?? []) as $agent) {
      if (($agent['id'] ?? '') === $value) {
        return TRUE;
      }
    }
    return FALSE;
  }

  /**
   * Submit handler for the "Add another CreateAI agent" button.
   */
  public function addAgentSubmit(array &$form, FormStateInterface $form_state): void {
    $form_state->set('agent_count', (int) $form_state->get('agent_count') + 1);
    $form_state->setRebuild(TRUE);
  }

  /**
   * AJAX callback that returns the rebuilt agents container.
   */
  public function agentsAjaxCallback(array &$form, FormStateInterface $form_state): array {
    return $form['agents'];
  }

  /**
   * AJAX callback that probes CreateAI with a real completion request.
   *
   * A 2xx response from CreateAI is not sufficient to confirm the
   * integration works: a service token whose environment does not match
   * the endpoint URL returns HTTP 200 with an empty content string rather
   * than an authentication error. This callback therefore asserts the
   * returned assistant message is non-empty, not just that the request
   * succeeded.
   */
  public function testConnection(array &$form, FormStateInterface $form_state): AjaxResponse {
    $triggering_element = $form_state->getTriggeringElement();
    $delta = $triggering_element['#array_parents'][1] ?? 0;

    $endpoint_url = $form_state->getValue(['agents', $delta, 'endpoint_url']);
    $key_id = $form_state->getValue(['agents', $delta, 'api_key']);

    $message = $this->probeConnection((string) $endpoint_url, (string) $key_id);

    $wrapper_id = 'createai-agent-' . $delta . '-test-connection-wrapper';
    $response = new AjaxResponse();
    $response->addCommand(new HtmlCommand('#' . $wrapper_id, [
      $form['agents'][$delta]['test_connection']['button'],
      ['#type' => 'markup', '#markup' => $message],
    ]));

    return $response;
  }

  /**
   * Sends a real completion probe to CreateAI and evaluates the result.
   *
   * @param string $endpoint_url
   *   The endpoint URL as entered in the form.
   * @param string $key_id
   *   The Key module key ID selected in the form.
   *
   * @return string
   *   A render-safe HTML status message.
   */
  protected function probeConnection(string $endpoint_url, string $key_id): string {
    if ($endpoint_url === '' || $key_id === '') {
      return '<div class="messages messages--error">' . $this->t('Enter an endpoint URL and select a token before testing.') . '</div>';
    }

    // The Test connection button limits validation to just this agent's own
    // fields, which skips the key_select element's normal option-list
    // validation. Re-check the submitted key is actually one of the
    // authentication-type keys the select offers, so a user with access to
    // this form (but not to Key administration) cannot probe an arbitrary
    // Key ID and have the server send its raw secret to CreateAI as a
    // Bearer token.
    if (!array_key_exists($key_id, $this->keyRepository->getKeyNamesAsOptions(['type' => 'authentication']))) {
      return '<div class="messages messages--error">' . $this->t('Invalid key selection.') . '</div>';
    }

    $token = $this->keyRepository->getKey($key_id)?->getKeyValue();
    if (!$token) {
      return '<div class="messages messages--error">' . $this->t('Could not load the selected key value.') . '</div>';
    }

    try {
      $base_url = CreateAiProvider::normalizeEndpoint($endpoint_url);
    }
    catch (\InvalidArgumentException $e) {
      return '<div class="messages messages--error">' . $this->t('@message', ['@message' => $e->getMessage()]) . '</div>';
    }

    try {
      $http_response = $this->httpClient->request('POST', $base_url . '/chat/completions', [
        'headers' => [
          'Authorization' => 'Bearer ' . $token,
          'Content-Type' => 'application/json',
        ],
        'json' => [
          'model' => 'defaults',
          'messages' => [
            ['role' => 'user', 'content' => 'Return exactly this text: pong'],
          ],
          'temperature' => 0,
          'max_tokens' => 10,
          'stream' => FALSE,
        ],
        'timeout' => 15,
        'allow_redirects' => FALSE,
      ]);
    }
    catch (GuzzleException $e) {
      return '<div class="messages messages--error">' . $this->t('Could not connect to CreateAI: @message', ['@message' => $e->getMessage()]) . '</div>';
    }

    $data = Json::decode((string) $http_response->getBody());
    $content = $data['choices'][0]['message']['content'] ?? '';

    if ($content === '') {
      return '<div class="messages messages--warning">' . $this->t('Connected to CreateAI, but the model returned an empty response. This usually means your token\'s environment does not match the endpoint URL. Make sure a production token uses %prod, a POC token uses %poc, and a beta token uses %beta.', [
        '%prod' => 'https://api-main.aiml.asu.edu/v1',
        '%poc' => 'https://api-main-poc.aiml.asu.edu/v1',
        '%beta' => 'https://api-main-beta.aiml.asu.edu/v1',
      ]) . '</div>';
    }

    return '<div class="messages messages--status">' . $this->t('Connected successfully. CreateAI replied: %content', ['%content' => $content]) . '</div>';
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state) {
    parent::validateForm($form, $form_state);

    $agents = $form_state->getValue('agents') ?? [];
    $default_delta = $agents['default_agent'] ?? NULL;
    unset($agents['default_agent']);
    $seen_ids = [];

    foreach ($agents as $delta => $agent) {
      $endpoint_url = (string) ($agent['endpoint_url'] ?? '');
      if ($endpoint_url !== '') {
        try {
          CreateAiProvider::normalizeEndpoint($endpoint_url);
        }
        catch (\InvalidArgumentException $e) {
          $form_state->setErrorByName("agents][$delta][endpoint_url", $e->getMessage());
        }
      }

      $capabilities = $agent['capabilities'] ?? [];
      if (empty($capabilities['chat']) && empty($capabilities['chat_with_rag'])) {
        $form_state->setErrorByName("agents][$delta][capabilities", $this->t('Declare at least one capability (Chat or Chat with RAG) for this agent.'));
      }

      $id = (string) ($agent['id'] ?? '');
      if ($id !== '') {
        if (isset($seen_ids[$id])) {
          $form_state->setErrorByName("agents][$delta][id", $this->t('Machine name %id is used by more than one agent on this form.', ['%id' => $id]));
        }
        $seen_ids[$id] = TRUE;
      }
    }

    if ($default_delta !== NULL && empty($agents[$default_delta]['id'])) {
      $form_state->setErrorByName('agents][default_agent', $this->t('The selected default agent must have a machine name.'));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $agents_input = $form_state->getValue('agents') ?? [];
    $default_delta = $agents_input['default_agent'] ?? NULL;
    unset($agents_input['default_agent']);

    $agents = [];
    foreach ($agents_input as $agent) {
      if (empty($agent['id'])) {
        continue;
      }
      $agents[] = [
        'id' => (string) $agent['id'],
        'label' => (string) $agent['label'],
        'endpoint_url' => CreateAiProvider::normalizeEndpoint((string) $agent['endpoint_url']),
        'api_key' => (string) $agent['api_key'],
        'capabilities' => [
          'chat' => (bool) ($agent['capabilities']['chat'] ?? FALSE),
          'chat_with_rag' => (bool) ($agent['capabilities']['chat_with_rag'] ?? FALSE),
        ],
        'enable_search' => (bool) ($agent['enable_search'] ?? FALSE),
        'enable_history' => (bool) ($agent['enable_history'] ?? FALSE),
      ];
    }

    $default_agent_id = $agents_input[$default_delta]['id'] ?? ($agents[0]['id'] ?? 'default');

    $this->config('asu_createai_provider.settings')
      ->set('agents', $agents)
      ->set('default_agent', (string) $default_agent_id)
      ->save();

    parent::submitForm($form, $form_state);
  }

}
