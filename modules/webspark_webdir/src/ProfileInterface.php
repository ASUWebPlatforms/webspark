<?php

declare(strict_types=1);

namespace Drupal\webspark_webdir;

use Drupal\Core\Entity\ContentEntityInterface;
use Drupal\Core\Entity\EntityChangedInterface;
use Drupal\user\EntityOwnerInterface;

/**
 * Provides an interface for the profile entity type.
 */
interface ProfileInterface extends ContentEntityInterface, EntityOwnerInterface, EntityChangedInterface {

}
