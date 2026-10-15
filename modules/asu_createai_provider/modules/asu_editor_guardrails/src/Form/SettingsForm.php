<?php

namespace Drupal\asu_editor_guardrails\Form;

use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Configures rate limits for the ai_ckeditor and ai_automators guardrails.
 */
class SettingsForm extends ConfigFormBase {

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'asu_editor_guardrails_settings_form';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return ['asu_editor_guardrails.settings'];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $config = $this->config('asu_editor_guardrails.settings');

    $form['ckeditor'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('CKEditor AI Assistant'),
      '#description' => $this->t('Rate limit on the ai_ckeditor request endpoint (Generate with AI, Fix spelling, Summarize, etc.).'),
    ];
    $form['ckeditor']['ckeditor_limit'] = [
      '#type' => 'number',
      '#title' => $this->t('Requests allowed per window, per user'),
      '#default_value' => $config->get('ckeditor_limit'),
      '#min' => 1,
      '#max' => 1000,
      '#required' => TRUE,
    ];
    $form['ckeditor']['ckeditor_window'] = [
      '#type' => 'number',
      '#title' => $this->t('Window, in seconds'),
      '#default_value' => $config->get('ckeditor_window'),
      '#min' => 1,
      '#max' => 86400,
      '#required' => TRUE,
    ];

    $form['automator'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('AI Automators'),
      '#description' => $this->t('Rate limits on ai_automators re-triggering AI processing on entity save.'),
    ];
    $form['automator']['automator_cooldown'] = [
      '#type' => 'number',
      '#title' => $this->t('Cooldown between re-triggers for the same entity/field, in seconds'),
      '#default_value' => $config->get('automator_cooldown'),
      '#min' => 1,
      '#max' => 86400,
      '#required' => TRUE,
    ];
    $form['automator']['automator_user_limit'] = [
      '#type' => 'number',
      '#title' => $this->t('Max automator-eligible saves per acting user, per window'),
      '#default_value' => $config->get('automator_user_limit'),
      '#min' => 1,
      '#max' => 1000,
      '#required' => TRUE,
    ];
    $form['automator']['automator_user_window'] = [
      '#type' => 'number',
      '#title' => $this->t('Window, in seconds'),
      '#default_value' => $config->get('automator_user_window'),
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
    $this->config('asu_editor_guardrails.settings')
      ->set('ckeditor_limit', (int) $form_state->getValue('ckeditor_limit'))
      ->set('ckeditor_window', (int) $form_state->getValue('ckeditor_window'))
      ->set('automator_cooldown', (int) $form_state->getValue('automator_cooldown'))
      ->set('automator_user_limit', (int) $form_state->getValue('automator_user_limit'))
      ->set('automator_user_window', (int) $form_state->getValue('automator_user_window'))
      ->save();

    parent::submitForm($form, $form_state);
  }

}
