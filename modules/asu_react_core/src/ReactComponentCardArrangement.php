<?php

namespace Drupal\asu_react_core;

/**
 * Builds the drupalSettings payload for the Card Arrangement block.
 */
class ReactComponentCardArrangement implements ReactComponent {

  /**
   * Column value used when a single card should span the full width.
   */
  const COLUMNS_FULL_WIDTH = 'one-column';

  /**
   * Column value that is downgraded to full width for single-card groups.
   */
  const COLUMNS_TWO = 'two-columns';

  /**
   * Column value used when the field is empty.
   */
  const COLUMNS_DEFAULT = 'three-columns';

  /**
   *
   */
  public function buildSettings(&$variables) {
    $block = $variables['content']['#block_content'];
    $helper_functions = \Drupal::service('asu_react_core.helper_functions');

    $block_uuid = $block->uuid();
    $card_arrangement = new \stdClass();
    $card_arrangement->cards = [];
    $card_arrangement->layout = $variables['content']['#view_mode'] == 'landscape' ? 'vertical' : 'auto';

    // Get heading information.
    if ($block->field_heading && $block->field_heading->value) {
      $card_arrangement->heading = $block->field_heading->value;
    }

    // Get text color.
    if ($block->field_text_color && $block->field_text_color->value) {
      $card_arrangement->textColor = $block->field_text_color->value;
    }

    // Get formatted text.
    if ($block->field_formatted_text && $block->field_formatted_text->value) {
      $card_arrangement->text = $block->field_formatted_text->value;
    }

    if ($block->field_card_group && $block->field_card_group->entity) {
      foreach ($block->field_card_group->entity->field_cards as $paragraph_ref) {
        $paragraph = $paragraph_ref->entity;
        $card_data = $helper_functions->getCardContent($paragraph);

        if (isset($card_data['components']['card'])) {
          $card_uuid = $paragraph->uuid();
          $card = $card_data['components']['card'][$card_uuid];

          // Add display orientation to card data.
          $card->horizontal = $block->field_display_orientation->value == 'horizontal';

          $card_arrangement->cards[] = $card;
        }
      }
    }

    // The column count depends on how many cards were actually built, so it is
    // resolved after the loop above.
    $card_arrangement->columns = $this->resolveColumns($block, count($card_arrangement->cards));

    $settings = [];
    $settings['components'][$block->bundle()][$block_uuid] = $card_arrangement;
    $variables['content']['#attached']['drupalSettings']['asu'] = $settings;
    $variables['content']['#attached']['library'][] = 'asu_react_core/card-arrangement';
  }

  /**
   * Resolves the column value passed to the Unity Card Arrangement component.
   *
   * Arrangements that were authored as "Two Columns" but only contain a single
   * card are rendered full width. Doing this at render time means the fix
   * applies to existing content on every site without editing any stored
   * block_content values.
   *
   * Horizontal cards are excluded because the upstream Unity component
   * hardcodes their grid classes and ignores the columns prop.
   *
   * @param \Drupal\block_content\BlockContentInterface $block
   *   The card arrangement block content entity.
   * @param int $card_count
   *   Number of cards that were added to the arrangement.
   *
   * @return string
   *   The column value to expose in drupalSettings.
   */
  protected function resolveColumns($block, int $card_count): string {
    $columns = $block->field_card_arrangement_display->value ?: self::COLUMNS_DEFAULT;
    $is_horizontal = $block->field_display_orientation->value === 'horizontal';

    if (!$is_horizontal && $card_count === 1 && $columns === self::COLUMNS_TWO) {
      return self::COLUMNS_FULL_WIDTH;
    }

    return $columns;
  }

}
