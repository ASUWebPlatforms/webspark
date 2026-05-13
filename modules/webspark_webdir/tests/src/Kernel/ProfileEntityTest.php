<?php

declare(strict_types=1);

namespace Drupal\Tests\webspark_webdir\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\webspark_webdir\Entity\Profile;

/**
 * Tests the asu_profile content entity.
 *
 * @group webspark_webdir
 * @coversDefaultClass \Drupal\webspark_webdir\Entity\Profile
 */
class ProfileEntityTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system',
    'user',
    'field',
    'text',
    'link',
    'telephone',
    'options',
    'media',
    'image',
    'file',
    'webspark_webdir',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('asu_profile');
    $this->installConfig(['system']);
  }

  /**
   * Tests basic entity creation and field storage.
   */
  public function testProfileCreation(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'John',
      'display_last_name' => 'Doe',
      'email' => 'john.doe@example.com',
      'phone' => '480-555-1234',
      'department' => 'Engineering',
      'title_field' => 'Professor',
      'status' => TRUE,
    ]);
    $profile->save();

    $this->assertNotEmpty($profile->id(), 'Profile entity was saved and has an ID.');
    $this->assertNotEmpty($profile->uuid(), 'Profile entity has a UUID.');

    // Reload to confirm persistence.
    $loaded = Profile::load($profile->id());
    $this->assertInstanceOf(Profile::class, $loaded);
    $this->assertEquals('local', $loaded->get('profile_type')->value);
    $this->assertEquals('John', $loaded->get('first_name')->value);
    $this->assertEquals('Doe', $loaded->get('display_last_name')->value);
    $this->assertEquals('john.doe@example.com', $loaded->get('email')->value);
    $this->assertEquals('480-555-1234', $loaded->get('phone')->value);
    $this->assertEquals('Engineering', $loaded->get('department')->value);
    $this->assertEquals('Professor', $loaded->get('title_field')->value);
    $this->assertTrue((bool) $loaded->get('status')->value);
  }

  /**
   * Tests creation with all available fields populated.
   */
  public function testProfileCreationAllFields(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Complete',
      'display_last_name' => 'Profile',
      'title_field' => 'Senior Research Scientist',
      'department' => 'Biodesign Institute',
      'email' => 'complete.profile@asu.edu',
      'phone' => '480-727-1234',
      'fax' => '480-727-5678',
      'street_address' => '727 E Tyler St',
      'city' => 'Tempe',
      'state' => 'AZ',
      'zip' => '85287',
      'short_bio' => 'A brief description of this person for search results.',
      'bio' => [
        'value' => '<p>This is the <strong>full bio</strong> with formatting.</p>',
        'format' => 'minimal_format',
      ],
      'image_url' => 'https://webapp4.asu.edu/photo/abc123',
      'facebook_url' => ['uri' => 'https://facebook.com/completep'],
      'linkedin_url' => ['uri' => 'https://linkedin.com/in/completep'],
      'x_url' => ['uri' => 'https://x.com/completep'],
      'personal_website_url' => ['uri' => 'https://completep.example.com'],
      'status' => TRUE,
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertInstanceOf(Profile::class, $loaded);

    // Verify all simple string fields.
    $this->assertEquals('Complete Profile', $loaded->get('name')->value);
    $this->assertEquals('Complete', $loaded->get('first_name')->value);
    $this->assertEquals('Profile', $loaded->get('display_last_name')->value);
    $this->assertEquals('Senior Research Scientist', $loaded->get('title_field')->value);
    $this->assertEquals('Biodesign Institute', $loaded->get('department')->value);

    // Contact fields.
    $this->assertEquals('complete.profile@asu.edu', $loaded->get('email')->value);
    $this->assertEquals('480-727-1234', $loaded->get('phone')->value);
    $this->assertEquals('480-727-5678', $loaded->get('fax')->value);

    // Address fields.
    $this->assertEquals('727 E Tyler St', $loaded->get('street_address')->value);
    $this->assertEquals('Tempe', $loaded->get('city')->value);
    $this->assertEquals('AZ', $loaded->get('state')->value);
    $this->assertEquals('85287', $loaded->get('zip')->value);

    // Bio fields.
    $this->assertEquals('A brief description of this person for search results.', $loaded->get('short_bio')->value);
    $this->assertEquals('<p>This is the <strong>full bio</strong> with formatting.</p>', $loaded->get('bio')->value);
    $this->assertEquals('minimal_format', $loaded->get('bio')->format);

    // Image URL (for remote profiles).
    $this->assertEquals('https://webapp4.asu.edu/photo/abc123', $loaded->get('image_url')->value);

    // Social link fields.
    $this->assertEquals('https://facebook.com/completep', $loaded->get('facebook_url')->uri);
    $this->assertEquals('https://linkedin.com/in/completep', $loaded->get('linkedin_url')->uri);
    $this->assertEquals('https://x.com/completep', $loaded->get('x_url')->uri);
    $this->assertEquals('https://completep.example.com', $loaded->get('personal_website_url')->uri);
  }

  /**
   * Tests that preSave() auto-generates the name from first + last name.
   *
   * @covers ::preSave
   */
  public function testPreSaveNameGeneration(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Jane',
      'display_last_name' => 'Smith',
    ]);
    // Name is not set explicitly.
    $profile->save();

    $this->assertEquals('Jane Smith', $profile->get('name')->value);
    $this->assertEquals('Jane Smith', $profile->label());
  }

  /**
   * Tests preSave trims whitespace from first/last name before generating.
   *
   * @covers ::preSave
   */
  public function testPreSaveTrimsWhitespace(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => '  Alice  ',
      'display_last_name' => '  Wonderland  ',
    ]);
    $profile->save();

    $this->assertEquals('Alice Wonderland', $profile->get('name')->value);
  }

  /**
   * Tests that name is NOT overwritten when first or last name is empty.
   *
   * @covers ::preSave
   */
  public function testPreSaveDoesNotOverwriteWhenNamePartMissing(): void {
    // Only first name provided — no auto-generation.
    $profile = Profile::create([
      'profile_type' => 'local',
      'name' => 'Manual Name',
      'first_name' => 'OnlyFirst',
    ]);
    $profile->save();

    // Name should remain what was set manually since last name is empty.
    $this->assertEquals('Manual Name', $profile->get('name')->value);
  }

  /**
   * Tests that name updates correctly when first/last name change.
   *
   * @covers ::preSave
   */
  public function testNameUpdatesOnEdit(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Original',
      'display_last_name' => 'Name',
    ]);
    $profile->save();
    $this->assertEquals('Original Name', $profile->get('name')->value);

    $profile->set('first_name', 'Updated');
    $profile->set('display_last_name', 'Person');
    $profile->save();

    $this->assertEquals('Updated Person', $profile->get('name')->value);
  }

  /**
   * Tests that preSave sets owner to 0 if not set.
   *
   * @covers ::preSave
   */
  public function testPreSaveSetsDefaultOwner(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Test',
      'display_last_name' => 'User',
    ]);
    $profile->save();

    $this->assertEquals(0, $profile->getOwnerId());
  }

  /**
   * Tests populateFromRemoteData() with simple string fields.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataSimpleFields(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'status' => TRUE,
    ]);

    $remote_data = [
      'name' => 'Remote User',
      'first_name' => 'Remote',
      'display_last_name' => 'User',
      'image_url' => 'https://example.com/photo.jpg',
      'title_field' => 'Research Associate',
      'department' => 'Physics',
      'email' => 'ruser@asu.edu',
      'phone' => '480-555-9999',
      'short_bio' => 'Short bio text.',
      'street_address' => '123 University Dr',
      'city' => 'Tempe',
      'state' => 'AZ',
      'zip' => '85281',
    ];

    $profile->populateFromRemoteData($remote_data);

    $this->assertEquals('Remote User', $profile->get('name')->value);
    $this->assertEquals('Remote', $profile->get('first_name')->value);
    $this->assertEquals('User', $profile->get('display_last_name')->value);
    $this->assertEquals('https://example.com/photo.jpg', $profile->get('image_url')->value);
    $this->assertEquals('Research Associate', $profile->get('title_field')->value);
    $this->assertEquals('Physics', $profile->get('department')->value);
    $this->assertEquals('ruser@asu.edu', $profile->get('email')->value);
    $this->assertEquals('480-555-9999', $profile->get('phone')->value);
    $this->assertEquals('Short bio text.', $profile->get('short_bio')->value);
    $this->assertEquals('123 University Dr', $profile->get('street_address')->value);
    $this->assertEquals('Tempe', $profile->get('city')->value);
    $this->assertEquals('AZ', $profile->get('state')->value);
    $this->assertEquals('85281', $profile->get('zip')->value);
  }

  /**
   * Tests populateFromRemoteData() with bio (formatted text field).
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataBioField(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'Bio',
      'display_last_name' => 'Test',
      'bio' => '<p>This is a <strong>formatted</strong> bio.</p>',
    ];

    $profile->populateFromRemoteData($remote_data);

    $this->assertEquals('<p>This is a <strong>formatted</strong> bio.</p>', $profile->get('bio')->value);
    $this->assertEquals('minimal_format', $profile->get('bio')->format);
  }

  /**
   * Tests populateFromRemoteData() with link fields (social URLs).
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataLinkFields(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'Social',
      'display_last_name' => 'Test',
      'facebook_url' => ['uri' => 'https://facebook.com/someuser'],
      'linkedin_url' => ['uri' => 'https://linkedin.com/in/someuser'],
      'x_url' => ['uri' => 'https://x.com/someuser'],
      'personal_website_url' => ['uri' => 'https://example.com'],
    ];

    $profile->populateFromRemoteData($remote_data);

    $this->assertEquals('https://facebook.com/someuser', $profile->get('facebook_url')->uri);
    $this->assertEquals('https://linkedin.com/in/someuser', $profile->get('linkedin_url')->uri);
    $this->assertEquals('https://x.com/someuser', $profile->get('x_url')->uri);
    $this->assertEquals('https://example.com', $profile->get('personal_website_url')->uri);
  }

  /**
   * Tests populateFromRemoteData() skips empty string values.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataSkipsEmptyStrings(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'first_name' => 'Original',
      'display_last_name' => 'Name',
      'status' => TRUE,
    ]);

    // Passing empty strings should not overwrite existing values.
    $remote_data = [
      'first_name' => '',
      'display_last_name' => '',
      'email' => '',
    ];

    $profile->populateFromRemoteData($remote_data);

    // Original values should remain since empty strings are skipped.
    $this->assertEquals('Original', $profile->get('first_name')->value);
    $this->assertEquals('Name', $profile->get('display_last_name')->value);
  }

  /**
   * Tests populateFromRemoteData() with NULL link fields (not set).
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataNullLinkFields(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'Test',
      'display_last_name' => 'Null',
      'facebook_url' => NULL,
      'linkedin_url' => NULL,
    ];

    $profile->populateFromRemoteData($remote_data);

    // NULL link fields should be set (clearing any prior value).
    $this->assertTrue($profile->get('facebook_url')->isEmpty());
    $this->assertTrue($profile->get('linkedin_url')->isEmpty());
  }

  /**
   * Tests getStateOptions() returns a valid US states array.
   *
   * @covers ::getStateOptions
   */
  public function testGetStateOptions(): void {
    $states = Profile::getStateOptions();

    $this->assertIsArray($states);
    $this->assertNotEmpty($states);
    // Check a few known states.
    $this->assertArrayHasKey('AZ', $states);
    $this->assertEquals('Arizona', $states['AZ']);
    $this->assertArrayHasKey('CA', $states);
    $this->assertEquals('California', $states['CA']);
    $this->assertArrayHasKey('NY', $states);
    $this->assertEquals('New York', $states['NY']);
    // All 50 states + DC = 51.
    $this->assertCount(51, $states);
  }

  /**
   * Tests that the entity type is translatable.
   */
  public function testEntityIsTranslatable(): void {
    $entity_type = \Drupal::entityTypeManager()->getDefinition('asu_profile');
    $this->assertTrue($entity_type->isTranslatable());
    $this->assertEquals('asu_profile', $entity_type->getBaseTable());
    $this->assertEquals('asu_profile_field_data', $entity_type->getDataTable());
  }

  /**
   * Tests that the entity has the expected entity keys.
   */
  public function testEntityKeys(): void {
    $entity_type = \Drupal::entityTypeManager()->getDefinition('asu_profile');
    $keys = $entity_type->getKeys();

    $this->assertEquals('id', $keys['id']);
    $this->assertEquals('langcode', $keys['langcode']);
    $this->assertEquals('name', $keys['label']);
    $this->assertEquals('uuid', $keys['uuid']);
    $this->assertEquals('uid', $keys['owner']);
  }

  /**
   * Tests that the admin permission is correctly defined.
   */
  public function testAdminPermission(): void {
    $entity_type = \Drupal::entityTypeManager()->getDefinition('asu_profile');
    $this->assertEquals('administer asu_profile', $entity_type->getAdminPermission());
  }

  /**
   * Tests that changed timestamp updates on save.
   */
  public function testChangedTimestamp(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Time',
      'display_last_name' => 'Test',
    ]);
    $profile->save();

    $created = $profile->get('created')->value;
    $changed = $profile->getChangedTime();

    $this->assertNotEmpty($created);
    $this->assertNotEmpty($changed);
  }

  /**
   * Tests entity query for profile entities.
   */
  public function testEntityQuery(): void {
    // Create several profiles.
    Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Alpha',
      'display_last_name' => 'One',
      'status' => TRUE,
    ])->save();

    Profile::create([
      'profile_type' => 'from_directory',
      'first_name' => 'Beta',
      'display_last_name' => 'Two',
      'asurite' => 'btwo',
      'status' => TRUE,
    ])->save();

    Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Gamma',
      'display_last_name' => 'Three',
      'status' => FALSE,
    ])->save();

    // Query all profiles.
    $all = \Drupal::entityTypeManager()
      ->getStorage('asu_profile')
      ->getQuery()
      ->accessCheck(FALSE)
      ->execute();
    $this->assertCount(3, $all);

    // Query only local profiles.
    $local_ids = \Drupal::entityTypeManager()
      ->getStorage('asu_profile')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('profile_type', 'local')
      ->execute();
    $this->assertCount(2, $local_ids);

    // Query by asurite.
    $dir_ids = \Drupal::entityTypeManager()
      ->getStorage('asu_profile')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('asurite', 'btwo')
      ->execute();
    $this->assertCount(1, $dir_ids);
  }

  /**
   * Tests the fax and address fields.
   */
  public function testContactAndAddressFields(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Contact',
      'display_last_name' => 'Test',
      'fax' => '480-555-0000',
      'street_address' => '456 Main St',
      'city' => 'Phoenix',
      'state' => 'AZ',
      'zip' => '85004',
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertEquals('480-555-0000', $loaded->get('fax')->value);
    $this->assertEquals('456 Main St', $loaded->get('street_address')->value);
    $this->assertEquals('Phoenix', $loaded->get('city')->value);
    $this->assertEquals('AZ', $loaded->get('state')->value);
    $this->assertEquals('85004', $loaded->get('zip')->value);
  }

  /**
   * Tests bio and short_bio field storage and retrieval.
   */
  public function testBioFields(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Bio',
      'display_last_name' => 'Fields',
      'bio' => [
        'value' => '<p>A <em>formatted</em> biography with <a href="https://asu.edu">links</a>.</p>',
        'format' => 'minimal_format',
      ],
      'short_bio' => 'Brief description for search results and card views.',
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertEquals(
      '<p>A <em>formatted</em> biography with <a href="https://asu.edu">links</a>.</p>',
      $loaded->get('bio')->value
    );
    $this->assertEquals('minimal_format', $loaded->get('bio')->format);
    $this->assertEquals(
      'Brief description for search results and card views.',
      $loaded->get('short_bio')->value
    );
  }

  /**
   * Tests that short_bio respects the 225 character max length.
   */
  public function testShortBioMaxLength(): void {
    $long_text = str_repeat('x', 225);
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Max',
      'display_last_name' => 'Length',
      'short_bio' => $long_text,
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertEquals(225, strlen($loaded->get('short_bio')->value));
  }

  /**
   * Tests social link fields with save and reload.
   */
  public function testSocialLinkFields(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Link',
      'display_last_name' => 'Fields',
      'facebook_url' => ['uri' => 'https://facebook.com/testuser'],
      'linkedin_url' => ['uri' => 'https://linkedin.com/in/testuser'],
      'x_url' => ['uri' => 'https://x.com/testuser'],
      'personal_website_url' => ['uri' => 'https://mysite.example.com'],
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertEquals('https://facebook.com/testuser', $loaded->get('facebook_url')->uri);
    $this->assertEquals('https://linkedin.com/in/testuser', $loaded->get('linkedin_url')->uri);
    $this->assertEquals('https://x.com/testuser', $loaded->get('x_url')->uri);
    $this->assertEquals('https://mysite.example.com', $loaded->get('personal_website_url')->uri);
  }

  /**
   * Tests that social link fields can be cleared (set to NULL).
   */
  public function testSocialLinkFieldsCanBeCleared(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Clear',
      'display_last_name' => 'Links',
      'facebook_url' => ['uri' => 'https://facebook.com/clearme'],
    ]);
    $profile->save();

    // Verify it was set.
    $this->assertEquals('https://facebook.com/clearme', $profile->get('facebook_url')->uri);

    // Clear the field.
    $profile->set('facebook_url', NULL);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertTrue($loaded->get('facebook_url')->isEmpty());
  }

  /**
   * Tests the image_url field for remote profiles.
   */
  public function testImageUrlField(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'first_name' => 'Image',
      'display_last_name' => 'URL',
      'asurite' => 'iurl',
      'image_url' => 'https://webapp4.asu.edu/photo/iurl?size=medium',
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertEquals(
      'https://webapp4.asu.edu/photo/iurl?size=medium',
      $loaded->get('image_url')->value
    );
  }

  /**
   * Tests the ASURITE field for directory profiles.
   */
  public function testAsuriteField(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'first_name' => 'Asurite',
      'display_last_name' => 'Test',
      'asurite' => 'testasu123',
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertEquals('testasu123', $loaded->get('asurite')->value);
  }

  /**
   * Tests entity deletion.
   */
  public function testProfileDeletion(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Delete',
      'display_last_name' => 'Me',
    ]);
    $profile->save();
    $id = $profile->id();

    $this->assertNotNull(Profile::load($id));

    $profile->delete();

    $this->assertNull(Profile::load($id));
  }

  /**
   * Tests entity update preserves all fields.
   */
  public function testProfileUpdateAllFields(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Before',
      'display_last_name' => 'Update',
      'title_field' => 'Old Title',
      'department' => 'Old Dept',
      'email' => 'old@asu.edu',
      'phone' => '480-000-0000',
      'fax' => '480-000-0001',
      'street_address' => '1 Old St',
      'city' => 'Mesa',
      'state' => 'AZ',
      'zip' => '85201',
      'short_bio' => 'Old short bio.',
      'bio' => ['value' => '<p>Old bio.</p>', 'format' => 'minimal_format'],
      'facebook_url' => ['uri' => 'https://facebook.com/old'],
      'linkedin_url' => ['uri' => 'https://linkedin.com/in/old'],
      'x_url' => ['uri' => 'https://x.com/old'],
      'personal_website_url' => ['uri' => 'https://old.example.com'],
    ]);
    $profile->save();

    // Update all fields.
    $profile->set('first_name', 'After');
    $profile->set('display_last_name', 'Change');
    $profile->set('title_field', 'New Title');
    $profile->set('department', 'New Dept');
    $profile->set('email', 'new@asu.edu');
    $profile->set('phone', '480-111-1111');
    $profile->set('fax', '480-111-1112');
    $profile->set('street_address', '2 New Ave');
    $profile->set('city', 'Scottsdale');
    $profile->set('state', 'CA');
    $profile->set('zip', '85251');
    $profile->set('short_bio', 'New short bio.');
    $profile->set('bio', ['value' => '<p>New bio.</p>', 'format' => 'minimal_format']);
    $profile->set('facebook_url', ['uri' => 'https://facebook.com/new']);
    $profile->set('linkedin_url', ['uri' => 'https://linkedin.com/in/new']);
    $profile->set('x_url', ['uri' => 'https://x.com/new']);
    $profile->set('personal_website_url', ['uri' => 'https://new.example.com']);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertEquals('After Change', $loaded->get('name')->value);
    $this->assertEquals('After', $loaded->get('first_name')->value);
    $this->assertEquals('Change', $loaded->get('display_last_name')->value);
    $this->assertEquals('New Title', $loaded->get('title_field')->value);
    $this->assertEquals('New Dept', $loaded->get('department')->value);
    $this->assertEquals('new@asu.edu', $loaded->get('email')->value);
    $this->assertEquals('480-111-1111', $loaded->get('phone')->value);
    $this->assertEquals('480-111-1112', $loaded->get('fax')->value);
    $this->assertEquals('2 New Ave', $loaded->get('street_address')->value);
    $this->assertEquals('Scottsdale', $loaded->get('city')->value);
    $this->assertEquals('CA', $loaded->get('state')->value);
    $this->assertEquals('85251', $loaded->get('zip')->value);
    $this->assertEquals('New short bio.', $loaded->get('short_bio')->value);
    $this->assertEquals('<p>New bio.</p>', $loaded->get('bio')->value);
    $this->assertEquals('https://facebook.com/new', $loaded->get('facebook_url')->uri);
    $this->assertEquals('https://linkedin.com/in/new', $loaded->get('linkedin_url')->uri);
    $this->assertEquals('https://x.com/new', $loaded->get('x_url')->uri);
    $this->assertEquals('https://new.example.com', $loaded->get('personal_website_url')->uri);
  }

  /**
   * Tests profile creation with minimal fields (only required).
   */
  public function testMinimalProfileCreation(): void {
    // Only profile_type is truly required by the entity.
    $profile = Profile::create([
      'profile_type' => 'local',
    ]);
    $profile->save();

    $this->assertNotEmpty($profile->id());
    $loaded = Profile::load($profile->id());
    $this->assertEquals('local', $loaded->get('profile_type')->value);
    $this->assertTrue($loaded->get('first_name')->isEmpty());
    $this->assertTrue($loaded->get('display_last_name')->isEmpty());
    $this->assertTrue($loaded->get('email')->isEmpty());
    $this->assertTrue($loaded->get('bio')->isEmpty());
    $this->assertTrue($loaded->get('short_bio')->isEmpty());
  }

  /**
   * Tests that empty optional fields remain empty after save.
   */
  public function testEmptyOptionalFieldsRemainEmpty(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Empty',
      'display_last_name' => 'Fields',
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertTrue($loaded->get('email')->isEmpty());
    $this->assertTrue($loaded->get('phone')->isEmpty());
    $this->assertTrue($loaded->get('fax')->isEmpty());
    $this->assertTrue($loaded->get('street_address')->isEmpty());
    $this->assertTrue($loaded->get('city')->isEmpty());
    $this->assertTrue($loaded->get('state')->isEmpty());
    $this->assertTrue($loaded->get('zip')->isEmpty());
    $this->assertTrue($loaded->get('title_field')->isEmpty());
    $this->assertTrue($loaded->get('department')->isEmpty());
    $this->assertTrue($loaded->get('short_bio')->isEmpty());
    $this->assertTrue($loaded->get('bio')->isEmpty());
    $this->assertTrue($loaded->get('image_url')->isEmpty());
    $this->assertTrue($loaded->get('facebook_url')->isEmpty());
    $this->assertTrue($loaded->get('linkedin_url')->isEmpty());
    $this->assertTrue($loaded->get('x_url')->isEmpty());
    $this->assertTrue($loaded->get('personal_website_url')->isEmpty());
  }

  /**
   * Tests loadByProperties with directory profile type and asurite.
   */
  public function testLoadByProperties(): void {
    Profile::create([
      'profile_type' => 'from_directory',
      'first_name' => 'Dir',
      'display_last_name' => 'User',
      'asurite' => 'duser1',
      'status' => TRUE,
    ])->save();

    Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Local',
      'display_last_name' => 'User',
      'status' => TRUE,
    ])->save();

    $results = \Drupal::entityTypeManager()
      ->getStorage('asu_profile')
      ->loadByProperties([
        'asurite' => 'duser1',
        'profile_type' => 'from_directory',
      ]);

    $this->assertCount(1, $results);
    $found = reset($results);
    $this->assertEquals('Dir User', $found->get('name')->value);
    $this->assertEquals('duser1', $found->get('asurite')->value);
  }

  /**
   * Tests that profile_type allowed values are enforced.
   */
  public function testProfileTypeAllowedValues(): void {
    // 'local' should work.
    $profile_local = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Valid',
      'display_last_name' => 'Local',
    ]);
    $profile_local->save();
    $this->assertEquals('local', $profile_local->get('profile_type')->value);

    // 'from_directory' should work.
    $profile_dir = Profile::create([
      'profile_type' => 'from_directory',
      'first_name' => 'Valid',
      'display_last_name' => 'Dir',
      'asurite' => 'vdir',
    ]);
    $profile_dir->save();
    $this->assertEquals('from_directory', $profile_dir->get('profile_type')->value);
  }

  /**
   * Tests that bio field with empty value stays empty.
   */
  public function testBioFieldEmpty(): void {
    $profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'No',
      'display_last_name' => 'Bio',
      'bio' => NULL,
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertTrue($loaded->get('bio')->isEmpty());
  }

  /**
   * Tests populateFromRemoteData with all fields populated at once.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataAllFields(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'fullremote',
      'status' => TRUE,
    ]);

    $remote_data = [
      'name' => 'Full Remote',
      'first_name' => 'Full',
      'display_last_name' => 'Remote',
      'image_url' => 'https://webapp4.asu.edu/photo/fullremote',
      'title_field' => 'Distinguished Professor',
      'department' => 'Computer Science',
      'email' => 'full.remote@asu.edu',
      'phone' => '480-965-1234',
      'short_bio' => 'Expert in distributed systems.',
      'street_address' => '699 S Mill Ave',
      'city' => 'Tempe',
      'state' => 'AZ',
      'zip' => '85281',
      'bio' => '<p>Full <strong>remote</strong> bio with <em>emphasis</em>.</p>',
      'facebook_url' => ['uri' => 'https://facebook.com/fullremote'],
      'linkedin_url' => ['uri' => 'https://linkedin.com/in/fullremote'],
      'x_url' => ['uri' => 'https://x.com/fullremote'],
      'personal_website_url' => ['uri' => 'https://fullremote.asu.edu'],
    ];

    $profile->populateFromRemoteData($remote_data);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertEquals('Full Remote', $loaded->get('name')->value);
    $this->assertEquals('Full', $loaded->get('first_name')->value);
    $this->assertEquals('Remote', $loaded->get('display_last_name')->value);
    $this->assertEquals('https://webapp4.asu.edu/photo/fullremote', $loaded->get('image_url')->value);
    $this->assertEquals('Distinguished Professor', $loaded->get('title_field')->value);
    $this->assertEquals('Computer Science', $loaded->get('department')->value);
    $this->assertEquals('full.remote@asu.edu', $loaded->get('email')->value);
    $this->assertEquals('480-965-1234', $loaded->get('phone')->value);
    $this->assertEquals('Expert in distributed systems.', $loaded->get('short_bio')->value);
    $this->assertEquals('699 S Mill Ave', $loaded->get('street_address')->value);
    $this->assertEquals('Tempe', $loaded->get('city')->value);
    $this->assertEquals('AZ', $loaded->get('state')->value);
    $this->assertEquals('85281', $loaded->get('zip')->value);
    $this->assertEquals('<p>Full <strong>remote</strong> bio with <em>emphasis</em>.</p>', $loaded->get('bio')->value);
    $this->assertEquals('minimal_format', $loaded->get('bio')->format);
    $this->assertEquals('https://facebook.com/fullremote', $loaded->get('facebook_url')->uri);
    $this->assertEquals('https://linkedin.com/in/fullremote', $loaded->get('linkedin_url')->uri);
    $this->assertEquals('https://x.com/fullremote', $loaded->get('x_url')->uri);
    $this->assertEquals('https://fullremote.asu.edu', $loaded->get('personal_website_url')->uri);
  }

  /**
   * Tests that selected_deptid field can be set and retrieved.
   *
   * @covers ::baseFieldDefinitions
   */
  public function testSelectedDeptidField(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'first_name' => 'Dept',
      'display_last_name' => 'Select',
      'asurite' => 'dselect',
      'selected_deptid' => '12345',
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertEquals('12345', $loaded->get('selected_deptid')->value);
  }

  /**
   * Tests selected_deptid field defaults to empty when not set.
   *
   * @covers ::baseFieldDefinitions
   */
  public function testSelectedDeptidFieldDefaultsEmpty(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'first_name' => 'No',
      'display_last_name' => 'Deptid',
      'asurite' => 'nodeptid',
    ]);
    $profile->save();

    $loaded = Profile::load($profile->id());
    $this->assertTrue($loaded->get('selected_deptid')->isEmpty());
  }

  /**
   * Tests populateFromRemoteData() with affiliations matching primary deptid.
   *
   * When selected_deptid matches primary_deptid, title and department should
   * come from primary_title and primary_department in the affiliations array.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataWithAffiliationsPrimary(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'affprimary',
      'selected_deptid' => 'DEPT001',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'Aff',
      'display_last_name' => 'Primary',
      'title_field' => 'Remote Title',
      'department' => 'Remote Department',
    ];

    $affiliations = [
      'primary_title' => 'Primary Professor',
      'primary_department' => 'Primary Dept',
      'primary_deptid' => 'DEPT001',
      'titles' => ['Secondary Lecturer', 'Adjunct Faculty'],
      'departments' => ['Secondary Dept', 'Third Dept'],
      'deptids' => ['DEPT002', 'DEPT003'],
    ];

    $profile->populateFromRemoteData($remote_data, $affiliations);

    // Title and department should come from primary affiliation.
    $this->assertEquals('Primary Professor', $profile->get('title_field')->value);
    $this->assertEquals('Primary Dept', $profile->get('department')->value);
  }

  /**
   * Tests populateFromRemoteData() with affiliations matching non-primary.
   *
   * When selected_deptid matches a non-primary deptid, title and department
   * should come from the matching index in the affiliations arrays.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataWithAffiliationsNonPrimary(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'affnonprimary',
      'selected_deptid' => 'DEPT003',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'Aff',
      'display_last_name' => 'NonPrimary',
      'title_field' => 'Remote Title',
      'department' => 'Remote Department',
    ];

    $affiliations = [
      'primary_title' => 'Primary Professor',
      'primary_department' => 'Primary Dept',
      'primary_deptid' => 'DEPT001',
      'titles' => ['Secondary Lecturer', 'Adjunct Faculty'],
      'departments' => ['Secondary Dept', 'Third Dept'],
      'deptids' => ['DEPT002', 'DEPT003'],
    ];

    $profile->populateFromRemoteData($remote_data, $affiliations);

    // Title and department should come from the matching index (1).
    $this->assertEquals('Adjunct Faculty', $profile->get('title_field')->value);
    $this->assertEquals('Third Dept', $profile->get('department')->value);
  }

  /**
   * Tests populateFromRemoteData() without affiliations (backward compat).
   *
   * When no affiliations parameter is passed, title and department should
   * come from the remote_data array as before.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataWithoutAffiliationsBackwardCompat(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'backcompat',
      'selected_deptid' => 'DEPT001',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'Back',
      'display_last_name' => 'Compat',
      'title_field' => 'Remote Title From Data',
      'department' => 'Remote Dept From Data',
    ];

    // Call without affiliations parameter.
    $profile->populateFromRemoteData($remote_data);

    // Title and department should come from remote_data.
    $this->assertEquals('Remote Title From Data', $profile->get('title_field')->value);
    $this->assertEquals('Remote Dept From Data', $profile->get('department')->value);
  }

  /**
   * Tests populateFromRemoteData() with affiliations but empty selected_deptid.
   *
   * When selected_deptid is empty, the affiliation override logic should not
   * run, and title/department should come from remote_data.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataWithAffiliationsEmptyDeptid(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'emptydeptid',
      'status' => TRUE,
    ]);
    // Explicitly do NOT set selected_deptid.

    $remote_data = [
      'first_name' => 'Empty',
      'display_last_name' => 'Deptid',
      'title_field' => 'Title From Remote',
      'department' => 'Dept From Remote',
    ];

    $affiliations = [
      'primary_title' => 'Should Not Use This',
      'primary_department' => 'Should Not Use This Dept',
      'primary_deptid' => 'DEPT001',
      'titles' => ['Also Not This'],
      'departments' => ['Nor This'],
      'deptids' => ['DEPT002'],
    ];

    $profile->populateFromRemoteData($remote_data, $affiliations);

    // Title and department should come from remote_data since
    // selected_deptid is empty.
    $this->assertEquals('Title From Remote', $profile->get('title_field')->value);
    $this->assertEquals('Dept From Remote', $profile->get('department')->value);
  }

  /**
   * Tests populateFromRemoteData() with affiliations and non-matching deptid.
   *
   * When selected_deptid doesn't match any affiliation, title/department
   * should remain as set from remote_data.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataWithAffiliationsNoMatch(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'nomatch',
      'selected_deptid' => 'NONEXISTENT',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'No',
      'display_last_name' => 'Match',
      'title_field' => 'Original Title',
      'department' => 'Original Department',
    ];

    $affiliations = [
      'primary_title' => 'Primary Title',
      'primary_department' => 'Primary Dept',
      'primary_deptid' => 'DEPT001',
      'titles' => ['Secondary Title'],
      'departments' => ['Secondary Dept'],
      'deptids' => ['DEPT002'],
    ];

    $profile->populateFromRemoteData($remote_data, $affiliations);

    // Title and department should remain from remote_data since no match.
    $this->assertEquals('Original Title', $profile->get('title_field')->value);
    $this->assertEquals('Original Department', $profile->get('department')->value);
  }

  /**
   * Tests populateFromRemoteData() with numeric string deptid matching.
   *
   * When selected_deptid is a numeric string like '12345' and affiliations
   * use numeric deptids, array_search with strict mode should still match
   * correctly since both are strings.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataWithNumericDeptid(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'numericdept',
      'selected_deptid' => '12345',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'Numeric',
      'display_last_name' => 'Deptid',
      'title_field' => 'Remote Title',
      'department' => 'Remote Department',
    ];

    $affiliations = [
      'primary_title' => 'Primary Prof',
      'primary_department' => 'Primary CS',
      'primary_deptid' => '99999',
      'titles' => ['Secondary Lecturer', 'Matching Faculty'],
      'departments' => ['Secondary Dept', 'Matching Dept'],
      'deptids' => ['67890', '12345'],
    ];

    $profile->populateFromRemoteData($remote_data, $affiliations);

    // selected_deptid '12345' should match deptids[1] via strict array_search.
    $this->assertEquals('Matching Faculty', $profile->get('title_field')->value);
    $this->assertEquals('Matching Dept', $profile->get('department')->value);
  }

  /**
   * Tests populateFromRemoteData() with numeric string matching primary deptid.
   *
   * When both selected_deptid and primary_deptid are the same numeric string,
   * the primary affiliation should be used via strict string comparison.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataWithNumericPrimaryDeptid(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'numprimary',
      'selected_deptid' => '54321',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'NumPrimary',
      'display_last_name' => 'Test',
      'title_field' => 'Remote Title',
      'department' => 'Remote Dept',
    ];

    $affiliations = [
      'primary_title' => 'Distinguished Professor',
      'primary_department' => 'Engineering',
      'primary_deptid' => '54321',
      'titles' => ['Adjunct'],
      'departments' => ['Physics'],
      'deptids' => ['11111'],
    ];

    $profile->populateFromRemoteData($remote_data, $affiliations);

    // selected_deptid '54321' === primary_deptid '54321', so primary is used.
    $this->assertEquals('Distinguished Professor', $profile->get('title_field')->value);
    $this->assertEquals('Engineering', $profile->get('department')->value);
  }

  /**
   * Tests populateFromRemoteData() affiliation override with empty title.
   *
   * When the matched affiliation has an empty title string, it should still
   * override the title_field (setting it to empty), since the affiliation
   * match takes precedence over remote_data values.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataAffiliationOverridesEmptyValues(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'emptyaff',
      'selected_deptid' => 'DEPT_EMPTY',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'Empty',
      'display_last_name' => 'Affiliation',
      'title_field' => 'Remote Title Should Be Overridden',
      'department' => 'Remote Dept Should Be Overridden',
    ];

    $affiliations = [
      'primary_title' => 'Primary Title',
      'primary_department' => 'Primary Dept',
      'primary_deptid' => 'DEPT_PRIMARY',
      'titles' => [''],
      'departments' => [''],
      'deptids' => ['DEPT_EMPTY'],
    ];

    $profile->populateFromRemoteData($remote_data, $affiliations);

    // The matched affiliation has empty title and department strings.
    // These should still override the remote_data values since the
    // affiliation was matched by deptid.
    $this->assertEquals('', $profile->get('title_field')->value);
    $this->assertEquals('', $profile->get('department')->value);
    // Other fields from remote_data should still be populated normally.
    $this->assertEquals('Empty', $profile->get('first_name')->value);
    $this->assertEquals('Affiliation', $profile->get('display_last_name')->value);
  }

  /**
   * Tests populateFromRemoteData() affiliation with empty department only.
   *
   * When the matched affiliation has a valid title but empty department,
   * the title should be set from the affiliation and department should be
   * empty.
   *
   * @covers ::populateFromRemoteData
   */
  public function testPopulateFromRemoteDataAffiliationEmptyDepartmentOnly(): void {
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'emptydept',
      'selected_deptid' => 'DEPT_PARTIAL',
      'status' => TRUE,
    ]);

    $remote_data = [
      'first_name' => 'Partial',
      'display_last_name' => 'Empty',
      'title_field' => 'Should Be Overridden',
      'department' => 'Should Also Be Overridden',
    ];

    $affiliations = [
      'primary_title' => 'Primary Title',
      'primary_department' => 'Primary Dept',
      'primary_deptid' => 'DEPT_PRIMARY',
      'titles' => ['Valid Affiliation Title'],
      'departments' => [''],
      'deptids' => ['DEPT_PARTIAL'],
    ];

    $profile->populateFromRemoteData($remote_data, $affiliations);

    // Title from the matched affiliation should be used.
    $this->assertEquals('Valid Affiliation Title', $profile->get('title_field')->value);
    // Department is empty in the matched affiliation.
    $this->assertEquals('', $profile->get('department')->value);
  }

  /**
   * Tests that duplicate ASURITE IDs are detected for new directory profiles.
   *
   * The ProfileForm validates that no other from_directory profile exists
   * with the same ASURITE before allowing save.
   */
  public function testDuplicateAsuriteDetection(): void {
    // Create an existing directory profile.
    $existing = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'jsmith',
      'first_name' => 'John',
      'display_last_name' => 'Smith',
      'status' => TRUE,
    ]);
    $existing->save();

    // Query for profiles with the same asurite (simulates the validation).
    $query = \Drupal::entityTypeManager()
      ->getStorage('asu_profile')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('profile_type', 'from_directory')
      ->condition('asurite', 'jsmith');
    $results = $query->execute();

    $this->assertNotEmpty($results, 'Should find existing profile with same ASURITE.');
    $this->assertContains((int) $existing->id(), array_map('intval', $results));
  }

  /**
   * Tests that duplicate ASURITE check excludes current entity on edit.
   */
  public function testDuplicateAsuriteExcludesCurrentEntity(): void {
    // Create a directory profile.
    $profile = Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'jdoe',
      'first_name' => 'Jane',
      'display_last_name' => 'Doe',
      'status' => TRUE,
    ]);
    $profile->save();

    // Query excluding the current entity (simulates edit form validation).
    $query = \Drupal::entityTypeManager()
      ->getStorage('asu_profile')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('profile_type', 'from_directory')
      ->condition('asurite', 'jdoe')
      ->condition('id', $profile->id(), '<>');
    $results = $query->execute();

    $this->assertEmpty($results, 'Should not find duplicates when excluding the current entity.');
  }

  /**
   * Tests that different ASURITEs do not trigger duplicate detection.
   */
  public function testNoDuplicateForDifferentAsurites(): void {
    // Create a directory profile.
    Profile::create([
      'profile_type' => 'from_directory',
      'asurite' => 'jsmith',
      'first_name' => 'John',
      'display_last_name' => 'Smith',
      'status' => TRUE,
    ])->save();

    // Query for a different ASURITE.
    $query = \Drupal::entityTypeManager()
      ->getStorage('asu_profile')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('profile_type', 'from_directory')
      ->condition('asurite', 'jdoe');
    $results = $query->execute();

    $this->assertEmpty($results, 'Should not find profiles with a different ASURITE.');
  }

  /**
   * Tests that local profiles with same name don't conflict with directory.
   */
  public function testLocalProfileDoesNotConflictWithDirectory(): void {
    // Create a local profile with similar data.
    Profile::create([
      'profile_type' => 'local',
      'asurite' => '',
      'first_name' => 'John',
      'display_last_name' => 'Smith',
      'status' => TRUE,
    ])->save();

    // Query for directory profiles with asurite 'jsmith'.
    $query = \Drupal::entityTypeManager()
      ->getStorage('asu_profile')
      ->getQuery()
      ->accessCheck(FALSE)
      ->condition('profile_type', 'from_directory')
      ->condition('asurite', 'jsmith');
    $results = $query->execute();

    $this->assertEmpty($results, 'Local profiles should not conflict with directory ASURITE checks.');
  }

}
