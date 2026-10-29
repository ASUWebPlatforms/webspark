<?php

declare(strict_types=1);

namespace Drupal\webspark_webdir\Plugin\Block;

use Drupal\Core\Ajax\AjaxResponse;
use Drupal\Core\Ajax\InvokeCommand;
use Drupal\Core\Ajax\ReplaceCommand;
use Drupal\Core\Block\BlockBase;
use Drupal\Core\Cache\Cache;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\webspark_webdir\Entity\Profile;
use Drupal\webspark_webdir\Service\RemoteProfileFetcher;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Provides a 'Profile List' block for Layout Builder.
 *
 * Allows editors to place multiple profile entities within a single block,
 * displayed in either a grid or list layout. Supports creating new profiles
 * inline (local or from directory) as well as referencing existing ones.
 *
 * @Block(
 *   id = "profile_list_block",
 *   admin_label = @Translation("Profile List"),
 *   category = @Translation("ASU"),
 * )
 */
final class ProfileListBlock extends BlockBase implements ContainerFactoryPluginInterface {

  /**
   * The entity type manager.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected EntityTypeManagerInterface $entityTypeManager;

  /**
   * The remote profile fetcher service.
   *
   * @var \Drupal\webspark_webdir\Service\RemoteProfileFetcher
   */
  protected RemoteProfileFetcher $remoteProfileFetcher;

