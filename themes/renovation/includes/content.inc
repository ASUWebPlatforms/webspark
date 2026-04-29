<?php
/**
 * @file
 * Theme and preprocess functions for nodes.
 */

/**
 * Implements hook_preprocess_HOOK().
 */
function renovation_preprocess_onecol_article_hero_section(&$variables) {
  // Removes the header style field from the render array and adds a variable for the size.
  /** @var \Drupal\node\Entity\Node $node */
  $content_items = $variables['content']['first'];
  foreach($content_items as $key => $content_item) {
    if (isset($content_item['#plugin_id']) && $content_item['#plugin_id'] == 'field_block:node:article:field_header_style') {
      $variables['hero_style'] = $content_item['content'][0][0]['#markup'] == 'default' ? '' : $content_item['content'][0][0]['#markup'];
      unset($variables['content']['first'][$key]);
    }
  }
}

/**
 * Implements hook_preprocess_HOOK().
 */
function renovation_preprocess_media_oembed_iframe(array &$variables) {
  if (!empty($variables['resource']) && !empty($variables['resource']->getTitle())) {
    $variables['oembed_iframe_title'] = $variables['resource']->getTitle();
  }
  else {
    $variables['oembed_iframe_title'] = 'OEmbed Iframe';
  }
}
