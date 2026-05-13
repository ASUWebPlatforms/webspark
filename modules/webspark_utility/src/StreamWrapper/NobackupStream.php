<?php

namespace Drupal\webspark_utility\StreamWrapper;

use Drupal\Core\Site\Settings;
use Drupal\Core\StreamWrapper\LocalStream;
use Drupal\Core\StreamWrapper\StreamWrapperInterface;

/**
 * Defines a nobackup:// stream wrapper.
 * Points to the Acquia nobackup directory.
 */
class NobackupStream extends LocalStream {

  /**
   * {@inheritdoc}
   */
  public static function getType() {
    return StreamWrapperInterface::LOCAL_HIDDEN;
  }

  /**
   * {@inheritdoc}
   */
  public function getName() {
    return t('Nobackup directory');
  }

  /**
   * {@inheritdoc}
   */
  public function getDescription() {
    return t('Points to the Acquia nobackup directory outside the web root.');
  }

  /**
   * {@inheritdoc}
   */
  public function getDirectoryPath() {
    $directoryPath = Settings::get('file_nobackup_path');

    if (empty($directoryPath)) {
      throw new \RuntimeException('The file_nobackup_path setting must be configured.');
    }

    return $directoryPath;
  }

  /**
   * {@inheritdoc}
   */
  public function getExternalUrl() {
    throw new \RuntimeException('External URLs are not supported.');
  }

}
