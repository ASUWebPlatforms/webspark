<?php

declare(strict_types=1);

namespace Drupal\Tests\webspark_webdir\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\Tests\user\Traits\UserCreationTrait;
use Drupal\webspark_webdir\Entity\Profile;

/**
 * Tests the ProfileAccessControlHandler.
 *
 * @group webspark_webdir
 * @coversDefaultClass \Drupal\webspark_webdir\ProfileAccessControlHandler
 */
class ProfileAccessControlHandlerTest extends KernelTestBase {

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
   * A test profile entity.
   *
   * @var \Drupal\webspark_webdir\Entity\Profile
   */
  protected Profile $profile;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installEntitySchema('user');
    $this->installEntitySchema('asu_profile');
    $this->installConfig(['system']);

    // Create a root user (uid 1) to prevent test users from being super-admin.
    $this->createUser();

    // Create a profile to test access against.
    $this->profile = Profile::create([
      'profile_type' => 'local',
      'first_name' => 'Test',
      'display_last_name' => 'Profile',
      'status' => TRUE,
    ]);
    $this->profile->save();
  }

  /**
   * Tests that admin permission grants all access.
   *
   * @covers ::checkAccess
   */
  public function testAdminPermissionGrantsAllAccess(): void {
    $admin = $this->createUser(['administer asu_profile']);

    foreach (['view', 'update', 'delete'] as $operation) {
      $access = $this->profile->access($operation, $admin, TRUE);
      $this->assertTrue($access->isAllowed(), "Admin should have '$operation' access.");
    }
  }

  /**
   * Tests that the admin permission grants create access.
   *
   * @covers ::checkCreateAccess
   */
  public function testAdminPermissionGrantsCreateAccess(): void {
    $admin = $this->createUser(['administer asu_profile']);
    $access = \Drupal::entityTypeManager()
      ->getAccessControlHandler('asu_profile')
      ->createAccess(NULL, $admin, [], TRUE);
    $this->assertTrue($access->isAllowed(), 'Admin should be able to create profiles.');
  }

  /**
   * Tests the 'view asu_profile' permission.
   *
   * @covers ::checkAccess
   */
  public function testViewPermission(): void {
    $viewer = $this->createUser(['view asu_profile']);
    $no_access = $this->createUser([]);

    $this->assertTrue(
      $this->profile->access('view', $viewer, TRUE)->isAllowed(),
      'User with "view asu_profile" should be able to view.'
    );
    $this->assertFalse(
      $this->profile->access('view', $no_access, TRUE)->isAllowed(),
      'User without permission should not be able to view.'
    );
  }

  /**
   * Tests the 'edit asu_profile' permission maps to the 'update' operation.
   *
   * @covers ::checkAccess
   */
  public function testEditPermission(): void {
    $editor = $this->createUser(['edit asu_profile']);
    $no_access = $this->createUser([]);

    $this->assertTrue(
      $this->profile->access('update', $editor, TRUE)->isAllowed(),
      'User with "edit asu_profile" should be able to update.'
    );
    $this->assertFalse(
      $this->profile->access('update', $no_access, TRUE)->isAllowed(),
      'User without permission should not be able to update.'
    );
  }

  /**
   * Tests the 'delete asu_profile' permission.
   *
   * @covers ::checkAccess
   */
  public function testDeletePermission(): void {
    $deleter = $this->createUser(['delete asu_profile']);
    $no_access = $this->createUser([]);

    $this->assertTrue(
      $this->profile->access('delete', $deleter, TRUE)->isAllowed(),
      'User with "delete asu_profile" should be able to delete.'
    );
    $this->assertFalse(
      $this->profile->access('delete', $no_access, TRUE)->isAllowed(),
      'User without permission should not be able to delete.'
    );
  }

  /**
   * Tests the 'create asu_profile' permission.
   *
   * @covers ::checkCreateAccess
   */
  public function testCreatePermission(): void {
    $creator = $this->createUser(['create asu_profile']);
    $no_access = $this->createUser([]);

    $handler = \Drupal::entityTypeManager()
      ->getAccessControlHandler('asu_profile');

    $this->assertTrue(
      $handler->createAccess(NULL, $creator, [], TRUE)->isAllowed(),
      'User with "create asu_profile" should be able to create.'
    );
    $this->assertFalse(
      $handler->createAccess(NULL, $no_access, [], TRUE)->isAllowed(),
      'User without permission should not be able to create.'
    );
  }

  /**
   * Tests that an unknown operation returns neutral access.
   *
   * @covers ::checkAccess
   */
  public function testUnknownOperationReturnsNeutral(): void {
    $user = $this->createUser(['view asu_profile']);
    $access = $this->profile->access('some_random_operation', $user, TRUE);
    $this->assertTrue($access->isNeutral(), 'Unknown operation should return neutral access.');
  }

  /**
   * Tests that individual permissions do not grant access to other operations.
   *
   * @covers ::checkAccess
   */
  public function testPermissionsAreIsolated(): void {
    $viewer_only = $this->createUser(['view asu_profile']);

    $this->assertFalse(
      $this->profile->access('update', $viewer_only, TRUE)->isAllowed(),
      'View-only user should not be able to update.'
    );
    $this->assertFalse(
      $this->profile->access('delete', $viewer_only, TRUE)->isAllowed(),
      'View-only user should not be able to delete.'
    );

    $editor_only = $this->createUser(['edit asu_profile']);
    $this->assertFalse(
      $this->profile->access('delete', $editor_only, TRUE)->isAllowed(),
      'Edit-only user should not be able to delete.'
    );
  }

  /**
   * Tests that access results cache per permissions.
   *
   * @covers ::checkAccess
   */
  public function testAccessResultCachesPerPermissions(): void {
    $admin = $this->createUser(['administer asu_profile']);
    $access = $this->profile->access('view', $admin, TRUE);

    $this->assertTrue($access->isAllowed());
    // Admin result should vary by permissions.
    $this->assertContains('user.permissions', $access->getCacheContexts());
  }

}