  /**
   * {@inheritdoc}
   */
  public function __construct(
    array $configuration,
    $plugin_id,
    $plugin_definition,
    EntityTypeManagerInterface $entity_type_manager,
    RemoteProfileFetcher $remote_profile_fetcher,
  ) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
    $this->entityTypeManager = $entity_type_manager;
    $this->remoteProfileFetcher = $remote_profile_fetcher;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition): self {
    return new self(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('webspark_webdir.remote_profile_fetcher'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration(): array {
    return [
      'profiles' => [],
      'display_format' => 'grid',
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function blockForm($form, FormStateInterface $form_state): array {
    $form = parent::blockForm($form, $form_state);

    $form['disclaimer'] = [
      '#type' => 'markup',
      '#markup' => $this->t('<p><small><em><strong>Please note:</strong> This profile listing block is intended to display short lists of profiles. It allows for a "local profile" to be generated and placed alongside profiles that are pulled from the ASU Directory. This block type is not intended to replace the more robust and fully-featured Web Directory block, which is the preferred tool for displaying department directory information.</em></small></p>'),
      '#weight' => -100,
    ];

    $form['display_format'] = [
      '#type' => 'select',
      '#title' => $this->t('Display format'),
      '#options' => [
        'grid' => $this->t('Grid'),
        'list' => $this->t('List'),
      ],
      '#default_value' => $this->configuration['display_format'] ?? 'grid',
      '#description' => $this->t('Choose how to display the profiles.'),
    ];

    // Determine how many profile entries to show.
    $configured_profiles = $this->configuration['profiles'] ?? [];
    $num_profiles = $form_state->get('num_profiles');
    if ($num_profiles === NULL) {
      $num_profiles = max(1, count($configured_profiles));
      $form_state->set('num_profiles', $num_profiles);
    }

    // Track which entries have been removed.
    $removed = $form_state->get('removed_profiles') ?? [];

    // Track ordering: an array of deltas in display order.
    $order = $form_state->get('profile_order');
    if ($order === NULL) {
      $order = [];
      for ($i = 0; $i < $num_profiles; $i++) {
        if (!in_array($i, $removed, TRUE)) {
          $order[] = $i;
        }
      }
      $form_state->set('profile_order', $order);
    }

    // Wrapper for AJAX.
    $form['profiles_wrapper'] = [
      '#type' => 'container',
      '#attributes' => ['id' => 'profile-entries-wrapper'],
      '#tree' => TRUE,
    ];

    // Determine which entry should be open. If "Add another" was just
    // clicked, only the last entry (the new one) should be open.
    // If move up/down was clicked, keep the moved item open.
    $open_delta = NULL;
    $triggering_element = $form_state->getTriggeringElement();
    $trigger_name = $triggering_element['#name'] ?? '';
    if ($triggering_element && $trigger_name === 'add_profile') {
      // The last item in the order is the newly added one.
      $open_delta = end($order);
    }
    elseif ($triggering_element && preg_match('/move_(up|down)_(\d+)/', $trigger_name, $matches)) {
      // Keep the moved item open.
      $open_delta = (int) $matches[2];
    }

    // Determine which deltas have validation errors so their details stay open.
    $error_deltas = [];
    $form_errors = $form_state->getErrors();
    if (!empty($form_errors)) {
      foreach (array_keys($form_errors) as $error_name) {
        if (preg_match('/profiles_wrapper]\[(\d+)]/', $error_name, $err_matches)) {
          $error_deltas[] = (int) $err_matches[1];
        }
      }
    }

    $total_visible = count($order);
    $visible_count = 0;
    foreach ($order as $position => $delta) {
      if (in_array($delta, $removed, TRUE)) {
        continue;
      }
      $visible_count++;

      // Load defaults from saved configuration.
      $entry_config = $configured_profiles[$delta] ?? [];

      // Determine the details title: use the profile name, title, and
      // department if available.
      $details_title = $this->t('Profile @num', ['@num' => $visible_count]);
      if (!empty($entry_config['profile_id'])) {
        $saved_profile = $this->entityTypeManager
          ->getStorage('asu_profile')
          ->load($entry_config['profile_id']);
        if ($saved_profile && !empty($saved_profile->get('name')->value)) {
          $name = $saved_profile->get('name')->value;
          $title_val = $saved_profile->get('title_field')->value ?? '';
          $dept_val = $saved_profile->get('department')->value ?? '';
          $suffix_parts = array_filter([$title_val, $dept_val]);
          if (!empty($suffix_parts)) {
            $details_title = $this->t('@num. @name — @details', [
              '@num' => $visible_count,
              '@name' => $name,
              '@details' => implode(', ', $suffix_parts),
            ]);
          }
          else {
            $details_title = $this->t('@num. @name', [
              '@num' => $visible_count,
              '@name' => $name,
            ]);
          }
        }
      }

      // Only open the newly added profile entry, or the first entry on
      // initial form load (when no profiles have been saved yet).
      // Also keep entries open if they have validation errors.
      $is_open = FALSE;
      if (in_array($delta, $error_deltas, TRUE)) {
        $is_open = TRUE;
      }
      elseif ($open_delta !== NULL) {
        $is_open = ($delta == $open_delta);
      }
      elseif (empty($entry_config)) {
        // Initial load with no saved config for this entry.
        $is_open = TRUE;
      }

      $form['profiles_wrapper'][$delta] = [
        '#type' => 'details',
        '#title' => $details_title,
        '#open' => $is_open,
        '#attributes' => $is_open ? ['data-open' => 'true'] : [],
      ];

      $entry = &$form['profiles_wrapper'][$delta];

      // Source selector: hidden after saving, visible for new entries.
      if (!empty($entry_config['profile_id'])) {
        $entry['source'] = [
          '#type' => 'hidden',
          '#value' => $entry_config['source'] ?? 'from_directory',
        ];
      }
      else {
        $entry['source'] = [
          '#type' => 'radios',
          '#title' => $this->t('Profile source'),
          '#options' => [
            'from_directory' => $this->t('Pull from ASU Directory'),
            'local' => $this->t('Create new local profile'),
            'reuse' => $this->t('Reuse existing local profile'),
          ],
          '#default_value' => $entry_config['source'] ?? 'from_directory',
          '#required' => TRUE,
        ];
      }

      $source_selector = ':input[name="settings[profiles_wrapper][' . $delta . '][source]"]';
      $is_saved = !empty($entry_config['profile_id']);
      $saved_source = $entry_config['source'] ?? 'from_directory';

      // --- Remote (from directory) fields ---
      $entry['remote_fields'] = [
        '#type' => 'container',
        '#tree' => TRUE,
      ];
      if ($is_saved) {
        $entry['remote_fields']['#access'] = ($saved_source === 'from_directory');
      }
      else {
        $entry['remote_fields']['#states'] = [
          'visible' => [
            $source_selector => ['value' => 'from_directory'],
          ],
        ];
      }

      $entry['remote_fields']['asurite'] = [
        '#type' => 'textfield',
        '#title' => $this->t('ASURITE ID'),
        '#description' => $this->t('The ASURITE ID for pulling profile from the directory.'),
        '#default_value' => $entry_config['asurite'] ?? '',
        '#maxlength' => 255,
      ];
      if (!$is_saved) {
        $entry['remote_fields']['asurite']['#states'] = [
          'required' => [
            $source_selector => ['value' => 'from_directory'],
          ],
        ];
      }

      // Check for affiliation options in form_state or from saved config.
      $affiliation_options = $form_state->get('affiliation_options_' . $delta) ?? [];
      $affiliation_error = $form_state->get('affiliation_error_' . $delta) ?? '';

      // On edit, if this is a directory profile with an asurite, fetch options.
      if (empty($affiliation_options) && !empty($entry_config['profile_id'])) {
        $saved_asurite = $entry_config['asurite'] ?? '';
        if (!empty($saved_asurite)) {
          $affiliations = $this->remoteProfileFetcher->fetchAffiliations($saved_asurite);
          if ($affiliations) {
            $affiliation_options = $this->remoteProfileFetcher->buildAffiliationOptions($affiliations);
            $form_state->set('affiliation_options_' . $delta, $affiliation_options);
          }
        }
      }

      // Determine button label: "Refresh affiliation data" if we already have options.
      $lookup_button_label = !empty($affiliation_options)
        ? $this->t('Refresh affiliation data')
        : $this->t('Look up ASURITE');

      // Affiliation select wrapper (also contains the lookup button).
      $entry['remote_fields']['affiliation_wrapper'] = [
        '#type' => 'container',
        '#attributes' => ['id' => 'affiliation-wrapper-' . $delta],
      ];

      if (!empty($affiliation_error)) {
        $entry['remote_fields']['affiliation_wrapper']['error'] = [
          '#type' => 'markup',
          '#markup' => '<div class="messages messages--error">' . $affiliation_error . '</div>',
        ];
      }

      if (!empty($affiliation_options)) {
        // Get default from the saved profile entity or first option.
        $affiliation_default = '';
        if (!empty($entry_config['profile_id'])) {
          $aff_profile = $this->entityTypeManager
            ->getStorage('asu_profile')
            ->load($entry_config['profile_id']);
          if ($aff_profile) {
            $affiliation_default = (string) ($aff_profile->get('selected_deptid')->value ?? '');
          }
        }
        // Only fall back to first option if no saved selection exists.
        if (empty($affiliation_default) && count($affiliation_options) === 1) {
          $affiliation_default = (string) array_key_first($affiliation_options);
        }
        // Ensure the default matches the option key type (PHP casts numeric
        // string keys to integers in arrays).
        if (is_numeric($affiliation_default) && array_key_exists((int) $affiliation_default, $affiliation_options)) {
          $affiliation_default = (int) $affiliation_default;
        }

        $entry['remote_fields']['affiliation_wrapper']['selected_deptid'] = [
          '#type' => 'select',
          '#title' => $this->t('Select affiliation'),
          '#description' => $this->t('Choose which title and department to display for this profile.'),
          '#options' => $affiliation_options,
          '#default_value' => $affiliation_default,
          '#required' => TRUE,
          '#disabled' => count($affiliation_options) === 1,
        ];
      }

      // Lookup/refresh button — placed after the select field.
      $entry['remote_fields']['affiliation_wrapper']['lookup_asurite'] = [
        '#type' => 'submit',
        '#value' => $lookup_button_label,
        '#name' => 'lookup_asurite_' . $delta,
        '#submit' => [[static::class, 'lookupAsuriteSubmit']],
        '#ajax' => [
          'callback' => [static::class, 'affiliationAjaxCallback'],
          'wrapper' => 'affiliation-wrapper-' . $delta,
        ],
        '#limit_validation_errors' => [
          ['settings', 'profiles_wrapper', $delta, 'remote_fields', 'asurite'],
        ],
      ];

      // --- Reuse existing profile field ---
      $reuse_default = NULL;
      if (($entry_config['source'] ?? '') === 'reuse' && !empty($entry_config['profile_id'])) {
        $reuse_default = $this->entityTypeManager
          ->getStorage('asu_profile')
          ->load($entry_config['profile_id']);
      }

      $entry['reuse_profile'] = [
        '#type' => 'entity_autocomplete',
        '#title' => $this->t('Select existing profile'),
        '#description' => $this->t('Start typing to search for an existing profile by name.'),
        '#target_type' => 'asu_profile',
        '#default_value' => $reuse_default,
      ];
      if ($is_saved) {
        $entry['reuse_profile']['#access'] = ($saved_source === 'reuse');
      }
      else {
        $entry['reuse_profile']['#states'] = [
          'visible' => [
            $source_selector => ['value' => 'reuse'],
          ],
          'required' => [
            $source_selector => ['value' => 'reuse'],
          ],
        ];
      }

      // --- Local profile fields ---
      $entry['local_fields'] = [
        '#type' => 'container',
        '#tree' => TRUE,
      ];
      if ($is_saved) {
        $entry['local_fields']['#access'] = ($saved_source === 'local');
      }
      else {
        $entry['local_fields']['#states'] = [
          'visible' => [
            $source_selector => ['value' => 'local'],
          ],
        ];
      }

      // Load the profile entity for default values if editing existing local.
      $profile = NULL;
      if (($entry_config['source'] ?? '') === 'local' && !empty($entry_config['profile_id'])) {
        $profile = $this->entityTypeManager
          ->getStorage('asu_profile')
          ->load($entry_config['profile_id']);
      }

      $entry['local_fields']['name'] = [
        '#type' => 'hidden',
        '#default_value' => $profile ? ($profile->get('name')->value ?? '') : '',
      ];

      $entry['local_fields']['first_name'] = [
        '#type' => 'textfield',
        '#title' => $this->t('First Name'),
        '#default_value' => $profile ? ($profile->get('first_name')->value ?? '') : '',
        '#maxlength' => 255,
      ];
      $entry['local_fields']['first_name']['#states'] = [
        'required' => [
          $source_selector => ['value' => 'local'],
        ],
      ];

      $entry['local_fields']['display_last_name'] = [
        '#type' => 'textfield',
        '#title' => $this->t('Last Name'),
        '#default_value' => $profile ? ($profile->get('display_last_name')->value ?? '') : '',
        '#maxlength' => 255,
      ];
      $entry['local_fields']['display_last_name']['#states'] = [
        'required' => [
          $source_selector => ['value' => 'local'],
        ],
      ];

      $entry['local_fields']['image'] = [
        '#type' => 'media_library',
        '#title' => $this->t('Profile image'),
        '#allowed_bundles' => ['cropped_image_rounded_1_1'],
        '#default_value' => $profile ? ($profile->get('image')->target_id ?? NULL) : NULL,
        '#description' => $this->t('Upload a profile image (1:1 rounded). Recommended minimum: 300×300px.'),
      ];

      $entry['local_fields']['title_field'] = [
        '#type' => 'textfield',
        '#title' => $this->t('Title'),
        '#default_value' => $profile ? ($profile->get('title_field')->value ?? '') : '',
        '#maxlength' => 255,
      ];

      $entry['local_fields']['department'] = [
        '#type' => 'textfield',
        '#title' => $this->t('Department'),
        '#default_value' => $profile ? ($profile->get('department')->value ?? '') : '',
        '#maxlength' => 255,
      ];

      // Contact info.
      $entry['local_fields']['contact'] = [
        '#type' => 'details',
        '#title' => $this->t('Contact information'),
        '#open' => FALSE,
        '#attributes' => ['style' => 'margin-left: unset;'],
      ];

      $entry['local_fields']['contact']['email'] = [
        '#type' => 'email',
        '#title' => $this->t('Email'),
        '#default_value' => $profile ? ($profile->get('email')->value ?? '') : '',
      ];

      $entry['local_fields']['contact']['phone'] = [
        '#type' => 'tel',
        '#title' => $this->t('Phone'),
        '#default_value' => $profile ? ($profile->get('phone')->value ?? '') : '',
      ];

      $entry['local_fields']['contact']['fax'] = [
        '#type' => 'tel',
        '#title' => $this->t('Fax'),
        '#default_value' => $profile ? ($profile->get('fax')->value ?? '') : '',
      ];

      $entry['local_fields']['contact']['street_address'] = [
        '#type' => 'textfield',
        '#title' => $this->t('Street address'),
        '#default_value' => $profile ? ($profile->get('street_address')->value ?? '') : '',
      ];

      $entry['local_fields']['contact']['city'] = [
        '#type' => 'textfield',
        '#title' => $this->t('City'),
        '#default_value' => $profile ? ($profile->get('city')->value ?? '') : '',
      ];

      $entry['local_fields']['contact']['state'] = [
        '#type' => 'select',
        '#title' => $this->t('State'),
        '#options' => ['' => $this->t('- Select -')] + Profile::getStateOptions(),
        '#default_value' => $profile ? ($profile->get('state')->value ?? '') : '',
      ];

      $entry['local_fields']['contact']['zip'] = [
        '#type' => 'textfield',
        '#title' => $this->t('Zip code'),
        '#default_value' => $profile ? ($profile->get('zip')->value ?? '') : '',
        '#maxlength' => 20,
      ];

      // Social media.
      $entry['local_fields']['social'] = [
        '#type' => 'details',
        '#title' => $this->t('Social media'),
        '#open' => FALSE,
        '#attributes' => ['style' => 'margin-left: unset;'],
      ];

      $entry['local_fields']['social']['facebook_url'] = [
        '#type' => 'url',
        '#title' => $this->t('Facebook URL'),
        '#default_value' => $profile ? ($profile->get('facebook_url')->uri ?? '') : '',
      ];

      $entry['local_fields']['social']['linkedin_url'] = [
        '#type' => 'url',
        '#title' => $this->t('LinkedIn URL'),
        '#default_value' => $profile ? ($profile->get('linkedin_url')->uri ?? '') : '',
      ];

      $entry['local_fields']['social']['x_url'] = [
        '#type' => 'url',
        '#title' => $this->t('X (Twitter) URL'),
        '#default_value' => $profile ? ($profile->get('x_url')->uri ?? '') : '',
      ];

      $entry['local_fields']['social']['personal_website_url'] = [
        '#type' => 'url',
        '#title' => $this->t('Personal Website URL'),
        '#default_value' => $profile ? ($profile->get('personal_website_url')->uri ?? '') : '',
      ];

      $entry['local_fields']['bio'] = [
        '#type' => 'text_format',
        '#title' => $this->t('Bio'),
        '#default_value' => $profile ? ($profile->get('bio')->value ?? '') : '',
        '#format' => 'minimal_format',
        '#allowed_formats' => ['minimal_format', 'basic_html'],
        '#rows' => 5,
      ];

      $entry['local_fields']['short_bio'] = [
        '#type' => 'textfield',
        '#title' => $this->t('Short Bio'),
        '#description' => $this->t('Shown in search results. Limited to 225 characters.'),
        '#default_value' => $profile ? ($profile->get('short_bio')->value ?? '') : '',
        '#maxlength' => 225,
      ];

      // Action buttons container.
      $entry['actions'] = [
        '#type' => 'container',
        '#attributes' => ['class' => ['profile-entry-actions']],
      ];

      // Move up button (not shown for first item).
      if ($position > 0) {
        $entry['actions']['move_up'] = [
          '#type' => 'submit',
          '#value' => $this->t('↑ Move up'),
          '#name' => 'move_up_' . $delta,
          '#submit' => [[static::class, 'moveUpSubmit']],
          '#ajax' => [
            'callback' => [static::class, 'profilesAjaxCallback'],
            'wrapper' => 'profile-entries-wrapper',
          ],
          '#limit_validation_errors' => [],
        ];
      }

      // Move down button (not shown for last item).
      if ($position < $total_visible - 1) {
        $entry['actions']['move_down'] = [
          '#type' => 'submit',
          '#value' => $this->t('↓ Move down'),
          '#name' => 'move_down_' . $delta,
          '#submit' => [[static::class, 'moveDownSubmit']],
          '#ajax' => [
            'callback' => [static::class, 'profilesAjaxCallback'],
            'wrapper' => 'profile-entries-wrapper',
          ],
          '#limit_validation_errors' => [],
        ];
      }

      // Remove button.
      $entry['actions']['remove'] = [
        '#type' => 'submit',
        '#value' => $this->t('Remove'),
        '#name' => 'remove_profile_' . $delta,
        '#submit' => [[static::class, 'removeProfileSubmit']],
        '#ajax' => [
          'callback' => [static::class, 'profilesAjaxCallback'],
          'wrapper' => 'profile-entries-wrapper',
        ],
        '#limit_validation_errors' => [],
      ];
    }

    // "Add another profile" button.
    $form['add_profile'] = [
      '#type' => 'submit',
      '#value' => $this->t('Add another profile'),
      '#name' => 'add_profile',
      '#submit' => [[static::class, 'addProfileSubmit']],
      '#ajax' => [
        'callback' => [static::class, 'profilesAjaxCallback'],
        'wrapper' => 'profile-entries-wrapper',
      ],
      '#limit_validation_errors' => [],
      '#attributes' => [
        'style' => 'display: block; margin-top: 1rem;',
      ],
    ];

    return $form;
  }

  /**
   * AJAX callback to return the profiles wrapper.
   */
  public static function profilesAjaxCallback(array &$form, FormStateInterface $form_state): AjaxResponse {
    $response = new AjaxResponse();
    $response->addCommand(new ReplaceCommand(
      '#profile-entries-wrapper',
      $form['settings']['profiles_wrapper']
    ));

    // After replacing HTML, close all details then open only those with
    // the 'open' attribute (set server-side via #open).
    $response->addCommand(new InvokeCommand(
      '#profile-entries-wrapper > details',
      'removeAttr',
      ['open']
    ));
    $response->addCommand(new InvokeCommand(
      '#profile-entries-wrapper > details[data-open="true"]',
      'attr',
      ['open', 'open']
    ));

    // If there are no form errors, remove the 'was-validated' class from the
    // parent form so that browser-level :invalid styling is cleared.
    if (empty($form_state->getErrors())) {
      $response->addCommand(new InvokeCommand(
        'form.was-validated',
        'removeClass',
        ['was-validated']
      ));
    }

    return $response;
  }

  /**
   * Submit handler for "Look up ASURITE" button in a profile entry.
   */
  public static function lookupAsuriteSubmit(array &$form, FormStateInterface $form_state): void {
    $trigger = $form_state->getTriggeringElement();
    $name = $trigger['#name'] ?? '';

    if (!preg_match('/lookup_asurite_(\d+)/', $name, $matches)) {
      $form_state->setRebuild();
      return;
    }

    $delta = (int) $matches[1];
    $entries = $form_state->getValue(['settings', 'profiles_wrapper']) ?? [];
    $asurite = $entries[$delta]['remote_fields']['asurite'] ?? '';
    $asurite = trim($asurite);

    // Clear previous state for this delta.
    $form_state->set('affiliation_options_' . $delta, []);
    $form_state->set('affiliation_error_' . $delta, '');

    if (empty($asurite)) {
      $form_state->set('affiliation_error_' . $delta, (string) t('Please enter an ASURITE ID before looking up.'));
      $form_state->setRebuild();
      return;
    }

    /** @var \Drupal\webspark_webdir\Service\RemoteProfileFetcher $fetcher */
    $fetcher = \Drupal::service('webspark_webdir.remote_profile_fetcher');
    $affiliations = $fetcher->fetchAffiliations($asurite);

    if (empty($affiliations)) {
      $form_state->set('affiliation_error_' . $delta, (string) t('The ASURITE ID "@asurite" was not found in the ASU Directory. Please verify the ID or create a local profile instead.', ['@asurite' => $asurite]));
      $form_state->setRebuild();
      return;
    }

    $options = $fetcher->buildAffiliationOptions($affiliations);
    if (empty($options)) {
      $form_state->set('affiliation_error_' . $delta, (string) t('No affiliations found for "@asurite". Please create a local profile instead.', ['@asurite' => $asurite]));
      $form_state->setRebuild();
      return;
    }

    $form_state->set('affiliation_options_' . $delta, $options);
    $form_state->setRebuild();
  }

  /**
   * AJAX callback for affiliation lookup.
   */
  public static function affiliationAjaxCallback(array &$form, FormStateInterface $form_state): array {
    $trigger = $form_state->getTriggeringElement();
    $name = $trigger['#name'] ?? '';

    if (preg_match('/lookup_asurite_(\d+)/', $name, $matches)) {
      $delta = (int) $matches[1];
      return $form['settings']['profiles_wrapper'][$delta]['remote_fields']['affiliation_wrapper'] ?? [];
    }

    return [];
  }

  /**
   * Submit handler for "Add another profile" button.
   */
  public static function addProfileSubmit(array &$form, FormStateInterface $form_state): void {
    $num_profiles = $form_state->get('num_profiles') ?? 1;
    $new_delta = $num_profiles;
    $form_state->set('num_profiles', $num_profiles + 1);

    // Add new delta to the end of the order.
    $order = $form_state->get('profile_order') ?? [];
    $order[] = $new_delta;
    $form_state->set('profile_order', $order);

    $form_state->setRebuild();
  }

  /**
   * Submit handler for "Remove" button.
   */
  public static function removeProfileSubmit(array &$form, FormStateInterface $form_state): void {
    $trigger = $form_state->getTriggeringElement();
    $name = $trigger['#name'] ?? '';
    if (preg_match('/remove_profile_(\d+)/', $name, $matches)) {
      $delta = (int) $matches[1];
      $removed = $form_state->get('removed_profiles') ?? [];
      $removed[] = $delta;
      $form_state->set('removed_profiles', $removed);

      // Remove from order.
      $order = $form_state->get('profile_order') ?? [];
      $order = array_values(array_filter($order, fn($d) => $d !== $delta));
      $form_state->set('profile_order', $order);
    }
    // Clear stale validation errors since the form structure has changed.
    $form_state->clearErrors();
    // Clear open_delta so all remaining entries stay collapsed.
    $form_state->setRebuild();
  }

  /**
   * Submit handler for "Move up" button.
   */
  public static function moveUpSubmit(array &$form, FormStateInterface $form_state): void {
    $trigger = $form_state->getTriggeringElement();
    $name = $trigger['#name'] ?? '';
    if (preg_match('/move_up_(\d+)/', $name, $matches)) {
      $delta = (int) $matches[1];
      $order = $form_state->get('profile_order') ?? [];
      $pos = array_search($delta, $order, TRUE);
      if ($pos !== FALSE && $pos > 0) {
        // Swap with previous.
        [$order[$pos - 1], $order[$pos]] = [$order[$pos], $order[$pos - 1]];
        $form_state->set('profile_order', array_values($order));
      }
    }
    $form_state->setRebuild();
  }

  /**
   * Submit handler for "Move down" button.
   */
  public static function moveDownSubmit(array &$form, FormStateInterface $form_state): void {
    $trigger = $form_state->getTriggeringElement();
    $name = $trigger['#name'] ?? '';
    if (preg_match('/move_down_(\d+)/', $name, $matches)) {
      $delta = (int) $matches[1];
      $order = $form_state->get('profile_order') ?? [];
      $pos = array_search($delta, $order, TRUE);
      if ($pos !== FALSE && $pos < count($order) - 1) {
        // Swap with next.
        [$order[$pos], $order[$pos + 1]] = [$order[$pos + 1], $order[$pos]];
        $form_state->set('profile_order', array_values($order));
      }
    }
    $form_state->setRebuild();
  }

  /**
   * {@inheritdoc}
   */
  public function blockValidate($form, FormStateInterface $form_state): void {
    $entries = $form_state->getValue(['profiles_wrapper']) ?? [];
    $removed = $form_state->get('removed_profiles') ?? [];

    foreach ($entries as $delta => $entry) {
      if (!is_array($entry)) {
        continue;
      }
      if (in_array((int) $delta, $removed, TRUE)) {
        continue;
      }
      $source = $entry['source'] ?? '';

      if ($source === 'from_directory') {
        $asurite = $entry['remote_fields']['asurite'] ?? '';
        if (empty(trim($asurite))) {
          $form_state->setErrorByName(
            "settings][profiles_wrapper][$delta][remote_fields][asurite",
            $this->t('Profile @num: ASURITE ID is required.', ['@num' => $delta + 1])
          );
        }
        else {
          // Require that the user has looked up the ASURITE and selected an
          // affiliation before saving.
          $affiliation_options = $form_state->get('affiliation_options_' . $delta) ?? [];
          if (empty($affiliation_options)) {
            $form_state->setErrorByName(
              "settings][profiles_wrapper][$delta][remote_fields][affiliation_wrapper",
              $this->t('Profile @num: Please click "Look up ASURITE" to load affiliations before saving.', ['@num' => $delta + 1])
            );
          }
          else {
            // Ensure an affiliation was selected (unless single option
            // auto-selects).
            $selected_deptid = $entry['remote_fields']['affiliation_wrapper']['selected_deptid']
              ?? $entry['remote_fields']['selected_deptid']
              ?? '';
            if (empty($selected_deptid) && count($affiliation_options) > 1) {
              $form_state->setErrorByName(
                "settings][profiles_wrapper][$delta][remote_fields][affiliation_wrapper][selected_deptid",
                $this->t('Profile @num: Please select an affiliation for this profile.', ['@num' => $delta + 1])
              );
            }
          }
        }
      }
      elseif ($source === 'local') {
        $first_name = $entry['local_fields']['first_name'] ?? '';
        $last_name = $entry['local_fields']['display_last_name'] ?? '';
        // Both first and last name are required (name is auto-generated).
        if (empty(trim($first_name)) || empty(trim($last_name))) {
          $form_state->setErrorByName(
            "settings][profiles_wrapper][$delta][local_fields][first_name",
            $this->t('Profile @num: First Name and Last Name are required.', ['@num' => $delta + 1])
          );
        }
      }
      elseif ($source === 'reuse') {
        $reuse_id = $entry['reuse_profile'] ?? '';
        if (empty($reuse_id)) {
          $form_state->setErrorByName(
            "settings][profiles_wrapper][$delta][reuse_profile",
            $this->t('Profile @num: Please select an existing profile.', ['@num' => $delta + 1])
          );
        }
      }
    }

    // Check for duplicate ASURITE IDs across directory entries.
    $seen_asurites = [];
    foreach ($entries as $delta => $entry) {
      if (!is_array($entry)) {
        continue;
      }
      if (in_array((int) $delta, $removed, TRUE)) {
        continue;
      }
      $source = $entry['source'] ?? '';
      if ($source === 'from_directory') {
        $asurite = strtolower(trim($entry['remote_fields']['asurite'] ?? ''));
        if (!empty($asurite)) {
          if (isset($seen_asurites[$asurite])) {
            $form_state->setErrorByName(
              "settings][profiles_wrapper][$delta][remote_fields][asurite",
              $this->t('Profile @num: The ASURITE ID "@asurite" is already used by profile @existing. Each directory profile must be unique.', [
                '@num' => $delta + 1,
                '@asurite' => $asurite,
                '@existing' => $seen_asurites[$asurite] + 1,
              ])
            );
          }
          else {
            $seen_asurites[$asurite] = $delta;
          }
        }
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function blockSubmit($form, FormStateInterface $form_state): void {
    $this->configuration['display_format'] = $form_state->getValue('display_format') ?? 'grid';

    $entries = $form_state->getValue(['profiles_wrapper']) ?? [];
    $removed = $form_state->get('removed_profiles') ?? [];
    $order = $form_state->get('profile_order') ?? array_keys($entries);
    $configured_profiles = $this->configuration['profiles'] ?? [];
    $profiles_config = [];

    // Process entries in the user-defined order.
    foreach ($order as $delta) {
      if (!isset($entries[$delta]) || !is_array($entries[$delta])) {
        continue;
      }
      if (in_array((int) $delta, $removed, TRUE)) {
        continue;
      }

      $entry = $entries[$delta];

      $source = $entry['source'] ?? 'local';
      $profile_id = NULL;

      switch ($source) {
        case 'from_directory':
          $asurite = trim($entry['remote_fields']['asurite'] ?? '');
          if (!empty($asurite)) {
            // Get the selected affiliation deptid - check both nested and flat
            // paths since container tree behavior may vary.
            $selected_deptid = $entry['remote_fields']['affiliation_wrapper']['selected_deptid']
              ?? $entry['remote_fields']['selected_deptid']
              ?? '';
            // If options had only one item, get it from form_state.
            if (empty($selected_deptid)) {
              $options = $form_state->get('affiliation_options_' . $delta) ?? [];
              if (count($options) === 1) {
                $selected_deptid = array_key_first($options);
              }
            }

            $profile = $this->findOrCreateProfileByAsurite($asurite, (string) $selected_deptid);
            if ($profile) {
              // Invalidate cache for fresh data.
              Cache::invalidateTags(['webspark_webdir:remote_profile:' . $asurite]);
              $profile_id = (int) $profile->id();
            }
          }
          break;

        case 'local':
          // Look up existing profile_id from current config for this delta.
          $existing_profile_id = $configured_profiles[$delta]['profile_id'] ?? NULL;
          $profile_id = $this->saveLocalProfile($entry, $existing_profile_id);
          break;

        case 'reuse':
          $profile_id = $entry['reuse_profile'] ?? NULL;
          break;
      }

      if ($profile_id) {
        $profiles_config[] = [
          'source' => $source,
          'profile_id' => (int) $profile_id,
          'asurite' => $entry['remote_fields']['asurite'] ?? '',
        ];
      }
    }

    $this->configuration['profiles'] = $profiles_config;
  }

  /**
   * {@inheritdoc}
   */
  public function build(): array {
    $profiles_config = $this->configuration['profiles'] ?? [];
    if (empty($profiles_config)) {
      return [];
    }

    $profile_ids = array_column($profiles_config, 'profile_id');
    $profiles = $this->entityTypeManager
      ->getStorage('asu_profile')
      ->loadMultiple($profile_ids);

    if (empty($profiles)) {
      return [];
    }

    $display_format = $this->configuration['display_format'] ?? 'grid';
    $view_mode = $display_format === 'grid' ? 'grid' : 'block';
    $view_builder = $this->entityTypeManager->getViewBuilder('asu_profile');

    $container_class = $display_format === 'grid' ? 'uds-grid' : '';

    $build = [
      '#attributes' => [
        'class' => array_filter([$container_class]),
      ],
      '#prefix' => '<div class="row">',
      '#suffix' => '</div>',
      '#attached' => [
        'library' => ['webspark_webdir/profile'],
      ],
    ];

    // Render profiles in configured order.
    $index = 0;
    $cache_tags = [];
    foreach ($profile_ids as $id) {
      if (!isset($profiles[$id])) {
        continue;
      }
      $build['profile_' . $index] = $view_builder->view($profiles[$id], $view_mode);
      $cache_tags = Cache::mergeTags($cache_tags, $profiles[$id]->getCacheTags());
      $index++;
    }

    if ($index === 0) {
      return [];
    }

    // Add cache metadata for all referenced profiles.
    $build['#cache'] = [
      'tags' => Cache::mergeTags($cache_tags, ['asu_profile_list']),
      'contexts' => ['url.path'],
    ];

    return $build;
  }

  /**
   * Save a local profile from form entry values.
   *
   * @param array $entry
   *   The form entry values for this profile.
   * @param int|null $existing_profile_id
   *   The existing profile entity ID to update, or NULL to create new.
   *
   * @return int|null
   *   The saved profile entity ID, or NULL on failure.
   */
  protected function saveLocalProfile(array $entry, ?int $existing_profile_id = NULL): ?int {
    // Form values may be nested under 'local_fields' (with #tree) or flat
    // (if container doesn't create tree level). Handle both cases.
    $local = $entry['local_fields'] ?? [];
    if (empty($local) || (!isset($local['first_name']) && isset($entry['first_name']))) {
      // Fallback: values are at the entry level, not nested.
      $local = $entry;
    }

    // If we have an existing profile_id, load and update it.
    $profile = NULL;
    if ($existing_profile_id) {
      $profile = $this->entityTypeManager
        ->getStorage('asu_profile')
        ->load($existing_profile_id);
    }

    if (!$profile) {
      $profile = Profile::create(['status' => 1]);
    }

    $profile->set('profile_type', 'local');
    $profile->set('first_name', $local['first_name'] ?? '');
    $profile->set('display_last_name', $local['display_last_name'] ?? '');
    $profile->set('name', $local['name'] ?? '');
    $profile->set('image', $local['image'] ?? NULL);
    $profile->set('title_field', $local['title_field'] ?? '');
    $profile->set('department', $local['department'] ?? '');
    $profile->set('short_bio', $local['short_bio'] ?? '');

    // Bio is a formatted text field (text_format widget returns array).
    $bio = $local['bio'] ?? [];
    $bio_value = is_array($bio) ? ($bio['value'] ?? '') : $bio;
    if (!empty($bio_value)) {
      $profile->set('bio', [
        'value' => $bio_value,
        'format' => 'minimal_format',
      ]);
    }
    else {
      $profile->set('bio', NULL);
    }

    // Contact fields.
    $contact = $local['contact'] ?? [];
    $profile->set('email', $contact['email'] ?? '');
    $profile->set('phone', $contact['phone'] ?? '');
    $profile->set('fax', $contact['fax'] ?? '');
    $profile->set('street_address', $contact['street_address'] ?? '');
    $profile->set('city', $contact['city'] ?? '');
    $profile->set('state', $contact['state'] ?? '');
    $profile->set('zip', $contact['zip'] ?? '');

    // Social fields (link fields need 'uri' key).
    $social = $local['social'] ?? [];
    $profile->set('facebook_url', !empty($social['facebook_url']) ? ['uri' => $social['facebook_url']] : NULL);
    $profile->set('linkedin_url', !empty($social['linkedin_url']) ? ['uri' => $social['linkedin_url']] : NULL);
    $profile->set('x_url', !empty($social['x_url']) ? ['uri' => $social['x_url']] : NULL);
    $profile->set('personal_website_url', !empty($social['personal_website_url']) ? ['uri' => $social['personal_website_url']] : NULL);

    $profile->save();
    return (int) $profile->id();
  }

  /**
   * Find an existing profile by ASURITE or create a new one from directory.
   *
   * @param string $asurite
   *   The ASURITE ID.
   * @param string $selected_deptid
   *   The selected department ID for the affiliation.
   *
   * @return \Drupal\webspark_webdir\Entity\Profile|null
   *   The profile entity, or NULL on failure.
   */
  protected function findOrCreateProfileByAsurite(string $asurite, string $selected_deptid = ''): ?Profile {
    // Check for existing profile.
    $existing = $this->entityTypeManager
      ->getStorage('asu_profile')
      ->loadByProperties([
        'asurite' => $asurite,
        'profile_type' => 'from_directory',
      ]);

    if (!empty($existing)) {
      $profile = reset($existing);
      // Update selected_deptid if changed.
      if (!empty($selected_deptid) && $profile->get('selected_deptid')->value !== $selected_deptid) {
        $profile->set('selected_deptid', $selected_deptid);
        // Re-populate with the new affiliation context.
        $remote_data = $this->remoteProfileFetcher->fetchProfile($asurite);
        $affiliations = $this->remoteProfileFetcher->fetchAffiliations($asurite);
        if ($remote_data) {
          $profile->populateFromRemoteData($remote_data, $affiliations);
        }
        $profile->save();
      }
      return $profile;
    }

    // Create a new profile and populate from directory.
    try {
      $remote_data = $this->remoteProfileFetcher->fetchProfile($asurite);
      if (empty($remote_data)) {
        return NULL;
      }

      $profile = Profile::create([
        'status' => 1,
        'profile_type' => 'from_directory',
        'asurite' => $asurite,
        'selected_deptid' => $selected_deptid,
      ]);

      $affiliations = $this->remoteProfileFetcher->fetchAffiliations($asurite);
      $profile->populateFromRemoteData($remote_data, $affiliations);
      $profile->save();

      return $profile;
    }
    catch (\Exception $e) {
      \Drupal::logger('webspark_webdir')->error('Failed to create profile for ASURITE @id: @message', [
        '@id' => $asurite,
        '@message' => $e->getMessage(),
      ]);
      return NULL;
    }
  }

}
