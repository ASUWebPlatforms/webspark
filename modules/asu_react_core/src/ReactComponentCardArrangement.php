<?php

namespace Drupal\asu_react_core;

class ReactComponentCardArrangement implements ReactComponent {

  public function buildSettings(&$variables) {
    $block = $variables['content']['#block_content'];
    $helper_functions = \Drupal::service('asu_react_core.helper_functions');

    $block_uuid = $block->uuid();
    $card_arrangement = new \stdClass();
    $card_arrangement->cards = [];
    $card_arrangement->columns = $block->field_card_arrangement_display->value ?? 3;
    $card_arrangement->layout = $variables['content']['#view_mode'] == 'landscape' ? 'vertical' : 'auto';

    // Get heading information
    if ($block->field_heading && $block->field_heading->value) {
      $card_arrangement->heading = $block->field_heading->value;
    }

    // Get text color
    if ($block->field_text_color && $block->field_text_color->value) {
      $card_arrangement->textColor = $block->field_text_color->value;
    }

    // Get formatted text
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

          // Add display orientation to card data
          $card->horizontal = $block->field_display_orientation->value == 'horizontal';

          $card_arrangement->cards[] = $card;
        }
      }
    }

    $settings = [];
    $settings['components'][$block->bundle()][$block_uuid] = $card_arrangement;
    $variables['content']['#attached']['drupalSettings']['asu'] = $settings;
    $variables['content']['#attached']['library'][] = 'asu_react_core/card-arrangement';
  }
}
