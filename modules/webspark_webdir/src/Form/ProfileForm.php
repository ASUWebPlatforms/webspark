<?php

declare(strict_types=1);

namespace Drupal\webspark_webdir\Form;

use Drupal\Core\Entity\ContentEntityForm;
use Drupal\Core\Form\FormStateInterface;
use Drupal\webspark_webdir\Service\RemoteProfileFetcher;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Form controller for the profile entity add/edit forms.
 */
final class ProfileForm extends ContentEntityForm {

  /**
   * The remote profile fetcher service.
   *
   * @var \Drupal\webspark_webdir\Service\RemoteProfileFetcher
   */
  protected RemoteProfileFetcher $remoteProfileFetcher;

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    $instance = parent::create($container);
    $instance->remoteProfileFetcher = $container->get('webspark_webdir.remote_profile_fetcher');
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function form(array $form, FormStateInterface $form_state): array {
    $form = parent::form($form, $form_state);

    // Lock the bio field to minimal_format and hide format selector/tips.
    // This must be done before applyProfileTypeStates() moves the field.
    if (isset($form['bio']['widget'][0])) {
      $form['bio']['widget'][0]['#format'] = 'minimal_format';
      $form['bio']['widget'][0]['#allowed_formats'] = ['minimal_format', 'basic_html'];
    }

    // Add the affiliation lookup elements for directory profiles.
    // This must run before applyProfileTypeStates() so the wrapper exists
    // when it gets moved into the remote_fields container.
    $this->addAffiliationElements($form, $form_state);

    // Apply #states to show/hide fields based on profile_type.
    // On edit, use #access since profile_type is hidden and #states won't work.
    if ($this->entity->isNew()) {
      $this->applyProfileTypeStates($form);
    }
    else {
      $this->applyProfileTypeAccess($form);
    }

    // Hide the name field — it's auto-generated from first_name + last_name.
    if (isset($form['name'])) {
      $form['name']['#access'] = FALSE;
    }

    // Disable profile_type on edit (can't change source after creation).
    if (!$this->entity->isNew() && isset($form['profile_type'])) {
      $form['profile_type']['#access'] = FALSE;
    }

    // Add description to the image field.
    if (isset($form['image'])) {
      $form['image']['widget']['#description'] = $this->t('Upload a profile image. You will be able to crop it to a 1:1 rounded shape. Recommended minimum: 300×300px.');
    }

    return $form;
  }

  /**
   * Adds the affiliation lookup button and selector to the form.
   *
   * @param array $form
   *   The form array.
   * @param \Drupal\Core\Form\FormStateInterface $form_state
   *   The form state.
   */
  protected function addAffiliationElements(array &$form, FormStateInterface $form_state): void {
    // Wrapper for AJAX replacement.
    $form['affiliation_wrapper'] = [
      '#type' => 'container',
      '#attributes' => ['id' => 'affiliation-ajax-wrapper'],
      '#weight' => 2,
    ];

    // Build options from stored form_state or from the entity's saved deptid.
    $options = $form_state->get('affiliation_options') ?? [];
    $error_message = $form_state->get('affiliation_error') ?? '';

    // On edit, if we have an asurite for a directory profile, try
    // to fetch affiliations so the user sees the current selection.
    if (empty($options) && !$this->entity->isNew()) {
      $asurite = $this->entity->get('asurite')->value ?? '';
      if (!empty($asurite) && $this->entity->get('profile_type')->value === 'from_directory') {
        $affiliations = $this->remoteProfileFetcher->fetchAffiliations($asurite);
        if ($affiliations) {
          $options = $this->remoteProfileFetcher->buildAffiliationOptions($affiliations);
          $form_state->set('affiliation_options', $options);
        }
      }
    }

    // Determine button label: "Refresh affiliation data" if we already have options.
    $button_label = !empty($options)
      ? $this->t('Refresh affiliation data')
      : $this->t('Look up ASURITE');

    if (!empty($error_message)) {
      $form['affiliation_wrapper']['affiliation_error'] = [
        '#type' => 'markup',
        '#markup' => '<div class="messages messages--error">' . $error_message . '</div>',
        '#weight' => 0,
      ];
    }

    if (!empty($options)) {
      $default_value = $this->entity->get('selected_deptid')->value ?? '';
      // Only fall back to first option if no saved selection exists.
      if (empty($default_value) && count($options) === 1) {
        $default_value = array_key_first($options);
      }
      // Ensure the default matches the option key type (PHP casts numeric
      // string keys to integers in arrays).
      if (is_numeric($default_value) && array_key_exists((int) $default_value, $options)) {
        $default_value = (int) $default_value;
      }

      $form['affiliation_wrapper']['selected_deptid'] = [
        '#type' => 'select',
        '#title' => $this->t('Select affiliation'),
        '#description' => $this->t('Choose which title and department to display for this profile.'),
        '#options' => $options,
        '#default_value' => $default_value,
        '#required' => TRUE,
        '#weight' => 1,
        '#disabled' => count($options) === 1,
      ];
    }

    // Lookup/refresh button — placed after the select field.
    $form['affiliation_wrapper']['lookup_asurite'] = [
      '#type' => 'submit',
      '#value' => $button_label,
      '#submit' => ['::lookupAsuriteSubmit'],
      '#ajax' => [
        'callback' => '::affiliationAjaxCallback',
        'wrapper' => 'affiliation-ajax-wrapper',
      ],
      '#limit_validation_errors' => [],
      '#weight' => 2,
    ];

    // On new forms, show/hide based on profile_type state.
    if ($this->entity->isNew()) {
      $type_selector = ':input[name="profile_type"]';
      $form['affiliation_wrapper']['#states'] = [
        'visible' => [
          $type_selector => ['value' => 'from_directory'],
        ],
      ];
    }
    else {
      // On edit, only show for directory profiles.
      $is_directory = ($this->entity->get('profile_type')->value === 'from_directory');
      $form['affiliation_wrapper']['#access'] = $is_directory;
    }
  }

