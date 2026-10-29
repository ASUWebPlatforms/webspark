<?php

declare(strict_types=1);

namespace Drupal\webspark_webdir\Entity;

use Drupal\Core\Entity\ContentEntityBase;
use Drupal\Core\Entity\EntityChangedTrait;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Field\BaseFieldDefinition;
use Drupal\user\EntityOwnerTrait;
use Drupal\webspark_webdir\ProfileInterface;

/**
 * Defines the profile entity class.
 *
 * @ContentEntityType(
 *   id = "asu_profile",
 *   label = @Translation("Profile"),
 *   label_collection = @Translation("Profiles"),
 *   label_singular = @Translation("profile"),
 *   label_plural = @Translation("profiles"),
 *   label_count = @PluralTranslation(
 *     singular = "@count profiles",
 *     plural = "@count profiles",
 *   ),
 *   handlers = {
 *     "list_builder" = "Drupal\webspark_webdir\ProfileListBuilder",
 *     "views_data" = "Drupal\views\EntityViewsData",
 *     "access" = "Drupal\webspark_webdir\ProfileAccessControlHandler",
 *     "form" = {
 *       "add" = "Drupal\webspark_webdir\Form\ProfileForm",
 *       "edit" = "Drupal\webspark_webdir\Form\ProfileForm",
 *       "delete" = "Drupal\Core\Entity\ContentEntityDeleteForm",
 *       "delete-multiple-confirm" = "Drupal\Core\Entity\Form\DeleteMultipleForm",
 *     },
 *     "route_provider" = {
 *       "html" = "Drupal\Core\Entity\Routing\AdminHtmlRouteProvider",
 *     },
 *   },
 *   base_table = "asu_profile",
 *   data_table = "asu_profile_field_data",
 *   translatable = TRUE,
 *   admin_permission = "administer asu_profile",
 *   entity_keys = {
 *     "id" = "id",
 *     "langcode" = "langcode",
 *     "label" = "name",
 *     "uuid" = "uuid",
 *     "owner" = "uid",
 *   },
 *   links = {
 *     "collection" = "/admin/content/asu-profile",
 *     "add-form" = "/asu-profile/add",
 *     "canonical" = "/asu-profile/{asu_profile}",
 *     "edit-form" = "/asu-profile/{asu_profile}/edit",
 *     "delete-form" = "/asu-profile/{asu_profile}/delete",
 *     "delete-multiple-form" = "/admin/content/asu-profile/delete-multiple",
 *   },
 * )
 */
final class Profile extends ContentEntityBase implements ProfileInterface {

  use EntityChangedTrait;
  use EntityOwnerTrait;

  /**
   * {@inheritdoc}
   */
  public function preSave(EntityStorageInterface $storage): void {
    parent::preSave($storage);
    if (!$this->getOwnerId()) {
      $this->setOwnerId(0);
    }

    // Auto-generate name from first_name and display_last_name.
    $first = trim($this->get('first_name')->value ?? '');
    $last = trim($this->get('display_last_name')->value ?? '');
    if ($first && $last) {
      $this->set('name', trim($first . ' ' . $last));
    }
  }

