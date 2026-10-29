<?php

namespace Drupal\asu_brand\Entity;

use Drupal\Core\Config\Entity\ConfigEntityBase;
use Drupal\Core\Entity\EntityStorageInterface;

/**
 * Defines the Unbranded palette config entity.
 *
 * A palette maps the four UDS brand color tokens to site-chosen replacement
 * colors (plus an editorial label per color). The active palette is applied
 * by generating a copy of the sentinel-compiled unbranded stylesheet with
 * the sentinel values replaced (see PaletteCssGenerator).
 *
 * @ConfigEntityType(
 *   id = "asu_brand_palette",
 *   label = @Translation("Unbranded palette"),
 *   label_collection = @Translation("Unbranded palettes"),
 *   label_singular = @Translation("unbranded palette"),
 *   label_plural = @Translation("unbranded palettes"),
 *   handlers = {
 *     "list_builder" = "Drupal\asu_brand\AsuBrandPaletteListBuilder",
 *     "form" = {
 *       "add" = "Drupal\asu_brand\Form\AsuBrandPaletteForm",
 *       "edit" = "Drupal\asu_brand\Form\AsuBrandPaletteForm",
 *       "delete" = "Drupal\Core\Entity\EntityDeleteForm"
 *     },
 *     "route_provider" = {
 *       "html" = "Drupal\Core\Entity\Routing\AdminHtmlRouteProvider"
 *     }
 *   },
 *   config_prefix = "palette",
 *   admin_permission = "use unbranded webspark",
 *   entity_keys = {
 *     "id" = "id",
 *     "label" = "label"
 *   },
 *   config_export = {
 *     "id",
 *     "label",
 *     "colors"
 *   },
 *   links = {
 *     "collection" = "/admin/config/asu_brand/palettes",
 *     "add-form" = "/admin/config/asu_brand/palettes/add",
 *     "edit-form" = "/admin/config/asu_brand/palettes/{asu_brand_palette}",
 *     "delete-form" = "/admin/config/asu_brand/palettes/{asu_brand_palette}/delete"
 *   }
 * )
 */
class AsuBrandPalette extends ConfigEntityBase {

  /**
   * The UDS brand color tokens a palette must define.
   *
   * Keys are the token machine names used in the colors map; values are the
   * human-readable names of the UDS SCSS variables they replace.
   */
  public const TOKENS = [
    'maroon' => '$uds-color-base-maroon',
    'gold' => '$uds-color-base-gold',
    'dark_maroon' => '$uds-color-base-darkmaroon',
    'dark_gold' => '$uds-color-base-darkgold',
  ];

  /**
   * The palette machine name.
   *
   * @var string
   */
  protected $id;

  /**
   * The palette name.
   *
   * @var string
   */
  protected $label;

  /**
   * Color map: token => ['value' => '#rrggbb', 'label' => 'Editor label'].
   *
   * @var array
   */
  protected $colors = [];

  /**
   * Returns the full color map.
   */
  public function getColors(): array {
    return $this->colors;
  }

  /**
   * Returns the hex value for a token, or NULL when not set.
   */
  public function getColorValue(string $token): ?string {
    return $this->colors[$token]['value'] ?? NULL;
  }

  /**
   * Returns the editorial label for a token, or NULL when not set.
   */
  public function getColorLabel(string $token): ?string {
    return $this->colors[$token]['label'] ?? NULL;
  }

  /**
   * {@inheritdoc}
   */
  public function postSave(EntityStorageInterface $storage, $update = TRUE) {
    parent::postSave($storage, $update);
    // Regenerate this palette's stylesheet so the file always matches config.
    $generator = \Drupal::service('asu_brand.palette_css_generator');
    $generator->generate($this);
    if ($this->isActive()) {
      $generator->invalidateCaches();
    }
  }

  /**
   * {@inheritdoc}
   */
  public static function postDelete(EntityStorageInterface $storage, array $entities) {
    parent::postDelete($storage, $entities);
    $generator = \Drupal::service('asu_brand.palette_css_generator');
    $settings = \Drupal::configFactory()->getEditable('asu_brand.settings');
    $active = $settings->get('asu_brand.asu_brand_active_palette');
    foreach ($entities as $entity) {
      $generator->deleteFiles($entity->id());
      if ($active === $entity->id()) {
        // The active palette is gone: fall back to the default ASU styles.
        $settings->set('asu_brand.asu_brand_active_palette', '')->save();
        $generator->invalidateCaches();
        \Drupal::messenger()->addWarning(t('The active unbranded palette %label was deleted. The site is back on the default ASU colors until another palette is activated.', ['%label' => $entity->label()]));
      }
    }
  }

  /**
   * Whether this palette is the site's active one.
   */
  public function isActive(): bool {
    return \Drupal::config('asu_brand.settings')->get('asu_brand.asu_brand_active_palette') === $this->id();
  }

}
