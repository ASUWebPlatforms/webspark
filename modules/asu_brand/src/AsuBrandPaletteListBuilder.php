<?php

namespace Drupal\asu_brand;

use Drupal\asu_brand\Entity\AsuBrandPalette;
use Drupal\Core\Config\Entity\ConfigEntityListBuilder;
use Drupal\Core\Entity\EntityInterface;

/**
 * Lists the unbranded palettes with color swatches.
 */
class AsuBrandPaletteListBuilder extends ConfigEntityListBuilder {

  /**
   * {@inheritdoc}
   */
  public function buildHeader() {
    $header['label'] = $this->t('Palette');
    $header['colors'] = $this->t('Colors');
    $header['status'] = $this->t('Status');
    return $header + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity) {
    /** @var \Drupal\asu_brand\Entity\AsuBrandPalette $entity */
    $row['label'] = $entity->label();

    $swatches = [];
    foreach (AsuBrandPalette::TOKENS as $token => $variable) {
      $value = $entity->getColorValue($token) ?? '#000000';
      $swatches[] = [
        '#type' => 'inline_template',
        '#template' => '<span title="{{ title }}" style="display:inline-block;width:22px;height:22px;border-radius:3px;border:1px solid #ccc;margin-right:4px;vertical-align:middle;background-color:{{ color }}"></span>',
        '#context' => [
          'color' => $value,
          'title' => ($entity->getColorLabel($token) ?: $token) . ' (' . $value . ')',
        ],
      ];
    }
    $row['colors']['data'] = $swatches;

    $row['status'] = $entity->isActive() ? $this->t('Active') : '';
    return $row + parent::buildRow($entity);
  }

  /**
   * {@inheritdoc}
   */
  public function render() {
    $build = parent::render();
    $build['table']['#empty'] = $this->t('No palettes yet. <a href=":add">Add one</a>, then activate it on the <a href=":url">ASU Brand settings</a> page.', [
      ':add' => '/admin/config/asu_brand/palettes/add',
      ':url' => '/admin/config/asu_brand/settings',
    ]);
    return $build;
  }

}
