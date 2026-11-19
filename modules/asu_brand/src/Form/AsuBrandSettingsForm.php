<?php

/**
 * @file
 * Conttains Drupal\asu_brand\Form\AsuBrandSettingsForm
 */

namespace Drupal\asu_brand\Form;

use Drupal\Core\Cache\Cache;
use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Configure example settings for this site.
 */
class AsuBrandSettingsForm extends ConfigFormBase {

  /**
   * Config settings.
   *
   * @var string
   */
  const SETTINGS = 'asu_brand.settings'; // Config variable name for module.

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    // Returns the form's unique ID.
    return 'asu_brand_settings';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    // Gets the configuration name.
    return [
      static::SETTINGS,
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    // Build and return the form array.

    // Loads admin settings for this form/module.
    $config = $this->config(static::SETTINGS);

    // Note: asu_brand module provides both global and per-block configs.

    // Global configs

    $form['asu_brand']['asu_brand_instructions'] = [
      '#type' => 'item',
      '#title' => $this->t("About the ASU Brand module"),
      '#description' => $this->t("This module supplies key features for
        maintaining and displaying the ASU brand correctly in your site. It
        bundles the ASU Header and ASU
        Google Tag Manager code into one package. The header is controlled
        and configured through this site's blocks interface. Depending on
        how you installed your site, the ASU global header may already be
        enabled. Google Tag Manager is configured below.
        For most sites, the defaults are recommended."),
    ];
    // GTM enabled
    $form['asu_brand']['asu_brand_gtm_enabled'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable ASU Universal Google Tag Manager'),
      '#default_value' => $config->get('asu_brand.asu_brand_gtm_enabled'),
      '#description' => $this->t("Recommended for all public-facing ASU sites"),
    ];
    // GTM add'l ID - just one additional supported for now.
    $form['asu_brand']['asu_brand_extra_gtm_id'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Custom Google Tag Manager ID (GTM ID)'),
      '#default_value' => $config->get('asu_brand.asu_brand_extra_gtm_id'),
      '#description' => $this->t("By default the ASU Universal GTM ID
        (GTM-KDWN8Z) is used. If you supply an additional GTM ID, another GTM
        container with that new ID will be added to your site's HTML. This
        setting is independent of whether the ASU Universal GTM is enabled."),
    ];
    //Search settings
    $form['asu_brand']['search_config'] = array(
      '#type' => 'fieldset',
      '#title' => $this->t('Search Settings'),
    );
    $form['asu_brand']['search_config']['asu_brand_search_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Search URL'),
      '#default_value' => $config->get('asu_brand.asu_brand_search_url'),
      '#description' => $this->t('URL to use for search in the header. Please don\'t update unless instructed.
        Format should match: https://search.asu.edu/search.'),
    ];
    $form['asu_brand']['search_config']['asu_brand_local_search_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Local Search URL'),
      '#default_value' => $config->get('asu_brand.asu_brand_local_search_url'),
      '#description' => $this->t('If empty, your current site\'s base URL will be used. Optionally, you can override
         with the URL of your choice to be used for scoping local search. Use the format: yourdomain.asu.edu'),
    ];
    // Unbranded Webspark settings. Visible only with the dedicated permission.
    $form['asu_brand']['unbranded'] = [
      '#type' => 'details',
      '#title' => $this->t('Unbranded Webspark'),
      '#open' => TRUE,
      '#access' => $this->currentUser()->hasPermission('use unbranded webspark'),
      '#description' => $this->t('For use only with prior approval. When
        enabled, the ASU header and footer render in unbranded mode.'),
    ];
    $form['asu_brand']['unbranded']['asu_brand_unbranded_enabled'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable Unbranded Webspark'),
      '#default_value' => $config->get('asu_brand.asu_brand_unbranded_enabled'),
    ];
    $palettes = \Drupal::entityTypeManager()->getStorage('asu_brand_palette')->loadMultiple();
    $palette_options = ['' => $this->t('- None (default ASU colors) -')];
    foreach ($palettes as $palette) {
      $palette_options[$palette->id()] = $palette->label();
    }
    $form['asu_brand']['unbranded']['asu_brand_active_palette'] = [
      '#type' => 'select',
      '#title' => $this->t('Active color palette'),
      '#options' => $palette_options,
      '#default_value' => $config->get('asu_brand.asu_brand_active_palette') ?? '',
      '#description' => $this->t('Palette applied to the unbranded site. <a href=":url">Manage palettes</a>.', [':url' => '/admin/config/asu_brand/palettes']),
      '#states' => [
        'visible' => [
          ':input[name="asu_brand_unbranded_enabled"]' => ['checked' => TRUE],
        ],
      ],
    ];
    $form['#attached']['library'][] = 'asu_brand/';
    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    // Process the form submission.

    // Note: Use asu_brand. prefix when handling config values, but not with
    // form_state versions of those values.

    // Removing https:// and http:// for Local Search URL.
    $local_search_url = preg_replace("(^https?://)", "", $form_state->getValue('asu_brand_local_search_url'));

    // The unbranded checkbox is permission-gated (#access): when the editor
    // cannot see it, getValue() returns NULL and the stored flag must survive.
    $unbranded_enabled = $form_state->getValue('asu_brand_unbranded_enabled');
    if ($unbranded_enabled === NULL) {
      $unbranded_enabled = $this->config(static::SETTINGS)->get('asu_brand.asu_brand_unbranded_enabled') ?? 0;
    }
    $active_palette = $form_state->getValue('asu_brand_active_palette');
    if ($active_palette === NULL) {
      $active_palette = $this->config(static::SETTINGS)->get('asu_brand.asu_brand_active_palette') ?? '';
    }

    // Retrieve the configuration.
    $this->configFactory->getEditable(static::SETTINGS)
      // Set the submitted configurations on our config.
      ->set('asu_brand.asu_brand_gtm_enabled', $form_state->getValue('asu_brand_gtm_enabled'))
      ->set('asu_brand.asu_brand_extra_gtm_id', $form_state->getValue('asu_brand_extra_gtm_id'))
      ->set('asu_brand.asu_brand_search_url', $form_state->getValue('asu_brand_search_url'))
      ->set('asu_brand.asu_brand_local_search_url', $local_search_url)
      ->set('asu_brand.asu_brand_unbranded_enabled', (int) $unbranded_enabled)
      ->set('asu_brand.asu_brand_active_palette', (string) $active_palette)
      ->save();

    // Theme-level library alters keyed on the unbranded setting (stylesheet
    // swap in Renovation) live in the cached library registry, which only
    // listens to this tag. Invalidate it so toggling takes effect on save.
    Cache::invalidateTags(['library_info']);

    parent::submitForm($form, $form_state);
  }
}
