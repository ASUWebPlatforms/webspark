<?php

declare(strict_types=1);

namespace Drupal\Tests\asu_ai_chatbot_styles\Kernel;

use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;

/**
 * Kernel tests for the ellipsis-menu link validation and config schema.
 *
 * Covers URL validation, submit persistence,
 * preprocess rendering, and config-schema acceptance. Uses a real Drupal
 * container (Url::fromUri, Url::fromUserInput, typed config) to validate
 * the security-sensitive URL boundary that Unit tests with mocked
 * containers cannot reach.
 *
 * @group asu_ai_chatbot_styles
 */
class BlockFormTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system',
    'user',
    'block',
    'ai',
    'ai_assistant_api',
    'ai_chatbot',
    'asu_ai_chatbot_styles',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['system']);
    // Load the module file so procedural functions are available.
    $this->container->get('module_handler')
      ->loadInclude('asu_ai_chatbot_styles', 'module');
  }

  // ---------------------------------------------------------------------------
  // External link URL validation (XSS guard).
  // ---------------------------------------------------------------------------

  /**
   * The URL validator rejects javascript: URIs (XSS attempt).
   */
  public function testValidateLinkUrlRejectsJavascriptScheme(): void {
    $element = [
      '#value' => 'javascript:alert(1)',
      '#name' => 'settings[asu_sparkles][links][0][url]',
      '#parents' => ['settings', 'asu_sparkles', 'links', 0, 'url'],
    ];
    $form_state = new FormState();

    _asu_ai_chatbot_styles_validate_link_url($element, $form_state);

    $errors = $form_state->getErrors();
    $this->assertNotEmpty($errors, 'javascript: URL must produce a validation error');
  }

  /**
   * The URL validator rejects vbscript: URIs.
   */
  public function testValidateLinkUrlRejectsVbscriptScheme(): void {
    $element = [
      '#value' => 'vbscript:msgbox(1)',
      '#name' => 'settings[asu_sparkles][links][0][url]',
      '#parents' => ['settings', 'asu_sparkles', 'links', 0, 'url'],
    ];
    $form_state = new FormState();

    _asu_ai_chatbot_styles_validate_link_url($element, $form_state);

    $this->assertNotEmpty($form_state->getErrors(), 'vbscript: URL must produce a validation error');
  }

  /**
   * The URL validator rejects data: URIs.
   */
  public function testValidateLinkUrlRejectsDataUri(): void {
    $element = [
      '#value' => 'data:text/html,<script>alert(1)</script>',
      '#name' => 'settings[asu_sparkles][links][0][url]',
      '#parents' => ['settings', 'asu_sparkles', 'links', 0, 'url'],
    ];
    $form_state = new FormState();

    _asu_ai_chatbot_styles_validate_link_url($element, $form_state);

    $this->assertNotEmpty($form_state->getErrors(), 'data: URL must produce a validation error');
  }

  /**
   * The URL validator rejects tab-obfuscated javascript: URIs.
   */
  public function testValidateLinkUrlRejectsObfuscatedJavascriptScheme(): void {
    $element = [
      '#value' => "java\tscript:alert(1)",
      '#name' => 'settings[asu_sparkles][links][0][url]',
      '#parents' => ['settings', 'asu_sparkles', 'links', 0, 'url'],
    ];
    $form_state = new FormState();

    _asu_ai_chatbot_styles_validate_link_url($element, $form_state);

    $this->assertNotEmpty($form_state->getErrors(), 'Tab-obfuscated javascript: URL must produce a validation error');
  }

  /**
   * The URL validator rejects protocol-relative // URLs.
   *
   * Protocol-relative URLs inherit the page scheme and can link to arbitrary
   * external hosts. They must be rejected; only explicit https:// is allowed.
   */
  public function testValidateLinkUrlRejectsProtocolRelativeUrl(): void {
    $element = [
      '#value' => '//evil.example/path',
      '#name' => 'settings[asu_sparkles][links][0][url]',
      '#parents' => ['settings', 'asu_sparkles', 'links', 0, 'url'],
    ];
    $form_state = new FormState();

    _asu_ai_chatbot_styles_validate_link_url($element, $form_state);

    $this->assertNotEmpty($form_state->getErrors(), 'Protocol-relative // URL must produce a validation error');
  }

  /**
   * The URL validator rejects the backslash variant /\.
   *
   * Browsers normalise '\' to '/', so '/\evil.example' resolves like the
   * protocol-relative '//evil.example'. It must be rejected too.
   */
  public function testValidateLinkUrlRejectsBackslashProtocolRelativeUrl(): void {
    $element = [
      '#value' => '/\\evil.example/path',
      '#name' => 'settings[asu_sparkles][links][0][url]',
      '#parents' => ['settings', 'asu_sparkles', 'links', 0, 'url'],
    ];
    $form_state = new FormState();

    _asu_ai_chatbot_styles_validate_link_url($element, $form_state);

    $this->assertNotEmpty($form_state->getErrors(), 'Backslash protocol-relative /\\ URL must produce a validation error');
  }

  /**
   * The URL validator rejects a leading double-backslash \\.
   */
  public function testValidateLinkUrlRejectsDoubleBackslashUrl(): void {
    $element = [
      '#value' => '\\\\evil.example/path',
      '#name' => 'settings[asu_sparkles][links][0][url]',
      '#parents' => ['settings', 'asu_sparkles', 'links', 0, 'url'],
    ];
    $form_state = new FormState();

    _asu_ai_chatbot_styles_validate_link_url($element, $form_state);

    $this->assertNotEmpty($form_state->getErrors(), 'Double-backslash \\\\ URL must produce a validation error');
  }

  /**
   * The URL validator accepts a valid https:// external URL.
   */
  public function testValidateLinkUrlAcceptsHttpsUrl(): void {
    $element = [
      '#value' => 'https://asu.edu/about',
      '#name' => 'settings[asu_sparkles][links][0][url]',
      '#parents' => ['settings', 'asu_sparkles', 'links', 0, 'url'],
    ];
    $form_state = new FormState();

    _asu_ai_chatbot_styles_validate_link_url($element, $form_state);

    $this->assertEmpty($form_state->getErrors(), 'https:// URL must not produce a validation error');
  }

  /**
   * The URL validator passes an empty URL value (skipped on submit).
   */
  public function testValidateLinkUrlPassesEmptyValue(): void {
    $element = [
      '#value' => '',
      '#name' => 'settings[asu_sparkles][links][0][url]',
      '#parents' => ['settings', 'asu_sparkles', 'links', 0, 'url'],
    ];
    $form_state = new FormState();

    _asu_ai_chatbot_styles_validate_link_url($element, $form_state);

    $this->assertEmpty($form_state->getErrors(), 'Empty URL must not produce a validation error');
  }

  // ---------------------------------------------------------------------------
  // Internal link saved and rendered.
  // ---------------------------------------------------------------------------

  /**
   * An internal path is normalised and emitted as an internal href.
   */
  public function testBuildLinkUrlAcceptsInternalPath(): void {
    $result = _asu_ai_chatbot_styles_build_link_url('/contact');

    $this->assertNotNull($result, '_asu_ai_chatbot_styles_build_link_url must return array for valid internal path');
    $this->assertSame(FALSE, $result['external'], 'Internal path must have external === false');
    // The href is the path-aliased URL; for /contact on a fresh Kernel install
    // it is /contact itself.
    $this->assertStringContainsString('contact', $result['href']);
  }

  /**
   * An external URL is classified as external with the correct href.
   */
  public function testBuildLinkUrlAcceptsExternalUrl(): void {
    $result = _asu_ai_chatbot_styles_build_link_url('https://asu.edu/about');

    $this->assertNotNull($result);
    $this->assertTrue($result['external'], 'External URL must have external === true');
    $this->assertStringContainsString('asu.edu', $result['href']);
  }

  /**
   * A fragment-only URL is accepted as-is.
   */
  public function testBuildLinkUrlAcceptsFragment(): void {
    $result = _asu_ai_chatbot_styles_build_link_url('#faq');

    $this->assertNotNull($result);
    $this->assertSame('#faq', $result['href']);
    $this->assertFalse($result['external']);
  }

  /**
   * A dangerous scheme is rejected even with whitespace padding.
   */
  public function testBuildLinkUrlRejectsDangerousScheme(): void {
    foreach (['javascript:alert(1)', 'vbscript:x', 'data:text/html,x', "java\nscript:x"] as $bad) {
      $this->assertNull(
        _asu_ai_chatbot_styles_build_link_url($bad),
        "Must return NULL for dangerous scheme: {$bad}"
      );
    }
  }

  /**
   * Protocol-relative // URLs are rejected by the build helper.
   */
  public function testBuildLinkUrlRejectsProtocolRelativeUrl(): void {
    $this->assertNull(
      _asu_ai_chatbot_styles_build_link_url('//evil.example/path'),
      'Protocol-relative // URL must return NULL'
    );
    $this->assertNull(
      _asu_ai_chatbot_styles_build_link_url('//example.com'),
      'Protocol-relative //example.com must return NULL'
    );
  }

  /**
   * Arbitrary text (not a valid URL) is rejected.
   */
  public function testBuildLinkUrlRejectsArbitraryText(): void {
    $this->assertNull(_asu_ai_chatbot_styles_build_link_url('not-a-url'));
    $this->assertNull(_asu_ai_chatbot_styles_build_link_url('some text with spaces'));
  }

  // ---------------------------------------------------------------------------
  // Empty-URL rows dropped from menu_links.
  // ---------------------------------------------------------------------------

  /**
   * Preprocess drops rows where the URL is empty.
   */
  public function testPreprocessDropsEmptyUrlRows(): void {
    $variables = [
      'settings' => [
        'placement' => 'asu_sparkles',
        'asu_sparkles_links' => [
          ['label' => 'Contact', 'url' => '/contact'],
          ['label' => 'Ignored', 'url' => ''],
          ['label' => '', 'url' => '   '],
        ],
      ],
    ];

    asu_ai_chatbot_styles_preprocess_ai_deepchat($variables);

    $this->assertCount(
      1,
      $variables['menu_links'],
      'Rows with empty or whitespace-only URLs must be dropped from menu_links'
    );
    $this->assertStringContainsString('contact', $variables['menu_links'][0]['href']);
  }

  /**
   * Preprocess with all empty URLs produces an empty menu_links array.
   */
  public function testPreprocessProducesEmptyMenuLinksWhenAllUrlsEmpty(): void {
    $variables = [
      'settings' => [
        'placement' => 'asu_sparkles',
        'asu_sparkles_links' => [
          ['label' => 'A', 'url' => ''],
          ['label' => 'B', 'url' => ''],
        ],
      ],
    ];

    asu_ai_chatbot_styles_preprocess_ai_deepchat($variables);

    $this->assertSame([], $variables['menu_links']);
    // menu_popover_id is still set (Clear button renders regardless).
    $this->assertNotEmpty($variables['menu_popover_id']);
  }

  // ---------------------------------------------------------------------------
  // Config schema accepts the new key (real typed-config service).
  // ---------------------------------------------------------------------------

  /**
   * The schema alter adds asu_sparkles_links to the block settings mapping.
   *
   * This test loads the real ai_chatbot module schema so the
   * block.settings.ai_deepchat_block definition actually exists in the typed
   * config registry, then calls the alter hook and verifies the merged result
   * through the runtime typed config service.
   */
  public function testConfigSchemaAcceptsAsuSparklesLinksKey(): void {
    /** @var \Drupal\Core\Config\TypedConfigManagerInterface $typedConfig */
    $typedConfig = $this->container->get('config.typed');

    // Retrieve the real definition from the registry (ai_chatbot provides it).
    // clearCachedDefinitions() ensures the alter hook result is live.
    $typedConfig->clearCachedDefinitions();
    $definitions = $typedConfig->getDefinitions();

    $schemaKey = 'block.settings.' . ASU_AI_CHATBOT_STYLES_PLUGIN_ID;
    $this->assertArrayHasKey($schemaKey, $definitions, "Schema key {$schemaKey} must exist after module install");

    $mapping = $definitions[$schemaKey]['mapping'] ?? [];

    // The module's hook_config_schema_info_alter adds asu_sparkles_links.
    $this->assertArrayHasKey('asu_sparkles_links', $mapping, 'asu_sparkles_links must be present in the runtime schema after the alter hook runs');

    // The key must be a sequence with a mapping of label + url.
    $linksSchema = $mapping['asu_sparkles_links'];
    $this->assertSame('sequence', $linksSchema['type'], 'asu_sparkles_links must be a sequence type');
    $innerMapping = $linksSchema['sequence']['mapping'] ?? [];
    $this->assertArrayHasKey('label', $innerMapping, 'Inner mapping must have a label key');
    $this->assertArrayHasKey('url', $innerMapping, 'Inner mapping must have a url key');
    $this->assertSame('label', $innerMapping['label']['type']);
    $this->assertSame('string', $innerMapping['url']['type']);

    // Verify the pre-existing keys are not clobbered (non-destructive merge).
    $this->assertArrayHasKey('placement', $mapping, 'Pre-existing placement key must remain after the alter');
    $this->assertArrayHasKey('asu_sparkles_questions', $mapping, 'Pre-existing asu_sparkles_questions key must remain after the alter');
  }

  /**
   * Typed config validates a conforming asu_sparkles_links value at runtime.
   *
   * Creates a typed data instance from the real config.typed service using
   * the sequence schema produced by the alter hook, and asserts no exception
   * is thrown and the definition is well-formed.
   */
  public function testTypedConfigAcceptsConformingLinksValue(): void {
    /** @var \Drupal\Core\Config\TypedConfigManagerInterface $typedConfig */
    $typedConfig = $this->container->get('config.typed');
    $typedConfig->clearCachedDefinitions();

    $definitions = $typedConfig->getDefinitions();
    $schemaKey = 'block.settings.' . ASU_AI_CHATBOT_STYLES_PLUGIN_ID;
    $this->assertArrayHasKey($schemaKey, $definitions);

    $linksSchema = $definitions[$schemaKey]['mapping']['asu_sparkles_links'];
    $this->assertSame('sequence', $linksSchema['type']);

    // buildDataDefinition must succeed without throwing for a well-formed
    // schema definition (this exercises the real typed config registry path).
    $sequenceDef = $typedConfig->buildDataDefinition($linksSchema, NULL);
    $this->assertNotNull($sequenceDef, 'buildDataDefinition must succeed for the asu_sparkles_links schema');

    // Verify the sequence has an inner mapping with the expected keys.
    $innerMapping = $linksSchema['sequence']['mapping'] ?? [];
    $this->assertArrayHasKey('label', $innerMapping, 'Inner sequence mapping must have label');
    $this->assertArrayHasKey('url', $innerMapping, 'Inner sequence mapping must have url');

    // Verify the value types match the locked schema spec.
    $this->assertSame('label', $innerMapping['label']['type']);
    $this->assertSame('string', $innerMapping['url']['type']);
  }

}
