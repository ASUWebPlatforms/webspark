<?php

declare(strict_types=1);

namespace Drupal\Tests\webspark_webdir\Kernel;

use Drupal\Core\Url;
use Symfony\Component\HttpFoundation\Session\Storage\MockArraySessionStorage;
use Symfony\Component\HttpFoundation\Session\Session;
use Drupal\Core\Form\FormState;
use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\webspark_webdir\Entity\Profile;
use Drupal\webspark_webdir\ProfileListBuilder;
use Symfony\Component\HttpFoundation\Request;

/**
 * Tests the ProfileListBuilder form and list functionality.
 *
 * @group webspark_webdir
 * @coversDefaultClass \Drupal\webspark_webdir\ProfileListBuilder
 */
class ProfileListBuilderTest extends KernelTestBase {

  use UserCreationTrait;

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
   * The list builder instance.
   *
   * @var \Drupal\webspark_webdir\ProfileListBuilder
   */
  protected ProfileListBuilder $listBuilder;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('asu_profile');
    $this->installConfig(['system']);

    // Create an admin user and set as current user.
    $admin = $this->createUser(['administer asu_profile']);
    $this->setCurrentUser($admin);

    $this->listBuilder = $this->container->get('entity_type.manager')
      ->getListBuilder('asu_profile');
  }

  /**
   * Helper to create a profile entity.
   *
   * @param array $values
   *   Override values.
   *
   * @return \Drupal\webspark_webdir\Entity\Profile
   *   The saved profile.
   */
  protected function createProfile(array $values = []): Profile {
    $defaults = [
      'profile_type' => 'local',
      'first_name' => 'Test',
      'display_last_name' => 'User',
      'status' => TRUE,
    ];
    $profile = Profile::create($values + $defaults);
    $profile->save();
    return $profile;
  }

  /**
   * Tests getFormId returns the correct form ID.
   *
   * @covers ::getFormId
   */
  public function testGetFormId(): void {
    $this->assertEquals('asu_profile_admin_form', $this->listBuilder->getFormId());
  }

  /**
   * Tests buildForm returns expected structure.
   *
   * @covers ::buildForm
   */
  public function testBuildFormStructure(): void {
    $form_state = new FormState();
    $form = $this->listBuilder->buildForm([], $form_state);

    // Assert filter section exists.
    $this->assertArrayHasKey('filters', $form);
    $this->assertArrayHasKey('name', $form['filters']);
    $this->assertArrayHasKey('profile_type', $form['filters']);
    $this->assertArrayHasKey('status', $form['filters']);
    $this->assertArrayHasKey('filter_actions', $form['filters']);

    // Assert bulk section exists.
    $this->assertArrayHasKey('bulk', $form);
    $this->assertArrayHasKey('action', $form['bulk']);
    $this->assertArrayHasKey('apply', $form['bulk']);

    // Assert only 'delete' action is available (no enable/disable).
    $options = $form['bulk']['action']['#options'];
    $this->assertArrayHasKey('', $options);
    $this->assertArrayHasKey('delete', $options);
    $this->assertArrayNotHasKey('enable', $options);
    $this->assertArrayNotHasKey('disable', $options);

    // Assert profiles table exists.
    $this->assertArrayHasKey('profiles', $form);
    $this->assertEquals('tableselect', $form['profiles']['#type']);

    // Assert pager exists.
    $this->assertArrayHasKey('pager', $form);
  }

  /**
   * Tests buildForm with no profiles shows empty message.
   *
   * @covers ::buildForm
   */
  public function testBuildFormEmpty(): void {
    $form_state = new FormState();
    $form = $this->listBuilder->buildForm([], $form_state);

    $this->assertEmpty($form['profiles']['#options']);
    $this->assertEquals('No profiles found.', (string) $form['profiles']['#empty']);
  }

  /**
   * Tests buildForm with profiles populates the table.
   *
   * @covers ::buildForm
   */
  public function testBuildFormWithProfiles(): void {
    $profile1 = $this->createProfile([
      'first_name' => 'Alice',
      'display_last_name' => 'Smith',
      'profile_type' => 'local',
    ]);
    $profile2 = $this->createProfile([
      'first_name' => 'Bob',
      'display_last_name' => 'Jones',
      'profile_type' => 'from_directory',
      'asurite' => 'bjones',
    ]);

    $form_state = new FormState();
    $form = $this->listBuilder->buildForm([], $form_state);

    $options = $form['profiles']['#options'];
    $this->assertCount(2, $options);
    $this->assertArrayHasKey($profile1->id(), $options);
    $this->assertArrayHasKey($profile2->id(), $options);

    // Verify profile type is shown.
    $this->assertEquals('local', $options[$profile1->id()]['profile_type']);
    $this->assertEquals('from_directory', $options[$profile2->id()]['profile_type']);
  }

  /**
   * Tests that the table shows correct status values.
   *
   * @covers ::buildForm
   */
  public function testBuildFormStatusDisplay(): void {
    $enabled = $this->createProfile(['status' => TRUE]);
    $disabled = $this->createProfile(['status' => FALSE]);

    $form_state = new FormState();
    $form = $this->listBuilder->buildForm([], $form_state);

    $options = $form['profiles']['#options'];
    $this->assertEquals('Enabled', (string) $options[$enabled->id()]['status']);
    $this->assertEquals('Disabled', (string) $options[$disabled->id()]['status']);
  }

  /**
   * Helper to get a list builder with a custom request.
   *
   * @param array $query
   *   Query parameters.
   *
   * @return \Drupal\webspark_webdir\ProfileListBuilder
   *   A fresh list builder instance.
   */
  protected function getListBuilderWithRequest(array $query = []): ProfileListBuilder {
    $request = Request::create('/admin/content/asu-profile', 'GET', $query);
    $request->setSession(new Session(
      new MockArraySessionStorage()
    ));
    $this->container->get('request_stack')->push($request);

    $entity_type = $this->container->get('entity_type.manager')->getDefinition('asu_profile');
    return ProfileListBuilder::createInstance($this->container, $entity_type);
  }

  /**
   * Tests filter by name.
   *
   * @covers ::getEntityIds
   */
  public function testFilterByName(): void {
    $this->createProfile(['first_name' => 'Alice', 'display_last_name' => 'Smith']);
    $this->createProfile(['first_name' => 'Bob', 'display_last_name' => 'Jones']);

    $listBuilder = $this->getListBuilderWithRequest(['name' => 'Alice']);

    $form_state = new FormState();
    $form = $listBuilder->buildForm([], $form_state);

    $options = $form['profiles']['#options'];
    $this->assertCount(1, $options);
    $first_option = reset($options);
    // Use getText() to get the link text without triggering full URL
    // resolution, which requires the router table in kernel tests.
    $this->assertStringContainsString('Alice', (string) $first_option['name']->getText());
  }

  /**
   * Tests filter by profile type.
   *
   * @covers ::getEntityIds
   */
  public function testFilterByProfileType(): void {
    $this->createProfile(['profile_type' => 'local', 'first_name' => 'Local']);
    $this->createProfile([
      'profile_type' => 'from_directory',
      'first_name' => 'Remote',
      'asurite' => 'remote1',
    ]);

    $listBuilder = $this->getListBuilderWithRequest(['profile_type' => 'local']);

    $form_state = new FormState();
    $form = $listBuilder->buildForm([], $form_state);

    $options = $form['profiles']['#options'];
    $this->assertCount(1, $options);
    $first_option = reset($options);
    $this->assertEquals('local', $first_option['profile_type']);
  }

  /**
   * Tests filter by status.
   *
   * @covers ::getEntityIds
   */
  public function testFilterByStatus(): void {
    $this->createProfile(['first_name' => 'Active', 'status' => TRUE]);
    $this->createProfile(['first_name' => 'Inactive', 'status' => FALSE]);

    $listBuilder = $this->getListBuilderWithRequest(['status' => '1']);

    $form_state = new FormState();
    $form = $listBuilder->buildForm([], $form_state);

    $options = $form['profiles']['#options'];
    $this->assertCount(1, $options);
    $first_option = reset($options);
    $this->assertEquals('Enabled', (string) $first_option['status']);
  }

  /**
   * Tests validateBulkForm sets error when no action selected.
   *
   * @covers ::validateBulkForm
   */
  public function testValidateBulkFormNoAction(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->setValue('action', '');
    $form_state->setValue('profiles', []);

    $this->listBuilder->validateBulkForm($form, $form_state);

    $errors = $form_state->getErrors();
    $this->assertNotEmpty($errors);
    $this->assertArrayHasKey('action', $errors);
  }

  /**
   * Tests validateBulkForm sets error when no profiles selected.
   *
   * @covers ::validateBulkForm
   */
  public function testValidateBulkFormNoProfilesSelected(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->setValue('action', 'delete');
    $form_state->setValue('profiles', [0, 0, 0]);

    $this->listBuilder->validateBulkForm($form, $form_state);

    $errors = $form_state->getErrors();
    $this->assertNotEmpty($errors);
    $this->assertArrayHasKey('profiles', $errors);
  }

  /**
   * Tests validateBulkForm passes when action and profiles are valid.
   *
   * @covers ::validateBulkForm
   */
  public function testValidateBulkFormValid(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->setValue('action', 'delete');
    $form_state->setValue('profiles', [1 => '1']);

    $this->listBuilder->validateBulkForm($form, $form_state);

    $errors = $form_state->getErrors();
    $this->assertEmpty($errors);
  }

  /**
   * Tests submitBulkForm deletes selected profiles.
   *
   * @covers ::submitBulkForm
   */
  public function testSubmitBulkFormDelete(): void {
    $profile1 = $this->createProfile(['first_name' => 'ToDelete']);
    $profile2 = $this->createProfile(['first_name' => 'ToKeep']);

    $form = [];
    $form_state = new FormState();
    $form_state->setValue('action', 'delete');
    $form_state->setValue('profiles', [$profile1->id() => (string) $profile1->id(), $profile2->id() => 0]);

    $this->listBuilder->submitBulkForm($form, $form_state);

    // Profile 1 should be deleted.
    $this->assertNull(Profile::load($profile1->id()));
    // Profile 2 should still exist.
    $this->assertNotNull(Profile::load($profile2->id()));
  }

  /**
   * Tests submitBulkForm does nothing when no profiles selected.
   *
   * @covers ::submitBulkForm
   */
  public function testSubmitBulkFormEmptySelection(): void {
    $profile = $this->createProfile(['first_name' => 'Safe']);

    $form = [];
    $form_state = new FormState();
    $form_state->setValue('action', 'delete');
    $form_state->setValue('profiles', []);

    $this->listBuilder->submitBulkForm($form, $form_state);

    // Profile should still exist.
    $this->assertNotNull(Profile::load($profile->id()));
  }

  /**
   * Tests submitFilterForm sets redirect with filter query parameters.
   *
   * @covers ::submitFilterForm
   */
  public function testSubmitFilterFormRedirect(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->setValue('name', 'John');
    $form_state->setValue('profile_type', 'local');
    $form_state->setValue('status', '1');

    $this->listBuilder->submitFilterForm($form, $form_state);

    $redirect = $form_state->getRedirect();
    $this->assertInstanceOf(Url::class, $redirect);
    $options = $redirect->getOptions();
    $this->assertEquals('John', $options['query']['name']);
    $this->assertEquals('local', $options['query']['profile_type']);
    $this->assertEquals('1', $options['query']['status']);
  }

  /**
   * Tests submitFilterForm omits empty filter values.
   *
   * @covers ::submitFilterForm
   */
  public function testSubmitFilterFormOmitsEmptyValues(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->setValue('name', '');
    $form_state->setValue('profile_type', '');
    $form_state->setValue('status', '');

    $this->listBuilder->submitFilterForm($form, $form_state);

    $redirect = $form_state->getRedirect();
    $this->assertInstanceOf(Url::class, $redirect);
    $options = $redirect->getOptions();
    $this->assertEmpty($options['query'] ?? []);
  }

  /**
   * Tests render() contains add button and form.
   *
   * @covers ::render
   */
  public function testRender(): void {
    $build = $this->listBuilder->render();

    $this->assertArrayHasKey('add_button', $build);
    $this->assertEquals('link', $build['add_button']['#type']);
    $this->assertEquals('Add Profile', (string) $build['add_button']['#title']);
    $this->assertContains('button--primary', $build['add_button']['#attributes']['class']);

    $this->assertArrayHasKey('form', $build);
  }

  /**
   * Tests sorting by created date descending by default.
   *
   * @covers ::getEntityIds
   */
  public function testDefaultSortByCreatedDesc(): void {
    // Create profiles with different timestamps.
    $older = $this->createProfile(['first_name' => 'Older']);
    // Manually update created time.
    $older->set('created', time() - 3600);
    $older->save();

    $newer = $this->createProfile(['first_name' => 'Newer']);

    $form_state = new FormState();
    $form = $this->listBuilder->buildForm([], $form_state);

    $options = $form['profiles']['#options'];
    $ids = array_keys($options);

    // Newer should come first (DESC by created).
    $this->assertEquals($newer->id(), $ids[0]);
    $this->assertEquals($older->id(), $ids[1]);
  }

  /**
   * Tests buildHeader returns expected columns.
   *
   * @covers ::buildHeader
   */
  public function testBuildHeader(): void {
    $header = $this->listBuilder->buildHeader();

    $this->assertArrayHasKey('id', $header);
    $this->assertArrayHasKey('name', $header);
    $this->assertArrayHasKey('profile_type', $header);
    $this->assertArrayHasKey('status', $header);
    $this->assertArrayHasKey('uid', $header);
    $this->assertArrayHasKey('created', $header);
  }

  /**
   * Tests buildRow returns expected data.
   *
   * @covers ::buildRow
   */
  public function testBuildRow(): void {
    $profile = $this->createProfile([
      'first_name' => 'Jane',
      'display_last_name' => 'Doe',
      'profile_type' => 'local',
      'status' => TRUE,
    ]);

    $row = $this->listBuilder->buildRow($profile);

    $this->assertEquals($profile->id(), $row['id']);
    $this->assertEquals('local', $row['profile_type']);
    $this->assertEquals('Enabled', (string) $row['status']);
    $this->assertArrayHasKey('uid', $row);
    $this->assertNotEmpty($row['created']);
  }

}
