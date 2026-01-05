<?php

namespace Drupal\webspark\Drush\Commands;

use Drush\Attributes as CLI;
use Drush\Commands\DrushCommands;

/**
 * A Drush commandfile.
 */
final class WebsparkCommands extends DrushCommands {

  /**
   * Sync webspark dependencies to root location.
   */
  #[CLI\Command(name: 'webspark:sync-dependencies', aliases: ['wsd'])]
  #[CLI\Usage(name: 'webspark:sync-dependencies', description: 'Sync sample-webspark-dependencies with the root-level webspark-dependencies.')]
  public function syncDependencies() {
    $source = DRUPAL_ROOT . '/profiles/contrib/webspark/sample-webspark-dependencies/';
    $destination = dirname(DRUPAL_ROOT) . '/webspark-dependencies/';

    // Check if destination directory exists, if not create it.
    if (!is_dir($destination)) {
      $this->logger()->notice(dt('Destination directory does not exist. Creating now.'));
      if (!mkdir($destination, 0755, true) && !is_dir($destination)) {
        throw new \RuntimeException(sprintf('Directory "%s" was not created', $destination));
      }
    }

    // use rsync to sync the two directories.
    exec(sprintf('rsync -av --delete %s %s', escapeshellarg($source), escapeshellarg($destination)));
    // use sed to replace incorrect namespaces.
    exec(sprintf('find %s -type f -name "*.php" -exec sed -i "s/namespace SampleWebsparkCustomScripts;/namespace WebsparkCustomScripts;/g" {} \;', escapeshellarg($destination)));
    $this->logger()->success(dt('Webspark dependencies directory synced successfully.'));
  }

  /**
   * Create custom dependencies directory at root location.
   */
  #[CLI\Command(name: 'webspark:create-custom', aliases: ['wcc'])]
  #[CLI\Usage(name: 'webspark:create-custom', description: 'Create custom-dependencies directory from sample-custom-dependencies.')]
  public function createCustom() {
    $source = DRUPAL_ROOT . '/profiles/contrib/webspark/sample-custom-dependencies/';
    $destination = dirname(DRUPAL_ROOT) . '/custom-dependencies/';

    // Check if destination directory exists, if so, exit.
    if (is_dir($destination)) {
      $this->logger()->warning(dt('Destination directory already exists. Aborting to prevent overwriting existing files.'));
      return;
    }

    // use rsync to sync the two directories.
    exec(sprintf('rsync -av --delete %s %s', escapeshellarg($source), escapeshellarg($destination)));
    $this->logger()->success(dt('Custom dependencies directory created successfully.'));
  }

  /**
   * Delete existing webspark profile, theme, and modules directories.
   */
  #[CLI\Command(name: 'webspark:delete-old-directories', aliases: ['wdod'])]
  #[CLI\Usage(name: 'webspark:delete-old-directories', description: 'Delete outdated webspark profile, theme, and modules directories.')]
  public function deleteWebsparkDirectories() {
    $profileDir = DRUPAL_ROOT . '/profiles/webspark/';
    $themeDir = DRUPAL_ROOT . '/themes/webspark/renovation/';
    $modulesDir = DRUPAL_ROOT . '/modules/webspark/';

    if (!is_dir($profileDir)) {
      $this->logger()->notice(dt('The old profile directory has already been deleted.'));
    }
    else {
      exec(sprintf('rm -rf %s', escapeshellarg($profileDir)));
      $this->logger()->success(dt('The old profile directory was removed successfully.'));
    }
    if (!is_dir($themeDir)) {
      $this->logger()->notice(dt('The old theme directory has already been deleted.'));
    }
    else {
      exec(sprintf('rm -rf %s', escapeshellarg($themeDir)));
      $this->logger()->success(dt('The old theme directory was removed successfully.'));
    }
    if (!is_dir($modulesDir)) {
      $this->logger()->notice(dt('The old modules directory has already been deleted.'));
    }
    else {
      exec(sprintf('rm -rf %s', escapeshellarg($modulesDir)));
      $this->logger()->success(dt('The old modules directory was removed successfully.'));
    }
  }

}
