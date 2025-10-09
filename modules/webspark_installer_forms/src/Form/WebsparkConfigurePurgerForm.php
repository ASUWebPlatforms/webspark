<?php

namespace Drupal\webspark_installer_forms\Form;

use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Provides the Acquia Purge configuration form.
 */
class WebsparkConfigurePurgerForm extends ConfigFormBase {

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return [];
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'webspark_install_configure_purger_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $form['#title'] = $this->t('Webspark Config: Acquia Purger Configuration');

    $form['actions'] = ['#type' => 'actions'];
    $form['description'] = [
      '#type' => 'markup',
      '#markup' => $this->t('This task will install and configure the Acquia
        Purger settings for Webspark. This will enable the purging of external
        Varnish caches when your site content is updated.'),
    ];
    $form['actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Save and continue'),
      '#weight' => 15,
      '#button_type' => 'primary',
    ];

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {

    include_once DRUPAL_ROOT . '/profiles/webspark/webspark/webspark.install';

    // Enable and configure purge modules.
    __webspark_setup_purge();
  }

}
