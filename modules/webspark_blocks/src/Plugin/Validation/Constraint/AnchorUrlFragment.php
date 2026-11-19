<?php

namespace Drupal\webspark_blocks\Plugin\Validation\Constraint;

use Symfony\Component\Validator\Constraint;

/**
 * Validates Anchor Menu URL fragments.
 *
 * @Constraint(
 *   id = "AnchorUrlFragment",
 *   label = @Translation("Anchor URL fragment", context = "Validation"),
 *   type = "string"
 * )
 */
class AnchorUrlFragment extends Constraint {

  /**
   * Checks whether a value matches the supported Anchor Menu format.
   *
   * @param mixed $fragment
   *   The fragment value to check.
   *
   * @return bool
   *   TRUE if the value is a valid fragment, FALSE otherwise.
   */
  public static function isValid($fragment): bool {
    return is_string($fragment) && preg_match(
      '/\A[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?\z/D',
      $fragment
    ) === 1;
  }

  /**
   * Merges incoming and latest-revision alias history.
   *
   * @param string $current_fragment
   *   The fragment being saved.
   * @param string $latest_fragment
   *   The fragment on the latest saved revision.
   * @param string[] $incoming_aliases
   *   Aliases on the revision being saved.
   * @param string[] $latest_aliases
   *   Aliases on the latest saved revision.
   *
   * @return string[]
   *   De-duplicated aliases excluding the current fragment.
   */
  public static function mergeHistory(string $current_fragment, string $latest_fragment, array $incoming_aliases, array $latest_aliases): array {
    $aliases = array_merge($incoming_aliases, $latest_aliases);
    if ($latest_fragment !== '' && $latest_fragment !== $current_fragment && self::isValid($latest_fragment)) {
      $aliases[] = $latest_fragment;
    }

    return array_values(array_unique(array_filter($aliases, static function ($alias) use ($current_fragment) {
      return $alias !== $current_fragment && self::isValid($alias);
    })));
  }

  /**
   * The validation message for an invalid fragment.
   *
   * @var string
   */
  public $invalidMessage = 'Enter a fragment of 1 to 64 lowercase letters, numbers, or hyphens. It must start with a letter and cannot end with a hyphen.';

}
