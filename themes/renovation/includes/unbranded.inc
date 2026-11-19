<?php

/**
 * @file
 * WS2-2964 unbranded mode hooks.
 *
 * WS2-3129: unbranded mode is driven by the asu_brand module setting
 * (asu_brand.settings: asu_brand.asu_brand_unbranded_enabled, permission
 * gated at /admin/config/asu_brand/settings) so a single per-site switch
 * controls the palette, the header and the footer. Palettes and the active
 * palette are managed by the asu_brand module, not the theme.
 *
 * The unbranded palette stylesheet swap lives in the asu_brand module
 * (asu_brand_library_info_alter()), not here: a theme's library_info_alter()
 * only fires when that theme is active, which breaks the Layout Builder
 * off-canvas AJAX (rendered under the admin theme). This file keeps only the
 * body class.
 */

/**
 * Implements hook_preprocess_HOOK() for html.html.twig.
 *
 * Marker class only — the unbranded stylesheet does the actual work.
 */
function renovation_preprocess_html(array &$variables) {
  if (\Drupal::config('asu_brand.settings')->get('asu_brand.asu_brand_unbranded_enabled')) {
    $variables['attributes']['class'][] = 'unbranded-mode';
  }
  // React to setting changes without a full cache rebuild.
  $variables['#cache']['tags'][] = 'config:asu_brand.settings';
}
