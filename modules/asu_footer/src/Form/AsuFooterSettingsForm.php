<?php

namespace Drupal\asu_footer\Form;

use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Class AsuFooterSettingsForm.
 */
class AsuFooterSettingsForm extends ConfigFormBase {

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return [
      'asu_footer.settings',
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'asu_footer_settings_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $config = $this->config('asu_footer.settings');

    $form['footer_settings'] = [
      '#type' => 'details',
      '#title' => $this->t('ASU Footer Global Settings'),
      '#open' => TRUE,
    ];

    $form['footer_settings']['footer_enabled'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable ASU Footer globally'),
      '#description' => $this->t('When enabled, the ASU Footer will be available for use in blocks.'),
      '#default_value' => $config->get('footer_enabled') ?? TRUE,
    ];

    $form['footer_settings']['footer_debug'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable footer debug mode'),
      '#description' => $this->t('When enabled, additional debug information will be logged for the footer component.'),
      '#default_value' => $config->get('footer_debug') ?? FALSE,
    ];

    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    parent::submitForm($form, $form_state);

    $this->config('asu_footer.settings')
      ->set('footer_enabled', $form_state->getValue('footer_enabled'))
      ->set('footer_debug', $form_state->getValue('footer_debug'))
      ->save();
  }

}