  /**
   * Submit handler for the "Look up ASURITE" button.
   */
  public function lookupAsuriteSubmit(array &$form, FormStateInterface $form_state): void {
    $input = $form_state->getUserInput();
    // Entity forms use widget format: asurite[0][value].
    $asurite_value = '';
    if (isset($input['asurite'][0]['value'])) {
      $asurite_value = trim($input['asurite'][0]['value']);
    }
    elseif (isset($input['asurite']) && is_string($input['asurite'])) {
      $asurite_value = trim($input['asurite']);
    }

    // Clear previous state.
    $form_state->set('affiliation_options', []);
    $form_state->set('affiliation_error', '');

    if (empty($asurite_value)) {
      $form_state->set('affiliation_error', (string) $this->t('Please enter an ASURITE ID before looking up.'));
      $form_state->setRebuild();
      return;
    }

    $affiliations = $this->remoteProfileFetcher->fetchAffiliations($asurite_value);
    if (empty($affiliations)) {
      $form_state->set('affiliation_error', (string) $this->t('The ASURITE ID "@asurite" was not found in the ASU Directory. Please verify the ID or create a local profile instead.', ['@asurite' => $asurite_value]));
      $form_state->setRebuild();
      return;
    }

    $options = $this->remoteProfileFetcher->buildAffiliationOptions($affiliations);
    if (empty($options)) {
      $form_state->set('affiliation_error', (string) $this->t('No affiliations found for "@asurite". Please create a local profile instead.', ['@asurite' => $asurite_value]));
      $form_state->setRebuild();
      return;
    }

    $form_state->set('affiliation_options', $options);
    $form_state->setRebuild();
  }

