<?php

namespace Drupal\asu_brand\Form;

use Drupal\asu_brand\Entity\AsuBrandPalette;
use Drupal\asu_brand\PaletteCssGenerator;
use Drupal\Component\Utility\Color;
use Drupal\Core\Entity\EntityForm;
use Drupal\Core\Form\FormStateInterface;

/**
 * Add/edit form for unbranded palettes.
 */
class AsuBrandPaletteForm extends EntityForm {

  /**
   * Text color each token carries in the compiled stylesheet.
   *
   * The unbranded base is compiled with ASU-like luminance, so it bakes white
   * text on maroon/dark tokens and black text on gold (buttons, badges,
   * backgrounds). A palette must keep that contrast to stay accessible.
   */
  protected const TEXT_ON = [
    'maroon' => [255, 255, 255],
    'gold' => [0, 0, 0],
    'dark_maroon' => [255, 255, 255],
    'dark_gold' => [255, 255, 255],
  ];

  /**
   * WCAG 2 AA contrast ratio for normal text.
   */
  protected const MIN_CONTRAST = 4.5;

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state) {
    $form = parent::form($form, $form_state);
    /** @var \Drupal\asu_brand\Entity\AsuBrandPalette $palette */
    $palette = $this->entity;

    $form['label'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Palette name'),
      '#default_value' => $palette->label(),
      '#required' => TRUE,
      '#maxlength' => 64,
    ];
    $form['id'] = [
      '#type' => 'machine_name',
      '#default_value' => $palette->id(),
      '#machine_name' => [
        'exists' => '\Drupal\asu_brand\Entity\AsuBrandPalette::load',
        'source' => ['label'],
      ],
      '#disabled' => !$palette->isNew(),
    ];

    $form['colors'] = [
      '#type' => 'table',
      '#header' => [
        $this->t('UDS variable'),
        $this->t('Replacement color'),
        $this->t('Editor label'),
      ],
    ];
    $descriptions = [
      'maroon' => $this->t('Primary brand color (replaces ASU maroon).'),
      'gold' => $this->t('Accent color: buttons, highlights (replaces ASU gold).'),
      'dark_maroon' => $this->t('Darker shade of the primary color.'),
      'dark_gold' => $this->t('Darker shade of the accent color.'),
    ];
    foreach (AsuBrandPalette::TOKENS as $token => $variable) {
      $form['colors'][$token]['token'] = [
        '#type' => 'item',
        '#markup' => '<code>' . $variable . '</code>',
        '#description' => $descriptions[$token] ?? '',
      ];
      $form['colors'][$token]['value'] = [
        '#type' => 'color',
        '#title' => $this->t('Color for @variable', ['@variable' => $variable]),
        '#title_display' => 'invisible',
        '#default_value' => $palette->getColorValue($token) ?? '#000000',
        '#required' => TRUE,
      ];
      $form['colors'][$token]['label'] = [
        '#type' => 'textfield',
        '#title' => $this->t('Label for @variable', ['@variable' => $variable]),
        '#title_display' => 'invisible',
        '#description' => $this->t('Shown to editors in component color options.'),
        '#default_value' => $palette->getColorLabel($token) ?? '',
        '#required' => TRUE,
        '#maxlength' => 32,
      ];
    }

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state) {
    parent::validateForm($form, $form_state);
    foreach (self::TEXT_ON as $token => $text) {
      // The color element has already validated and normalized the value;
      // skip tokens it rejected so only one error shows per field.
      $value = (string) $form_state->getValue(['colors', $token, 'value']);
      if (!Color::validateHex($value)) {
        continue;
      }
      $ratio = $this->contrast(PaletteCssGenerator::hexToRgb($value), $text);
      if ($ratio < self::MIN_CONTRAST) {
        $form_state->setErrorByName("colors][$token][value", $this->t('@variable (@color) has a contrast of @ratio:1 against the @text text it is shown with; at least @min:1 is required. Use a @tone color.', [
          '@variable' => AsuBrandPalette::TOKENS[$token],
          '@color' => $value,
          '@ratio' => number_format($ratio, 2),
          '@text' => $text[0] ? $this->t('white') : $this->t('black'),
          '@min' => self::MIN_CONTRAST,
          '@tone' => $text[0] ? $this->t('darker') : $this->t('lighter'),
        ]));
      }
    }
  }

  /**
   * WCAG 2 contrast ratio between two [r, g, b] colors.
   */
  protected function contrast(array $a, array $b): float {
    $luminance = static function (array $rgb): float {
      $l = array_map(static function ($c) {
        $c /= 255;
        return $c <= 0.03928 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
      }, $rgb);
      return 0.2126 * $l[0] + 0.7152 * $l[1] + 0.0722 * $l[2];
    };
    $la = $luminance($a);
    $lb = $luminance($b);
    return (max($la, $lb) + 0.05) / (min($la, $lb) + 0.05);
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state) {
    /** @var \Drupal\asu_brand\Entity\AsuBrandPalette $palette */
    $palette = $this->entity;
    // Normalize the table values into the colors map.
    $colors = [];
    foreach (array_keys(AsuBrandPalette::TOKENS) as $token) {
      $row = $form_state->getValue(['colors', $token]);
      $colors[$token] = [
        'value' => strtolower($row['value']),
        'label' => $row['label'],
      ];
    }
    $palette->set('colors', $colors);

    $status = $palette->save();
    $args = [
      '%label' => $palette->label(),
      ':url' => '/admin/config/asu_brand/settings',
    ];
    $this->messenger()->addStatus($status === SAVED_NEW
      ? $this->t('Palette %label created. Activate it on the <a href=":url">ASU Brand settings</a> page.', $args)
      : $this->t('Palette %label updated.', $args));
    $form_state->setRedirectUrl($palette->toUrl('collection'));
    return $status;
  }

}
