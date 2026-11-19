<?php

declare(strict_types=1);

namespace Drupal\Tests\asu_ai_chatbot_styles\Unit;

use Drupal\Core\Block\BlockPluginInterface;
use Drupal\block\BlockInterface;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Entity\EntityFormInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Tests\UnitTestCase;

/**
 * Tests asu_sparkles settings persistence, preprocessing and schema.
 *
 * @group asu_ai_chatbot_styles
 */
class AsuSparklesSettingsTest extends UnitTestCase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    require_once __DIR__ . '/../../../asu_ai_chatbot_styles.module';

    // Wire a string-translation stub into the container so bare t() calls in
    // the module's preprocess function resolve without a full Drupal bootstrap.
    $container = new ContainerBuilder();
    $container->set('string_translation', $this->getStringTranslationStub());
    \Drupal::setContainer($container);
  }

  /**
   * Preset questions are cleaned and persisted onto the block entity.
   */
  public function testBlockFormSubmitPersistsCleanedQuestions(): void {
    $captured = NULL;

    $plugin = $this->createMock(BlockPluginInterface::class);
    // The live plugin configuration already carries the chosen placement.
    $plugin->method('getConfiguration')->willReturn([
      'placement' => 'asu_sparkles',
      'bot_name' => 'AI Assistant',
    ]);

    $block = $this->createMock(BlockInterface::class);
    $block->method('getPluginId')->willReturn(ASU_AI_CHATBOT_STYLES_PLUGIN_ID);
    $block->method('getPlugin')->willReturn($plugin);
    $block->method('set')->willReturnCallback(function (string $key, $value) use (&$captured): void {
      if ($key === 'settings') {
        $captured = $value;
      }
    });

    $form_object = $this->createMock(EntityFormInterface::class);
    $form_object->method('getEntity')->willReturn($block);

    $rows = [
      ['label' => 'Deadlines', 'text' => 'What are the application deadlines?'],
      // Empty sent text -> skipped.
      ['label' => 'Ignored', 'text' => '   '],
      // Empty label -> falls back to the sent text.
      ['label' => '', 'text' => 'Tell me about financial aid'],
    ];

    $form_state = $this->createMock(FormStateInterface::class);
    $form_state->method('getFormObject')->willReturn($form_object);
    $form_state->method('getValue')->willReturnCallback(function (array $key, $default = NULL) use ($rows) {
      if ($key === ['settings', 'asu_sparkles']) {
        return [
          'questions' => $rows,
          'scroll_trigger' => '#main',
          'section' => 'Hero',
          'send_typed_text' => TRUE,
        ];
      }
      return $default;
    });

    $form = [];
    asu_ai_chatbot_styles_block_form_submit($form, $form_state);

    $this->assertIsArray($captured);
    $this->assertSame([
      ['label' => 'Deadlines', 'text' => 'What are the application deadlines?'],
      ['label' => 'Tell me about financial aid', 'text' => 'Tell me about financial aid'],
    ], $captured['asu_sparkles_questions']);
    // Pre-existing settings are preserved.
    $this->assertSame('asu_sparkles', $captured['placement']);
    // Section is lowercased; other fields persisted.
    $this->assertSame('hero', $captured['asu_sparkles_section']);
    $this->assertSame('#main', $captured['asu_sparkles_scroll_trigger']);
    $this->assertTrue($captured['asu_sparkles_send_typed_text']);
  }

  /**
   * Block settings are mapped onto clean template variables.
   */
  public function testPreprocessMapsSettingsToVariables(): void {
    $variables = [
      'settings' => [
        'placement' => 'asu_sparkles',
        'asu_sparkles_questions' => [
          ['label' => 'A', 'text' => 'Question A'],
          ['label' => '', 'text' => ''],
        ],
        'asu_sparkles_section' => 'hero',
        'asu_sparkles_scroll_trigger' => '#main-content',
        'asu_sparkles_send_typed_text' => TRUE,
      ],
    ];

    asu_ai_chatbot_styles_preprocess_ai_deepchat($variables);

    $this->assertSame([['label' => 'A', 'text' => 'Question A']], $variables['preset_questions']);
    $this->assertSame('hero', $variables['datalayer_section']);
    $this->assertSame('#main-content', $variables['scroll_trigger']);
    $this->assertTrue($variables['send_typed_text']);
  }

  /**
   * Preprocess defaults the section and is a no-op for other placements.
   */
  public function testPreprocessDefaultsAndGuards(): void {
    // Non-asu_sparkles placement: untouched.
    $other = ['settings' => ['placement' => 'toolbar']];
    asu_ai_chatbot_styles_preprocess_ai_deepchat($other);
    $this->assertArrayNotHasKey('preset_questions', $other);

    // asu_sparkles with no section: defaults to "welcome".
    $variables = ['settings' => ['placement' => 'asu_sparkles']];
    asu_ai_chatbot_styles_preprocess_ai_deepchat($variables);
    $this->assertSame('welcome', $variables['datalayer_section']);
    $this->assertSame([], $variables['preset_questions']);
    $this->assertFalse($variables['send_typed_text']);
    // Scrim defaults FALSE when the key is absent.
    $this->assertFalse($variables['scrim']);
  }

  /**
   * The schema alter adds the asu_sparkles keys to the block settings.
   */
  public function testConfigSchemaInfoAlterAddsKeys(): void {
    $definitions = [
      'block.settings.' . ASU_AI_CHATBOT_STYLES_PLUGIN_ID => [
        'type' => 'block_settings',
        'mapping' => [
          'placement' => ['type' => 'string'],
        ],
      ],
    ];

    asu_ai_chatbot_styles_config_schema_info_alter($definitions);

    $mapping = $definitions['block.settings.' . ASU_AI_CHATBOT_STYLES_PLUGIN_ID]['mapping'];
    $this->assertArrayHasKey('asu_sparkles_questions', $mapping);
    $this->assertSame('sequence', $mapping['asu_sparkles_questions']['type']);
    $this->assertArrayHasKey('asu_sparkles_section', $mapping);
    $this->assertArrayHasKey('asu_sparkles_scroll_trigger', $mapping);
    $this->assertArrayHasKey('asu_sparkles_send_typed_text', $mapping);
    // Scrim schema key is present and typed as boolean.
    $this->assertArrayHasKey('asu_sparkles_scrim', $mapping);
    $this->assertSame('boolean', $mapping['asu_sparkles_scrim']['type']);
    // Pre-existing keys are preserved.
    $this->assertArrayHasKey('placement', $mapping);
  }

  /**
   * The region_label variable is mapped from settings.label when present.
   */
  public function testPreprocessSetsRegionLabelFromSettingsLabel(): void {
    $variables = [
      'settings' => [
        'placement' => 'asu_sparkles',
        'label' => 'CreateAI Assistant',
      ],
    ];
    asu_ai_chatbot_styles_preprocess_ai_deepchat($variables);
    $this->assertSame('CreateAI Assistant', $variables['region_label']);
  }

  /**
   * The region_label variable falls back to 'ASU chat assistant' when absent.
   */
  public function testPreprocessSetsRegionLabelFallbackWhenLabelAbsent(): void {
    // Empty string.
    $variables = [
      'settings' => [
        'placement' => 'asu_sparkles',
        'label' => '',
      ],
    ];
    asu_ai_chatbot_styles_preprocess_ai_deepchat($variables);
    $this->assertSame('ASU chat assistant', (string) $variables['region_label']);

    // Key absent entirely.
    $variables2 = [
      'settings' => [
        'placement' => 'asu_sparkles',
      ],
    ];
    asu_ai_chatbot_styles_preprocess_ai_deepchat($variables2);
    $this->assertSame('ASU chat assistant', (string) $variables2['region_label']);
  }

  /**
   * Scrim is mapped from stored settings onto template variables.
   */
  public function testPreprocessMapsScrim(): void {
    $variables = [
      'settings' => [
        'placement' => 'asu_sparkles',
        'asu_sparkles_scrim' => TRUE,
      ],
    ];
    asu_ai_chatbot_styles_preprocess_ai_deepchat($variables);
    $this->assertTrue($variables['scrim']);
  }

  /**
   * Scrim is persisted onto the block entity by the form submit handler.
   */
  public function testBlockFormSubmitPersistsScrim(): void {
    $captured = NULL;

    $plugin = $this->createMock(BlockPluginInterface::class);
    $plugin->method('getConfiguration')->willReturn([
      'placement' => 'asu_sparkles',
    ]);

    $block = $this->createMock(BlockInterface::class);
    $block->method('getPluginId')->willReturn(ASU_AI_CHATBOT_STYLES_PLUGIN_ID);
    $block->method('getPlugin')->willReturn($plugin);
    $block->method('set')->willReturnCallback(function (string $key, $value) use (&$captured): void {
      if ($key === 'settings') {
        $captured = $value;
      }
    });

    $form_object = $this->createMock(EntityFormInterface::class);
    $form_object->method('getEntity')->willReturn($block);

    $form_state = $this->createMock(FormStateInterface::class);
    $form_state->method('getFormObject')->willReturn($form_object);
    $form_state->method('getValue')->willReturnCallback(function (array $key, $default = NULL) {
      if ($key === ['settings', 'asu_sparkles']) {
        return [
          'scrim' => TRUE,
          'questions' => [],
          'scroll_trigger' => '',
          'section' => '',
          'send_typed_text' => FALSE,
        ];
      }
      return $default;
    });

    $form = [];
    asu_ai_chatbot_styles_block_form_submit($form, $form_state);
    $this->assertIsArray($captured);
    $this->assertTrue($captured['asu_sparkles_scrim']);
  }

  /**
   * Block form submit persists ellipsis-menu links onto the block entity.
   *
   * In the unit context the URL helper path is exercised with fragment-only
   * links (no Url::fromUri / Url::fromUserInput needed); the Kernel test covers
   * the full Drupal URL resolution path with a real container.
   */
  public function testBlockFormSubmitPersistsLinks(): void {
    $captured = NULL;

    $plugin = $this->createMock(BlockPluginInterface::class);
    $plugin->method('getConfiguration')->willReturn([
      'placement' => 'asu_sparkles',
    ]);

    $block = $this->createMock(BlockInterface::class);
    $block->method('getPluginId')->willReturn(ASU_AI_CHATBOT_STYLES_PLUGIN_ID);
    $block->method('getPlugin')->willReturn($plugin);
    $block->method('set')->willReturnCallback(function (string $key, $value) use (&$captured): void {
      if ($key === 'settings') {
        $captured = $value;
      }
    });

    $form_object = $this->createMock(EntityFormInterface::class);
    $form_object->method('getEntity')->willReturn($block);

    $links_input = [
      // Row with both label and URL — will be validated (fragment path, no Url::* needed).
      ['label' => 'FAQ', 'url' => '#faq'],
      // Empty URL row — must be dropped.
      ['label' => 'Ignored', 'url' => ''],
      // Whitespace-only URL — must be dropped.
      ['label' => 'Also ignored', 'url' => '   '],
    ];

    $form_state = $this->createMock(FormStateInterface::class);
    $form_state->method('getFormObject')->willReturn($form_object);
    $form_state->method('getValue')->willReturnCallback(function (array $key, $default = NULL) use ($links_input) {
      if ($key === ['settings', 'asu_sparkles']) {
        return [
          'questions' => [],
          'links' => $links_input,
          'scroll_trigger' => '',
          'section' => '',
          'send_typed_text' => FALSE,
          'scrim' => FALSE,
        ];
      }
      return $default;
    });

    $form = [];
    asu_ai_chatbot_styles_block_form_submit($form, $form_state);

    $this->assertIsArray($captured);
    $this->assertArrayHasKey('asu_sparkles_links', $captured);
    // Only the '#faq' row should survive (the two empty rows are dropped).
    $this->assertCount(1, $captured['asu_sparkles_links']);
    $this->assertSame('#faq', $captured['asu_sparkles_links'][0]['url']);
    // External is not stored by submit handler (computed at preprocess time).
    $this->assertArrayHasKey('label', $captured['asu_sparkles_links'][0]);
  }

  /**
   * Config schema alter adds asu_sparkles_links to the block settings mapping.
   *
   * Structurally validates the schema array; the Kernel test exercises the
   * real typed config manager.
   */
  public function testConfigSchemaInfoAlterAddsLinksKey(): void {
    $definitions = [
      'block.settings.' . ASU_AI_CHATBOT_STYLES_PLUGIN_ID => [
        'type' => 'block_settings',
        'mapping' => [
          'placement' => ['type' => 'string'],
        ],
      ],
    ];

    asu_ai_chatbot_styles_config_schema_info_alter($definitions);

    $mapping = $definitions['block.settings.' . ASU_AI_CHATBOT_STYLES_PLUGIN_ID]['mapping'];

    $this->assertArrayHasKey('asu_sparkles_links', $mapping);
    $this->assertSame('sequence', $mapping['asu_sparkles_links']['type']);

    // Inner mapping has label and url keys.
    $inner = $mapping['asu_sparkles_links']['sequence']['mapping'];
    $this->assertArrayHasKey('label', $inner);
    $this->assertArrayHasKey('url', $inner);

    // Existing keys are preserved.
    $this->assertArrayHasKey('placement', $mapping);
    $this->assertArrayHasKey('asu_sparkles_questions', $mapping);
  }

  /**
   * Preprocess emits menu_links and drops invalid/empty rows.
   */
  public function testPreprocessEmitsMenuLinksAndDropsEmptyRows(): void {
    $variables = [
      'settings' => [
        'placement' => 'asu_sparkles',
        'asu_sparkles_links' => [
          ['label' => 'FAQ', 'url' => '#faq'],
          ['label' => 'Empty', 'url' => ''],
          ['label' => '', 'url' => '   '],
        ],
      ],
    ];

    asu_ai_chatbot_styles_preprocess_ai_deepchat($variables);

    $this->assertArrayHasKey('menu_links', $variables);
    $this->assertArrayHasKey('menu_popover_id', $variables);
    // Only the '#faq' row survives.
    $this->assertCount(1, $variables['menu_links']);
    $this->assertSame('#faq', $variables['menu_links'][0]['href']);
    $this->assertFalse($variables['menu_links'][0]['external']);
  }

}
