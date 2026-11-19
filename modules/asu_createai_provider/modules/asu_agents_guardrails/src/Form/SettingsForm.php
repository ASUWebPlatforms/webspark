<?php

namespace Drupal\asu_agents_guardrails\Form;

use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Configures rate limits for ai_agents' write-capable tools.
 */
class SettingsForm extends ConfigFormBase {

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'asu_agents_guardrails_settings_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return ['asu_agents_guardrails.settings'];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $config = $this->config('asu_agents_guardrails.settings');

    $form['write_limit'] = [
      '#type' => 'number',
      '#title' => $this->t('Guarded-tool executions allowed per window, per user'),
      '#description' => $this->t('Applies to the write-capable ai_agents tools (Taxonomy, Content Type, Field agents).'),
      '#default_value' => $config->get('write_limit'),
      '#min' => 1,
      '#max' => 1000,
      '#required' => TRUE,
    ];
    $form['write_window'] = [
      '#type' => 'number',
      '#title' => $this->t('Window, in seconds'),
      '#default_value' => $config->get('write_window'),
      '#min' => 1,
      '#max' => 86400,
      '#required' => TRUE,
    ];

    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $this->config('asu_agents_guardrails.settings')
      ->set('write_limit', (int) $form_state->getValue('write_limit'))
      ->set('write_window', (int) $form_state->getValue('write_window'))
      ->save();

    parent::submitForm($form, $form_state);
  }

}
