<?php

/**
 * @file
 */

use Drupal\ckeditor5\Plugin\CKEditor5PluginManagerInterface;
use Drupal\editor\Entity\Editor;
use Drupal\filter\Entity\FilterFormat;

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
 * Enable aria-label attribute on anchor tags for
 * webspark_ckeditor_plugins - WS2-2921.
 *
 * @return void
 */
function webspark_ckeditor_plugins_post_update_2() {
  _ckeditor5_plugin_supports_more_elements_append_to_filter_html_settings('webspark_ckeditor_plugins_plugins', '<a aria-label class target role name hreflang>');
}

/**
 * Enable reversed numbered lists and the explicit start filter.
 *
 * Turns on the CKEditor 5 reversed and start controls for Basic HTML, allows
 * the matching attributes through filter_html, and enables the
 * webspark_reversed_list_start output filter on Basic HTML and Full HTML.
 *
 * The filter is needed on both formats. Without an explicit start attribute a
 * browser has to derive a reversed list's first number at layout time, and
 * Chromium resolves that incorrectly when the number is drawn from generated
 * content, as the UDS list styles do. Full HTML already shipped with the
 * reversed control enabled, so it is affected too.
 */
function webspark_ckeditor_plugins_post_update_3() {
  $filter_config = [
    'id' => 'webspark_reversed_list_start',
    'provider' => 'webspark_ckeditor_plugins',
    'status' => TRUE,
    // Must run after filter_html, which sits at -50 and would otherwise strip
    // the start attribute this filter adds.
    'weight' => 0,
    'settings' => [],
  ];

  // 1. Text formats. Done before the editor so that the attributes are already
  // allowed when the editor's list properties are switched on, which CKEditor 5
  // validates against the format's HTML restrictions.
  foreach (['basic_html', 'full_html'] as $format_id) {
    $format = FilterFormat::load($format_id);

    if (!$format) {
      continue;
    }

    // Formats without filter_html impose no restrictions, so there is nothing
    // to widen there.
    if ($format->filters('filter_html')->status) {
      $html_config = $format->filters('filter_html')->getConfiguration();
      $allowed = $html_config['settings']['allowed_html'];

      if (!str_contains($allowed, '<ol class reversed start>')) {
        if (str_contains($allowed, '<ol class>')) {
          $allowed = str_replace('<ol class>', '<ol class reversed start>', $allowed);
        }
        else {
          // A site has customised the ol rule. Append rather than guess: the
          // filter merges repeated rules for the same tag.
          $allowed .= ' <ol reversed start>';
        }

        $html_config['settings']['allowed_html'] = $allowed;
        $format->setFilterConfig('filter_html', $html_config);
      }
    }

    $format->setFilterConfig('webspark_reversed_list_start', $filter_config);
    $format->save();
  }

  // 2. Editors. Full HTML already ships with these properties enabled.
  $editor = Editor::load('basic_html');

  if ($editor && $editor->getEditor() === 'ckeditor5') {
    $settings = $editor->getSettings();

    if (isset($settings['plugins']['ckeditor5_list']['properties'])) {
      $settings['plugins']['ckeditor5_list']['properties']['reversed'] = TRUE;
      $settings['plugins']['ckeditor5_list']['properties']['startIndex'] = TRUE;
      $editor->setSettings($settings);
      $editor->save();
    }
  }
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
  assert($cke5_plugin_manager instanceof CKEditor5PluginManagerInterface);

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
