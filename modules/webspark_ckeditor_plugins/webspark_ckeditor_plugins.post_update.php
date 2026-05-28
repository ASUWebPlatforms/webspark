<?php

use Drupal\editor\Entity\Editor;

/**
 * MYMODULE_post_update_DESCRIPTION() function to ensure elements changes are
 * reflected in filter_html settings. post_update allows for full access to
 * APIs.
 *
 * See https://www.drupal.org/docs/drupal-apis/ckeditor-5-api/overview#post-update
 * and https://api.drupal.org/api/drupal/core%21lib%21Drupal%21Core%21Extension%21module.api.php/function/hook_post_update_NAME/10
 */

/**
 * Enable full use of class attributes on table cells for
 * webspark_ckeditor_plugins - WS2-2775.
 *
 * @return void
 */
function webspark_ckeditor_plugins_post_update_1() {
  _ckeditor5_plugin_supports_more_elements_append_to_filter_html_settings('webspark_ckeditor_plugins_plugins', '<th rowspan colspan class> <td rowspan colspan class>');
}

/**
 * Expands filter_html allowed tags for CKE5 plugin that supports more HTML.
 *
 * @param string $cke5_plugin_id
 *   The CKEditor 5 plugin ID which supports more HTML after an update.
 * @param string $allowed_html_to_append
 *   The string to append to `filter_html`'s `allowed_html` setting.
 */
function _ckeditor5_plugin_supports_more_elements_append_to_filter_html_settings(string $cke5_plugin_id, string $allowed_html_to_append) {
  $cke5_plugin_manager = \Drupal::service('plugin.manager.ckeditor5.plugin');
  assert($cke5_plugin_manager instanceof \Drupal\ckeditor5\Plugin\CKEditor5PluginManagerInterface);

  // 1. Determine which text editors use the updated CKEditor 5 plugin.
  $affected_editors = [];
  foreach (Editor::loadMultiple() as $editor) {
    // Text editors not using CKEditor 5 cannot be affected.
    if ($editor->getEditor() !== 'ckeditor5') {
      continue;
    }
    // Ask the plugin manager which CKEditor 5 plugins are enabled; this works
    // for every plugin, no matter if they have toolbar items or not, conditions
    // or not, et cetera.
    $enabled_cke5_plugin_ids = array_keys($cke5_plugin_manager->getEnabledDefinitions($editor));
    if (in_array($cke5_plugin_id, $enabled_cke5_plugin_ids, TRUE)) {
      $affected_editors[] = $editor;
    }
  }

  // 2. Update the corresponding text formats' `filter_html` configuration, if
  // they are using that filter plugin.
  foreach ($affected_editors as $editor) {
    $format = $editor->getFilterFormat();
    // Text formats not using `filter_html` filter do not need to be updated.
    if (!$format->filters('filter_html')->status) {
      continue;
    }
    // Append to "Allowed HTML tags" setting.
    $filter_html_config = $format->filters('filter_html')->getConfiguration();
    $filter_html_config['settings']['allowed_html'] .= ' ' . trim($allowed_html_to_append);
    $format->setFilterConfig('filter_html', $filter_html_config);
    // Save updated text format.
    $format->save();
  }
}
