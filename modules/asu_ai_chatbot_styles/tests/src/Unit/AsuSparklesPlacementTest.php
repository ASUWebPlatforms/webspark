<?php

declare(strict_types=1);

namespace Drupal\Tests\asu_ai_chatbot_styles\Unit;

use Drupal\block\BlockInterface;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Entity\EntityFormInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Tests\UnitTestCase;

/**
 * Tests the asu_sparkles placement registration in the .module file.
 *
 * @group asu_ai_chatbot_styles
 */
class AsuSparklesPlacementTest extends UnitTestCase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    require_once __DIR__ . '/../../../asu_ai_chatbot_styles.module';

    // The .module uses t(); wire a translation stub into the container.
    $container = new ContainerBuilder();
    $container->set('string_translation', $this->getStringTranslationStub());
    \Drupal::setContainer($container);
  }

  /**
   * The theme hook for the bespoke template is registered.
   */
  public function testThemeHookIsRegistered(): void {
    $theme = asu_ai_chatbot_styles_theme();

    $this->assertArrayHasKey('ai_deepchat__asu_sparkles', $theme);
    $hook = $theme['ai_deepchat__asu_sparkles'];
    $this->assertArrayHasKey('variables', $hook);
    foreach (['settings', 'deepchat_settings', 'current_theme', 'preset_questions'] as $variable) {
      $this->assertArrayHasKey($variable, $hook['variables']);
    }
    // Rev 3: scrim variable must default to FALSE.
    $this->assertSame(FALSE, $hook['variables']['scrim']);
  }

  /**
   * The chips-suggestion theme hook inherits the base ai_deepchat preprocess.
   *
   * Without 'base hook', the theme registry does not merge the base hook's
   * preprocess chain into this suggestion, so
   * asu_ai_chatbot_styles_preprocess_ai_deepchat() never runs for the
   * asu_sparkles placement and the preset-question chips do not render.
   */
  public function testThemeHookDeclaresBaseHook(): void {
    $theme = asu_ai_chatbot_styles_theme();

    $this->assertArrayHasKey('ai_deepchat__asu_sparkles', $theme);
    $this->assertSame(
      'ai_deepchat',
      $theme['ai_deepchat__asu_sparkles']['base hook'] ?? NULL,
      "The 'ai_deepchat__asu_sparkles' theme hook must declare 'base hook' => 'ai_deepchat' so Drupal merges the base-hook preprocess chain into the suggestion."
    );
    // Regression guard: variables and their defaults must remain intact.
    $this->assertArrayHasKey('variables', $theme['ai_deepchat__asu_sparkles']);
    $this->assertSame([], $theme['ai_deepchat__asu_sparkles']['variables']['preset_questions']);
  }

  /**
   * The placement option is added only on the chatbot block form.
   */
  public function testPlacementOptionAddedOnChatbotBlockForm(): void {
    $form = $this->buildBlockForm();
    $form_state = $this->mockFormState(ASU_AI_CHATBOT_STYLES_PLUGIN_ID);

    asu_ai_chatbot_styles_form_block_form_alter($form, $form_state);

    $options = $form['settings']['styling']['placement']['#options'];
    $this->assertArrayHasKey(ASU_AI_CHATBOT_STYLES_PLACEMENT, $options);
    $this->assertSame('ASU sparkles', (string) $options[ASU_AI_CHATBOT_STYLES_PLACEMENT]);

    // Deep Chat sizing fields are restricted to the bottom-* placements.
    $expected = [
      [':input[name="settings[styling][placement]"]' => ['value' => 'bottom-right']],
      [':input[name="settings[styling][placement]"]' => ['value' => 'bottom-left']],
    ];
    $this->assertSame($expected, $form['settings']['styling']['width']['#states']['visible']);
  }

  /**
   * A non-chatbot block form is left untouched.
   */
  public function testOtherBlockFormUntouched(): void {
    $form = $this->buildBlockForm();
    $form_state = $this->mockFormState('some_other_block');

    asu_ai_chatbot_styles_form_block_form_alter($form, $form_state);

    $this->assertArrayNotHasKey(
      ASU_AI_CHATBOT_STYLES_PLACEMENT,
      $form['settings']['styling']['placement']['#options']
    );
  }

  /**
   * Builds a minimal representation of the chatbot block config form.
   */
  private function buildBlockForm(): array {
    $visible = [
      [':input[name="settings[styling][placement]"]' => ['!value' => 'toolbar']],
    ];
    return [
      'settings' => [
        'styling' => [
          'placement' => [
            '#type' => 'select',
            '#options' => [
              'toolbar' => 'Toolbar',
              'bottom-right' => 'Bottom right',
              'bottom-left' => 'Bottom left',
            ],
          ],
          'style_file' => ['#states' => ['visible' => $visible]],
          'width' => ['#states' => ['visible' => $visible]],
          'height' => ['#states' => ['visible' => $visible]],
          'collapse_minimal' => ['#states' => ['visible' => $visible]],
        ],
      ],
    ];
  }

  /**
   * Creates a form state whose block entity has the given plugin ID.
   */
  private function mockFormState(string $plugin_id): FormStateInterface {
    $block = $this->createMock(BlockInterface::class);
    $block->method('getPluginId')->willReturn($plugin_id);
    $block->method('get')->with('settings')->willReturn([]);

    $form_object = $this->createMock(EntityFormInterface::class);
    $form_object->method('getEntity')->willReturn($block);

    $form_state = $this->createMock(FormStateInterface::class);
    $form_state->method('getBuildInfo')->willReturn(['callback_object' => $form_object]);

    return $form_state;
  }

}