  /**
   * AJAX callback to return the affiliation wrapper.
   */
  public function affiliationAjaxCallback(array &$form, FormStateInterface $form_state): array {
    // The wrapper may be at top level or nested inside remote_fields (new form).
    if (isset($form['remote_fields']['affiliation_wrapper'])) {
      return $form['remote_fields']['affiliation_wrapper'];
    }
    return $form['affiliation_wrapper'] ?? [];
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    parent::validateForm($form, $form_state);

    $profile_type = $form_state->getValue('profile_type');

    if (is_array($profile_type)) {
      $profile_type = $profile_type[0]['value'] ?? '';
    }

    if ($profile_type === 'local') {
      // First and Last name fields are required.
      $first_name = $form_state->getValue('first_name');
      $first_value = is_array($first_name) ? ($first_name[0]['value'] ?? '') : $first_name;
      $last_name = $form_state->getValue('display_last_name');
      $last_value = is_array($last_name) ? ($last_name[0]['value'] ?? '') : $last_name;
      if (empty(trim($first_value))) {
        $form_state->setErrorByName('first_name', $this->t('First name field is required.'));
      }
      if (empty(trim($last_value))) {
        $form_state->setErrorByName('display_last_name', $this->t('Last name field is required.'));
      }
    }
    elseif ($profile_type === 'from_directory') {
      // ASURITE is required for directory profiles.
      $asurite = $form_state->getValue('asurite');
      $asurite_value = is_array($asurite) ? ($asurite[0]['value'] ?? '') : $asurite;
      if (empty(trim($asurite_value))) {
        $form_state->setErrorByName('asurite', $this->t('ASURITE ID is required for directory profiles.'));
      }
      else {
        // Check for duplicate ASURITE — prevent creating a directory profile
        // that already exists.
        $query = \Drupal::entityTypeManager()
          ->getStorage('asu_profile')
          ->getQuery()
          ->accessCheck(FALSE)
          ->condition('profile_type', 'from_directory')
          ->condition('asurite', trim($asurite_value));
        // Exclude the current entity if editing.
        if (!$this->entity->isNew()) {
          $query->condition('id', $this->entity->id(), '<>');
        }
        $existing_ids = $query->execute();
        if (!empty($existing_ids)) {
          $form_state->setErrorByName('asurite', $this->t('A directory profile for ASURITE ID "@asurite" already exists. Each directory profile must be unique.', ['@asurite' => trim($asurite_value)]));
        }
      }

      // For new profiles, require that the user has looked up the ASURITE
      // and selected an affiliation before saving.
      if ($this->entity->isNew()) {
        $options = $form_state->get('affiliation_options') ?? [];
        if (empty($options)) {
          $form_state->setErrorByName('affiliation_wrapper', $this->t('Please click "Look up ASURITE" to load affiliations before saving.'));
        }
        else {
          // Ensure an affiliation was selected.
          $selected_deptid = $form_state->getValue('selected_deptid') ?? '';
          if (empty($selected_deptid)) {
            $selected_deptid = $form_state->getValue(['affiliation_wrapper', 'selected_deptid']) ?? '';
          }
          // If only one option, it's auto-selected so no error needed.
          if (empty($selected_deptid) && count($options) > 1) {
            $form_state->setErrorByName('affiliation_wrapper][selected_deptid', $this->t('Please select an affiliation for this profile.'));
          }
        }
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function save(array $form, FormStateInterface $form_state): int {
    $entity = $this->entity;

    $profile_type = $entity->get('profile_type')->value;

    // For directory profiles, save the selected affiliation and populate.
    if ($profile_type === 'from_directory') {
      // Get selected_deptid from form values - check multiple possible paths
      // since container nesting varies.
      $selected_deptid = $form_state->getValue('selected_deptid') ?? '';
      if (empty($selected_deptid)) {
        $selected_deptid = $form_state->getValue(['affiliation_wrapper', 'selected_deptid']) ?? '';
      }
      // Fallback to user input if form values didn't capture it.
      if (empty($selected_deptid)) {
        $input = $form_state->getUserInput();
        $selected_deptid = $input['selected_deptid']
          ?? $input['affiliation_wrapper']['selected_deptid']
          ?? '';
      }

      // If only one option was available, it was auto-selected.
      $options = $form_state->get('affiliation_options') ?? [];
      if (count($options) === 1) {
        $selected_deptid = array_key_first($options);
      }

      if (!empty($selected_deptid)) {
        $entity->set('selected_deptid', $selected_deptid);
      }

      // Auto-set name from ASURITE if empty.
      if (empty($entity->get('name')->value)) {
        $entity->set('name', $entity->get('asurite')->value ?? 'Remote Profile');
      }

      // Populate from remote data with affiliation context.
      $asurite = $entity->get('asurite')->value ?? '';
      if (!empty($asurite)) {
        $remote_data = $this->remoteProfileFetcher->fetchProfile($asurite);
        $affiliations = $this->remoteProfileFetcher->fetchAffiliations($asurite);
        if ($remote_data) {
          $entity->populateFromRemoteData($remote_data, $affiliations);
        }
      }
    }

    $result = parent::save($form, $form_state);

    $message_args = ['%label' => $this->entity->toLink()->toString()];
    $logger_args = [
      '%label' => $this->entity->label(),
      'link' => $this->entity->toLink($this->t('View'))->toString(),
    ];

    switch ($result) {
      case SAVED_NEW:
        $this->messenger()->addStatus($this->t('New profile %label has been created.', $message_args));
        $this->logger('webspark_webdir')->notice('New profile %label has been created.', $logger_args);
        break;

      case SAVED_UPDATED:
        $this->messenger()->addStatus($this->t('The profile %label has been updated.', $message_args));
        $this->logger('webspark_webdir')->notice('The profile %label has been updated.', $logger_args);
        break;
    }

    $form_state->setRedirectUrl($this->entity->toUrl('collection'));

    return $result;
  }

  /**
   * Apply #access to show/hide fields based on the saved profile_type.
   *
   * Used on the edit form where profile_type is hidden and #states won't work.
   *
   * @param array $form
   *   The form array.
   */
  protected function applyProfileTypeAccess(array &$form): void {
    $profile_type = $this->entity->get('profile_type')->value;
    $is_local = ($profile_type === 'local');

    // Local-only fields: hide on directory profiles.
    $local_fields = [
      'first_name',
      'display_last_name',
      'image',
      'title_field',
      'department',
      'email',
      'phone',
      'fax',
      'street_address',
      'city',
      'state',
      'zip',
      'bio',
      'short_bio',
      'facebook_url',
      'linkedin_url',
      'x_url',
      'personal_website_url',
    ];

    foreach ($local_fields as $field_name) {
      if (isset($form[$field_name])) {
        $form[$field_name]['#access'] = $is_local;
      }
    }

    // ASURITE field: only show on directory profiles.
    if (isset($form['asurite'])) {
      $form['asurite']['#access'] = !$is_local;
    }
  }

  /**
   * Apply #states to toggle local vs remote fields based on profile_type.
   *
   * @param array $form
   *   The form array.
   */
  protected function applyProfileTypeStates(array &$form): void {
    $type_selector = ':input[name="profile_type"]';

    // First Name field: required only when profile_type is "local".
    if (isset($form['first_name'])) {
      $form['first_name']['widget'][0]['value']['#states'] = [
        'required' => [
          $type_selector => ['value' => 'local'],
        ],
      ];
    }

    // Last Name field: required only when profile_type is "local".
    if (isset($form['display_last_name'])) {
      $form['display_last_name']['widget'][0]['value']['#states'] = [
        'required' => [
          $type_selector => ['value' => 'local'],
        ],
      ];
    }

    // ASURITE field: required only when profile_type is "from_directory".
    if (isset($form['asurite'])) {
      $form['asurite']['widget'][0]['value']['#states'] = [
        'required' => [
          $type_selector => ['value' => 'from_directory'],
        ],
      ];
    }

    // Local-only fields: shown only when profile_type is "local".
    $local_fields = [
      'first_name',
      'display_last_name',
      'image',
      'title_field',
      'department',
      'email',
      'phone',
      'fax',
      'street_address',
      'city',
      'state',
      'zip',
      'bio',
      'short_bio',
      'facebook_url',
      'linkedin_url',
      'x_url',
      'personal_website_url',
    ];

    // Wrap local fields in a container with states.
    $form['local_fields'] = [
      '#type' => 'details',
      '#title' => $this->t('Profile details'),
      '#open' => TRUE,
      '#weight' => 5,
      '#states' => [
        'visible' => [
          $type_selector => ['value' => 'local'],
        ],
      ],
    ];

    // Move local fields into the container.
    foreach ($local_fields as $field_name) {
      if (isset($form[$field_name])) {
        $form['local_fields'][$field_name] = $form[$field_name];
        unset($form[$field_name]);
      }
    }

    // Wrap remote fields in a container with states.
    $form['remote_fields'] = [
      '#type' => 'details',
      '#title' => $this->t('Directory lookup'),
      '#open' => TRUE,
      '#weight' => 5,
      '#states' => [
        'visible' => [
          $type_selector => ['value' => 'from_directory'],
        ],
      ],
    ];

    // Move remote fields into the container.
    if (isset($form['asurite'])) {
      $form['remote_fields']['asurite'] = $form['asurite'];
      unset($form['asurite']);
    }
    if (isset($form['affiliation_wrapper'])) {
      // Remove the #states from the wrapper since the parent container
      // already handles visibility.
      unset($form['affiliation_wrapper']['#states']);
      $form['remote_fields']['affiliation_wrapper'] = $form['affiliation_wrapper'];
      unset($form['affiliation_wrapper']);
    }
  }

}
