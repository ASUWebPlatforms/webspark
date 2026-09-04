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

    $form['endpoint_url'] = [
      '#type' => 'url',
      '#title' => $this->t('Endpoint URL'),
      '#description' => $this->t('The CreateAI OpenAI-compatible base URL for your project, e.g. %prod, %poc or %beta. Each site pastes its own endpoint.', [
        '%prod' => 'https://api-main.aiml.asu.edu/v1',
        '%poc' => 'https://api-main-poc.aiml.asu.edu/v1',
        '%beta' => 'https://api-main-beta.aiml.asu.edu/v1',
      ]),
      '#default_value' => $config->get('endpoint_url'),
      '#required' => TRUE,
    ];

    $form['api_key'] = [
      '#type' => 'key_select',
      '#title' => $this->t('CreateAI service token'),
      '#description' => $this->t('Select or create a Key that stores your CreateAI Service Token. Do not use a Developer or Project Owner token.'),
      '#default_value' => $config->get('api_key'),
      '#required' => TRUE,
      '#key_filters' => ['type' => 'authentication'],
    ];

    $form['capabilities'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Declared capabilities'),
      '#description' => $this->t('Manually declare what this CreateAI project can do. There is no capability-discovery endpoint, so this must match how the project was built in CreateAI.'),
    ];
    $form['capabilities']['chat'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Chat'),
      '#default_value' => $config->get('capabilities.chat'),
    ];
    $form['capabilities']['chat_with_rag'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Chat with RAG'),
      '#default_value' => $config->get('capabilities.chat_with_rag'),
    ];
    $form['capabilities']['coming_soon'] = [
      '#type' => 'item',
      '#title' => $this->t('Vision, Speech, Chat Upload'),
      '#markup' => $this->t('Coming soon.'),
      '#disabled' => TRUE,
    ];

    $form['enable_search'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable RAG (enable_search)'),
      '#description' => $this->t("Sends the enable_search header on every request, so answers are grounded in this CreateAI project's own knowledge base."),
      '#default_value' => $config->get('enable_search'),
    ];

    $form['enable_history'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable conversation history (enable_history)'),
      '#description' => $this->t('Sends the enable_history header and a session_id so CreateAI can remember earlier turns in the same visitor session.'),
      '#default_value' => $config->get('enable_history'),
    ];

    $form['test_connection'] = [
      '#type' => 'container',
      '#attributes' => ['id' => 'createai-test-connection-wrapper'],
    ];
    $form['test_connection']['button'] = [
      '#type' => 'button',
      '#value' => $this->t('Test connection'),
      '#ajax' => [
        'callback' => '::testConnection',
        'wrapper' => 'createai-test-connection-wrapper',
      ],
    ];
    $form['test_connection']['result'] = [
      '#type' => 'markup',
      '#markup' => '',
    ];

    return parent::buildForm($form, $form_state);
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
    $response = new AjaxResponse();

    $endpoint_url = $form_state->getValue('endpoint_url');
    $key_id = $form_state->getValue('api_key');

    $message = $this->probeConnection((string) $endpoint_url, (string) $key_id);

    $response->addCommand(new HtmlCommand('#createai-test-connection-wrapper', [
      $form['test_connection']['button'],
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

    $endpoint_url = (string) $form_state->getValue('endpoint_url');
    if ($endpoint_url === '') {
      return;
    }

    try {
      CreateAiProvider::normalizeEndpoint($endpoint_url);
    }
    catch (\InvalidArgumentException $e) {
      $form_state->setErrorByName('endpoint_url', $e->getMessage());
    }

    $capabilities = $form_state->getValue('capabilities') ?? [];
    if (empty($capabilities['chat']) && empty($capabilities['chat_with_rag'])) {
      $form_state->setErrorByName('capabilities', $this->t('Declare at least one capability (Chat or Chat with RAG).'));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $endpoint_url = CreateAiProvider::normalizeEndpoint((string) $form_state->getValue('endpoint_url'));

    $this->config('asu_createai_provider.settings')
      ->set('endpoint_url', $endpoint_url)
      ->set('api_key', $form_state->getValue('api_key'))
      ->set('capabilities', $form_state->getValue('capabilities'))
      ->set('enable_search', (bool) $form_state->getValue('enable_search'))
      ->set('enable_history', (bool) $form_state->getValue('enable_history'))
      ->save();

    parent::submitForm($form, $form_state);
  }

}