  /**
   * Populates this profile entity with data fetched from the remote API.
   *
   * @param array $remote_data
   *   The mapped remote profile data from RemoteProfileFetcher, keyed by
   *   Profile entity field names.
   * @param array|null $affiliations
   *   Optional affiliation data from fetchAffiliations(). When provided along
   *   with a selected_deptid on the entity, the title and department will be
   *   set from the matching affiliation instead of the default mapped values.
   */
  public function populateFromRemoteData(array $remote_data, ?array $affiliations = NULL): void {
    // Simple string/value fields.
    $simple_fields = [
      'name',
      'first_name',
      'display_last_name',
      'image_url',
      'title_field',
      'department',
      'email',
      'phone',
      'short_bio',
      'street_address',
      'city',
      'state',
      'zip',
    ];

    foreach ($simple_fields as $field_name) {
      if (isset($remote_data[$field_name]) && $remote_data[$field_name] !== '') {
        $this->set($field_name, $remote_data[$field_name]);
      }
    }

    // Bio field is a formatted text field.
    if (!empty($remote_data['bio'])) {
      $this->set('bio', [
        'value' => $remote_data['bio'],
        'format' => 'minimal_format',
      ]);
    }

    // Link fields (already in ['uri' => ...] format from the service).
    $link_fields = [
      'facebook_url',
      'linkedin_url',
      'x_url',
      'personal_website_url',
    ];

    foreach ($link_fields as $field_name) {
      if (isset($remote_data[$field_name])) {
        $this->set($field_name, $remote_data[$field_name]);
      }
    }

    // Override title and department from selected affiliation if available.
    $selected_deptid = $this->get('selected_deptid')->value ?? '';
    if (!empty($selected_deptid) && !empty($affiliations)) {
      $titles = $affiliations['titles'] ?? [];
      $departments = $affiliations['departments'] ?? [];
      $deptids = $affiliations['deptids'] ?? [];

      // Check primary first.
      if (($affiliations['primary_deptid'] ?? '') === $selected_deptid) {
        $this->set('title_field', $affiliations['primary_title'] ?? '');
        $this->set('department', $affiliations['primary_department'] ?? '');
      }
      else {
        // Find the matching index in the arrays.
        $index = array_search($selected_deptid, $deptids, TRUE);
        if ($index !== FALSE) {
          $this->set('title_field', $titles[$index] ?? '');
          $this->set('department', $departments[$index] ?? '');
        }
      }
    }
  }

  /*
  TODO: Consider pulling state options list from asu_data_potluck.
  Perhaps long term improvement is to move the degree rfi function into the
  webspark_utilities module and have it be a shared utility with caching
  of the values, etc.
   */

  /**
   * Returns the list of US state options.
   *
   * Used by both the entity field definition and the block form.
   *
   * @return array
   *   An array of state names keyed by abbreviation.
   */
  public static function getStateOptions(): array {
    return [
      'AL' => 'Alabama',
      'AK' => 'Alaska',
      'AZ' => 'Arizona',
      'AR' => 'Arkansas',
      'CA' => 'California',
      'CO' => 'Colorado',
      'CT' => 'Connecticut',
      'DE' => 'Delaware',
      'DC' => 'District of Columbia',
      'FL' => 'Florida',
      'GA' => 'Georgia',
      'HI' => 'Hawaii',
      'ID' => 'Idaho',
      'IL' => 'Illinois',
      'IN' => 'Indiana',
      'IA' => 'Iowa',
      'KS' => 'Kansas',
      'KY' => 'Kentucky',
      'LA' => 'Louisiana',
      'ME' => 'Maine',
      'MD' => 'Maryland',
      'MA' => 'Massachusetts',
      'MI' => 'Michigan',
      'MN' => 'Minnesota',
      'MS' => 'Mississippi',
      'MO' => 'Missouri',
      'MT' => 'Montana',
      'NE' => 'Nebraska',
      'NV' => 'Nevada',
      'NH' => 'New Hampshire',
      'NJ' => 'New Jersey',
      'NM' => 'New Mexico',
      'NY' => 'New York',
      'NC' => 'North Carolina',
      'ND' => 'North Dakota',
      'OH' => 'Ohio',
      'OK' => 'Oklahoma',
      'OR' => 'Oregon',
      'PA' => 'Pennsylvania',
      'RI' => 'Rhode Island',
      'SC' => 'South Carolina',
      'SD' => 'South Dakota',
      'TN' => 'Tennessee',
      'TX' => 'Texas',
      'UT' => 'Utah',
      'VT' => 'Vermont',
      'VA' => 'Virginia',
      'WA' => 'Washington',
      'WV' => 'West Virginia',
      'WI' => 'Wisconsin',
      'WY' => 'Wyoming',
    ];
  }

