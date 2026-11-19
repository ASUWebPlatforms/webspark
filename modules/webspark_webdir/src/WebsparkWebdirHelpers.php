<?php

namespace Drupal\webspark_webdir;

/**
 * Class WebsparkWebdirHelpers.php.
 */
class WebsparkWebdirHelpers {

  /**
   * Gets the public path to the bundled application assets.
   */
  public function getAppPathFolder() {
    $module_handler = \Drupal::service('module_handler');
    $path_module = $module_handler->getModule('webspark_webdir')->getPath();
    $appPathFolder = base_path() . $path_module . '/dist/assets';
    return $appPathFolder;
  }

}
