<?php

/**
 * @file
 * Theme and preprocess functions for nodes.
 */

use Drupal\Core\Render\Element;
use Drupal\Core\Url;

/**
 * Implements hook_preprocess_HOOK().
 */
function renovation_preprocess_onecol_article_hero_section(&$variables) {
  // Removes the header style field from the render array and adds a variable for the size.
  /** @var \Drupal\node\Entity\Node $node */
  $content_items = $variables['content']['first'];
  foreach ($content_items as $key => $content_item) {
    if (isset($content_item['#plugin_id']) && $content_item['#plugin_id'] == 'field_block:node:article:field_header_style') {
      $variables['hero_style'] = $content_item['content'][0][0]['#markup'] == 'default' ? '' : $content_item['content'][0][0]['#markup'];
      unset($variables['content']['first'][$key]);
    }
    if (isset($content_item['#plugin_id']) && $content_item['#plugin_id'] == 'field_block:node:article:field_media') {
      $variables['article_hero_image'] = TRUE;
    }
    // Add targeting classes and analytics attributes to each article tag link.
    if (($content_item['#plugin_id'] ?? NULL) === 'field_block:node:article:field_article_tags' && isset($content_item['content'][0])) {
      $attrs = [
        'class' => ['article-tags', 'btn', 'btn-tag', 'btn-tag-alt-gray'],
        'data-ga' => 'Tag Button',
        'data-ga-name' => 'onclick',
        'data-ga-event' => 'link',
        'data-ga-action' => 'click',
        'data-ga-type' => 'internal link',
        'data-ga-region' => 'main content',
      ];
      foreach (Element::children($content_item['content'][0]) as $delta) {
        $item = &$variables['content']['first'][$key]['content'][0][$delta];
        if (is_array($item) && ($item['#type'] ?? NULL) === 'link') {
          $item['#options']['attributes'] = ($item['#options']['attributes'] ?? []) + $attrs;
        }
      }
      unset($item);
    }
    // Get current route name and parameters.
    $current_route_match = \Drupal::routeMatch();
    $current_route = $current_route_match->getRouteName();
    $current_route_params = $current_route_match->getRawParameters()->all();
    if (isset($content_item['#plugin_id']) && $content_item['#plugin_id'] == 'field_block:node:article:field_cta_link' && isset($content_item['content'][0])) {
      $attrs = [
        'class' => ['field-cta-link', 'btn', 'btn-maroon', 'mt-3'],
        'data-ga-name' => 'onclick',
        'data-ga-event' => 'link',
        'data-ga-action' => 'click',
        'data-ga-region' => 'main content',
      ];
      $field = &$variables['content']['first'][$key]['content'][0];
      foreach (Element::children($field) as $delta) {
        $item = &$field[$delta];
        if (is_array($item) && ($item['#type'] ?? NULL) === 'link') {
          $url = $item['#url'] ?? NULL;
          // Hide the link only when it targets the exact current page (same
          // route name and route parameters), e.g. a CTA pointing at the node
          // being viewed. Links to other pages (including <front>) are kept.
          // Using #access rather than unsetting the delta keeps the render
          // array contiguous, since template_preprocess_field() stops
          // collecting items at the first missing delta.
          if ($url instanceof Url && $url->isRouted()
            && $url->getRouteName() === $current_route
            && $url->getRouteParameters() == $current_route_params) {
            $item['#access'] = FALSE;
            continue;
          }
          $item['#options']['attributes'] = ($item['#options']['attributes'] ?? []) + $attrs;
        }
      }
      unset($item);
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