  /**
   * {@inheritdoc}
   */
  public static function baseFieldDefinitions(EntityTypeInterface $entity_type): array {

    $fields = parent::baseFieldDefinitions($entity_type);

    // Profile type: local or from_directory.
    $fields['profile_type'] = BaseFieldDefinition::create('list_string')
      ->setLabel(t('Profile source'))
      ->setDescription(t('Choose whether to pull from the ASU Directory or create a new local profile.'))
      ->setRequired(TRUE)
      ->setSetting('allowed_values', [
        'from_directory' => 'Pull from ASU Directory',
        'local' => 'Create new local profile',
      ])
      ->setDisplayOptions('form', [
        'type' => 'options_buttons',
        'weight' => 0,
      ]);

    // Name (used as entity label).
    $fields['name'] = BaseFieldDefinition::create('string')
      ->setTranslatable(TRUE)
      ->setLabel(t('Name'))
      ->setRequired(FALSE)
      ->setSetting('max_length', 255)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 2,
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'label' => 'hidden',
        'type' => 'string',
        'weight' => 0,
      ]);

    // First Name.
    $fields['first_name'] = BaseFieldDefinition::create('string')
      ->setTranslatable(TRUE)
      ->setLabel(t('First Name'))
      ->setRequired(FALSE)
      ->setSetting('max_length', 255)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 2,
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'label' => 'hidden',
        'type' => 'string',
        'weight' => 0,
      ]);

    // Display Last Name (used for sorting).
    $fields['display_last_name'] = BaseFieldDefinition::create('string')
      ->setTranslatable(TRUE)
      ->setLabel(t('Last Name'))
      ->setRequired(FALSE)
      ->setSetting('max_length', 255)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 2,
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'label' => 'hidden',
        'type' => 'string',
        'weight' => 0,
      ]);

    // ASURITE ID (for remote/directory profiles).
    $fields['asurite'] = BaseFieldDefinition::create('string')
      ->setLabel(t('ASURITE ID'))
      ->setDescription(t('The ASURITE ID for pulling profile from the directory.'))
      ->setSetting('max_length', 255)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 1,
      ]);

    // Selected department ID (affiliation) for directory profiles.
    $fields['selected_deptid'] = BaseFieldDefinition::create('string')
      ->setLabel(t('Selected Affiliation'))
      ->setDescription(t('The department ID of the selected affiliation for directory profiles.'))
      ->setSetting('max_length', 255);

    // Profile image (media reference).
    $fields['image'] = BaseFieldDefinition::create('entity_reference')
      ->setLabel(t('Profile image'))
      ->setSetting('target_type', 'media')
      ->setSetting('handler', 'default:media')
      ->setSetting('handler_settings', [
        'target_bundles' => [
          'cropped_image_rounded_1_1' => 'cropped_image_rounded_1_1',
        ],
      ])
      ->setDisplayOptions('form', [
        'type' => 'media_library_widget',
        'weight' => 1,
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'type' => 'entity_reference_entity_view',
        'weight' => -5,
        'settings' => [
          'view_mode' => 'small',
        ],
      ]);

    // Image URL (for remote profiles).
    $fields['image_url'] = BaseFieldDefinition::create('uri')
      ->setLabel(t('Image URL'))
      ->setDescription(t('URL to a profile image for remote profiles.'))
      ->setSetting('max_length', 2048);

    // Title/profession.
    $fields['title_field'] = BaseFieldDefinition::create('string')
      ->setTranslatable(TRUE)
      ->setLabel(t('Title'))
      ->setSetting('max_length', 255)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 3,
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'label' => 'above',
        'type' => 'string',
        'weight' => 5,
      ]);

    // Department.
    $fields['department'] = BaseFieldDefinition::create('string')
      ->setTranslatable(TRUE)
      ->setLabel(t('Department'))
      ->setSetting('max_length', 255)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 4,
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'label' => 'above',
        'type' => 'string',
        'weight' => 6,
      ]);

    // Bio (formatted text).
    $fields['bio'] = BaseFieldDefinition::create('text_long')
      ->setTranslatable(TRUE)
      ->setLabel(t('Bio'))
      ->setDisplayOptions('form', [
        'type' => 'text_textarea',
        'weight' => 50,
        'settings' => [
          'rows' => 5,
        ],
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'type' => 'text_default',
        'label' => 'above',
        'weight' => 10,
      ]);

    // Short Bio (plain string, limited to 225 characters).
    $fields['short_bio'] = BaseFieldDefinition::create('string')
      ->setTranslatable(TRUE)
      ->setLabel(t('Short Bio'))
      ->setDescription(t('This field will be shown in search results and is limited to 225 characters'))
      ->setSetting('max_length', 225)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 50,
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'type' => 'string',
        'label' => 'above',
        'weight' => 10,
      ]);

    $fields['email'] = BaseFieldDefinition::create('email')
      ->setLabel(t('Email'))
      ->setDisplayOptions('form', [
        'type' => 'email_default',
        'weight' => 10,
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'type' => 'email_mailto',
        'weight' => 15,
      ]);

    $fields['phone'] = BaseFieldDefinition::create('telephone')
      ->setLabel(t('Phone'))
      ->setDisplayOptions('form', [
        'type' => 'telephone_default',
        'weight' => 11,
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'type' => 'telephone_link',
        'weight' => 16,
      ]);

    $fields['fax'] = BaseFieldDefinition::create('telephone')
      ->setLabel(t('Fax'))
      ->setDisplayOptions('form', [
        'type' => 'telephone_default',
        'weight' => 12,
      ])
      ->setDisplayConfigurable('form', TRUE)
      ->setDisplayOptions('view', [
        'type' => 'telephone_link',
        'weight' => 17,
      ]);

    $fields['street_address'] = BaseFieldDefinition::create('string')
      ->setLabel(t('Street address'))
      ->setSetting('max_length', 255)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 13,
      ]);

    $fields['city'] = BaseFieldDefinition::create('string')
      ->setLabel(t('City'))
      ->setSetting('max_length', 255)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 15,
      ]);

    $fields['state'] = BaseFieldDefinition::create('list_string')
      ->setLabel(t('State'))
      ->setSetting('allowed_values', self::getStateOptions())
      ->setDisplayOptions('form', [
        'type' => 'options_select',
        'weight' => 16,
      ]);

    $fields['zip'] = BaseFieldDefinition::create('string')
      ->setLabel(t('Zip code'))
      ->setSetting('max_length', 20)
      ->setDisplayOptions('form', [
        'type' => 'string_textfield',
        'weight' => 17,
      ]);

    $fields['facebook_url'] = BaseFieldDefinition::create('link')
      ->setLabel(t('Facebook URL'))
      ->setSettings([
        'title' => DRUPAL_DISABLED,
        'link_type' => 17,
      ])
      ->setDisplayOptions('form', [
        'type' => 'link_default',
        'weight' => 20,
      ]);

    $fields['linkedin_url'] = BaseFieldDefinition::create('link')
      ->setLabel(t('LinkedIn URL'))
      ->setSettings([
        'title' => DRUPAL_DISABLED,
        'link_type' => 17,
      ])
      ->setDisplayOptions('form', [
        'type' => 'link_default',
        'weight' => 21,
      ]);

    $fields['x_url'] = BaseFieldDefinition::create('link')
      ->setLabel(t('X (Twitter) URL'))
      ->setSettings([
        'title' => DRUPAL_DISABLED,
        'link_type' => 17,
      ])
      ->setDisplayOptions('form', [
        'type' => 'link_default',
        'weight' => 22,
      ]);

    $fields['personal_website_url'] = BaseFieldDefinition::create('link')
      ->setLabel(t('Personal Website URL'))
      ->setSettings([
        'title' => DRUPAL_DISABLED,
        'link_type' => 17,
      ])
      ->setDisplayOptions('form', [
        'type' => 'link_default',
        'weight' => 23,
      ]);

    // --- Standard entity fields ---

    $fields['status'] = BaseFieldDefinition::create('boolean')
      ->setLabel(t('Status'))
      ->setDefaultValue(TRUE)
      ->setSetting('on_label', 'Enabled')
      ->setDisplayOptions('form', [
        'type' => 'boolean_checkbox',
        'settings' => [
          'display_label' => FALSE,
        ],
        'weight' => 99,
      ]);

    $fields['uid'] = BaseFieldDefinition::create('entity_reference')
      ->setTranslatable(TRUE)
      ->setLabel(t('Author'))
      ->setSetting('target_type', 'user')
      ->setDefaultValueCallback(self::class . '::getDefaultEntityOwner')
      ->setDisplayOptions('form', [
        'type' => 'entity_reference_autocomplete',
        'settings' => [
          'match_operator' => 'CONTAINS',
          'size' => 60,
          'placeholder' => '',
        ],
        'weight' => 100,
      ]);

    $fields['created'] = BaseFieldDefinition::create('created')
      ->setLabel(t('Authored on'))
      ->setTranslatable(TRUE)
      ->setDescription(t('The time that the profile was created.'));

    $fields['changed'] = BaseFieldDefinition::create('changed')
      ->setLabel(t('Changed'))
      ->setTranslatable(TRUE)
      ->setDescription(t('The time that the profile was last edited.'));

    return $fields;
  }

}
