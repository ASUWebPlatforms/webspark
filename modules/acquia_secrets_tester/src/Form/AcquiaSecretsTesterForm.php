<?php

namespace Drupal\acquia_secrets_tester\Form;

use Drupal;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;

class AcquiaSecretsTesterForm extends FormBase
{
  /**
   * {@inheritdoc}
   */
  public function getFormId(): string
  {
    return 'acquia_secrets_tester_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array
  {
    $form['description'] = [
      '#type' => 'markup',
      '#markup' => $this->t('Get values for needed secrets.'),
    ];
    $form['names'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Secret names'),
      '#description' => $this->t('Comma separated list of names.'),
    ];
    $form['actions']['#type'] = 'actions';
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Process'),
      '#button_type' => 'primary',
    ];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): array
  {
    $names = array_map('trim', explode(',', $form_state->getValue('names')));
    $data = [];

    $settings = Drupal::service('settings');

    foreach ($names as $name) {
      if (empty($settings->get($name))) {
        $data[$name] = false;
      } else {
        $data[$name] = true;
      }
    }

    dpm($data);
    exit;
  }
}
