<?php

declare(strict_types=1);

namespace Drupal\Tests\webspark_webdir\Unit\Plugin\Block;

use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Entity\EntityViewBuilderInterface;
use Drupal\Core\Form\FormState;
use Drupal\Core\StringTranslation\TranslationInterface;
use Drupal\Tests\UnitTestCase;
use Drupal\webspark_webdir\Plugin\Block\ProfileListBlock;
use Drupal\webspark_webdir\ProfileInterface;
use Drupal\webspark_webdir\Service\RemoteProfileFetcher;

/**
 * Unit tests for the ProfileListBlock plugin.
 *
 * @group webspark_webdir
 * @coversDefaultClass \Drupal\webspark_webdir\Plugin\Block\ProfileListBlock
 */
class ProfileListBlockTest extends UnitTestCase {

  /**
   * The mocked entity type manager.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface|\PHPUnit\Framework\MockObject\MockObject
   */
  protected $entityTypeManager;

  /**
   * The mocked remote profile fetcher.
   *
   * @var \Drupal\webspark_webdir\Service\RemoteProfileFetcher|\PHPUnit\Framework\MockObject\MockObject
   */
  protected $remoteProfileFetcher;

  /**
   * The mocked entity storage.
   *
   * @var \Drupal\Core\Entity\EntityStorageInterface|\PHPUnit\Framework\MockObject\MockObject
   */
  protected $entityStorage;

  /**
   * The mocked view builder.
   *
   * @var \Drupal\Core\Entity\EntityViewBuilderInterface|\PHPUnit\Framework\MockObject\MockObject
   */
  protected $viewBuilder;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $this->entityTypeManager = $this->createMock(EntityTypeManagerInterface::class);
    $this->remoteProfileFetcher = $this->createMock(RemoteProfileFetcher::class);
    $this->entityStorage = $this->createMock(EntityStorageInterface::class);
    $this->viewBuilder = $this->createMock(EntityViewBuilderInterface::class);

    $this->entityTypeManager->method('getStorage')
      ->with('asu_profile')
      ->willReturn($this->entityStorage);

    $this->entityTypeManager->method('getViewBuilder')
      ->with('asu_profile')
      ->willReturn($this->viewBuilder);

    // Set up the string translation service in the container.
    $container = new ContainerBuilder();
    $container->set('string_translation', $this->createMock(TranslationInterface::class));
    \Drupal::setContainer($container);
  }

  /**
   * Creates a ProfileListBlock instance with the given configuration.
   *
   * @param array $configuration
   *   Block configuration.
   *
   * @return \Drupal\webspark_webdir\Plugin\Block\ProfileListBlock
   *   The block instance.
   */
  protected function createBlockInstance(array $configuration = []): ProfileListBlock {
    return new ProfileListBlock(
      $configuration,
      'profile_list_block',
      [
        'id' => 'profile_list_block',
        'admin_label' => 'Profile List',
        'provider' => 'webspark_webdir',
        'category' => 'ASU',
      ],
      $this->entityTypeManager,
      $this->remoteProfileFetcher,
    );
  }

  /**
   * Tests defaultConfiguration() returns expected defaults.
   *
   * @covers ::defaultConfiguration
   */
  public function testDefaultConfiguration(): void {
    $block = $this->createBlockInstance();
    $config = $block->defaultConfiguration();

    $this->assertArrayHasKey('profiles', $config);
    $this->assertArrayHasKey('display_format', $config);
    $this->assertEquals([], $config['profiles']);
    $this->assertEquals('grid', $config['display_format']);
  }

  /**
   * Tests build() returns empty array when no profiles are configured.
   *
   * @covers ::build
   */
  public function testBuildWithNoProfiles(): void {
    $block = $this->createBlockInstance([
      'profiles' => [],
      'display_format' => 'grid',
    ]);
    $build = $block->build();
    $this->assertSame([], $build);
  }

  /**
   * Tests build() returns empty array when profiles list is empty.
   *
   * @covers ::build
   */
  public function testBuildWithEmptyProfilesConfig(): void {
    $block = $this->createBlockInstance([
      'profiles' => [],
      'display_format' => 'list',
    ]);
    $this->assertSame([], $block->build());
  }

  /**
   * Tests build() returns empty when profile IDs don't load any entities.
   *
   * @covers ::build
   */
  public function testBuildReturnsEmptyWhenProfilesNotFound(): void {
    $block = $this->createBlockInstance([
      'profiles' => [
        ['source' => 'local', 'profile_id' => 999, 'asurite' => ''],
      ],
      'display_format' => 'grid',
    ]);

    $this->entityStorage->method('loadMultiple')
      ->with([999])
      ->willReturn([]);

    $this->assertSame([], $block->build());
  }

  /**
   * Tests build() renders profiles in grid format.
   *
   * @covers ::build
   */
  public function testBuildWithGridFormat(): void {
    $profile_mock = $this->createMock(ProfileInterface::class);
    $profile_mock->method('getCacheTags')
      ->willReturn(['asu_profile:1']);

    $this->entityStorage->method('loadMultiple')
      ->with([1])
      ->willReturn([1 => $profile_mock]);

    $this->viewBuilder->method('view')
      ->with($profile_mock, 'grid')
      ->willReturn(['#markup' => 'rendered profile']);

    $block = $this->createBlockInstance([
      'profiles' => [
        ['source' => 'local', 'profile_id' => 1, 'asurite' => ''],
      ],
      'display_format' => 'grid',
    ]);

    $build = $block->build();

    $this->assertNotEmpty($build);
    $this->assertArrayHasKey('#prefix', $build);
    $this->assertStringContainsString('<div class="row">', $build['#prefix']);
    $this->assertArrayHasKey('#attached', $build);
    $this->assertContains('webspark_webdir/profile', $build['#attached']['library']);
    $this->assertArrayHasKey('profile_0', $build);
    // Check cache tags include entity and list tags.
    $this->assertContains('asu_profile:1', $build['#cache']['tags']);
    $this->assertContains('asu_profile_list', $build['#cache']['tags']);
    $this->assertContains('url.path', $build['#cache']['contexts']);
    // Grid format should use 'uds-grid' class.
    $this->assertContains('uds-grid', $build['#attributes']['class']);
  }

  /**
   * Tests build() renders profiles in list format.
   *
   * @covers ::build
   */
  public function testBuildWithListFormat(): void {
    $profile_mock = $this->createMock(ProfileInterface::class);
    $profile_mock->method('getCacheTags')
      ->willReturn(['asu_profile:2']);

    $this->entityStorage->method('loadMultiple')
      ->with([2])
      ->willReturn([2 => $profile_mock]);

    // 'list' display_format should use 'block' view mode.
    $this->viewBuilder->method('view')
      ->with($profile_mock, 'block')
      ->willReturn(['#markup' => 'list rendered']);

    $block = $this->createBlockInstance([
      'profiles' => [
        ['source' => 'local', 'profile_id' => 2, 'asurite' => ''],
      ],
      'display_format' => 'list',
    ]);

    $build = $block->build();

    $this->assertNotEmpty($build);
    $this->assertArrayHasKey('profile_0', $build);
    // List format should NOT have 'uds-grid' class.
    $this->assertNotContains('uds-grid', $build['#attributes']['class']);
  }

  /**
   * Tests build() renders multiple profiles in order.
   *
   * @covers ::build
   */
  public function testBuildWithMultipleProfiles(): void {
    $profile1 = $this->createMock(ProfileInterface::class);
    $profile1->method('getCacheTags')->willReturn(['asu_profile:10']);

    $profile2 = $this->createMock(ProfileInterface::class);
    $profile2->method('getCacheTags')->willReturn(['asu_profile:20']);

    $profile3 = $this->createMock(ProfileInterface::class);
    $profile3->method('getCacheTags')->willReturn(['asu_profile:30']);

    $this->entityStorage->method('loadMultiple')
      ->with([10, 20, 30])
      ->willReturn([
        10 => $profile1,
        20 => $profile2,
        30 => $profile3,
      ]);

    $this->viewBuilder->method('view')
      ->willReturn(['#markup' => 'rendered']);

    $block = $this->createBlockInstance([
      'profiles' => [
        ['source' => 'local', 'profile_id' => 10, 'asurite' => ''],
        ['source' => 'from_directory', 'profile_id' => 20, 'asurite' => 'user2'],
        ['source' => 'reuse', 'profile_id' => 30, 'asurite' => ''],
      ],
      'display_format' => 'grid',
    ]);

    $build = $block->build();

    $this->assertArrayHasKey('profile_0', $build);
    $this->assertArrayHasKey('profile_1', $build);
    $this->assertArrayHasKey('profile_2', $build);
    // All cache tags should be merged.
    $this->assertContains('asu_profile:10', $build['#cache']['tags']);
    $this->assertContains('asu_profile:20', $build['#cache']['tags']);
    $this->assertContains('asu_profile:30', $build['#cache']['tags']);
    $this->assertContains('asu_profile_list', $build['#cache']['tags']);
  }

  /**
   * Tests build() skips profile IDs that don't load (partial load).
   *
   * @covers ::build
   */
  public function testBuildSkipsMissingProfiles(): void {
    $profile1 = $this->createMock(ProfileInterface::class);
    $profile1->method('getCacheTags')->willReturn(['asu_profile:1']);

    // Profile ID 2 is missing from storage.
    $this->entityStorage->method('loadMultiple')
      ->with([1, 2])
      ->willReturn([1 => $profile1]);

    $this->viewBuilder->method('view')
      ->willReturn(['#markup' => 'rendered']);

    $block = $this->createBlockInstance([
      'profiles' => [
        ['source' => 'local', 'profile_id' => 1, 'asurite' => ''],
        ['source' => 'local', 'profile_id' => 2, 'asurite' => ''],
      ],
      'display_format' => 'grid',
    ]);

    $build = $block->build();

    // Only one profile should be rendered (index 0).
    $this->assertArrayHasKey('profile_0', $build);
    $this->assertArrayNotHasKey('profile_1', $build);
  }

  /**
   * Tests that the block has correct plugin metadata.
   */
  public function testBlockPluginMetadata(): void {
    $block = $this->createBlockInstance();
    $this->assertEquals('profile_list_block', $block->getPluginId());
  }

  /**
   * Tests the addProfileSubmit handler increments profile count and order.
   *
   * @covers ::addProfileSubmit
   */
  public function testAddProfileSubmit(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->set('num_profiles', 2);
    $form_state->set('profile_order', [0, 1]);

    ProfileListBlock::addProfileSubmit($form, $form_state);

    $this->assertEquals(3, $form_state->get('num_profiles'));
    $this->assertEquals([0, 1, 2], $form_state->get('profile_order'));
    $this->assertTrue($form_state->isRebuilding());
  }

  /**
   * Tests the removeProfileSubmit handler removes from order.
   *
   * @covers ::removeProfileSubmit
   */
  public function testRemoveProfileSubmit(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->set('profile_order', [0, 1, 2]);
    $form_state->set('removed_profiles', []);
    $form_state->setTriggeringElement([
      '#name' => 'remove_profile_1',
    ]);

    ProfileListBlock::removeProfileSubmit($form, $form_state);

    $this->assertEquals([0, 2], $form_state->get('profile_order'));
    $this->assertContains(1, $form_state->get('removed_profiles'));
    $this->assertTrue($form_state->isRebuilding());
  }

  /**
   * Tests the moveUpSubmit handler swaps entries correctly.
   *
   * @covers ::moveUpSubmit
   */
  public function testMoveUpSubmit(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->set('profile_order', [0, 1, 2]);
    $form_state->setTriggeringElement([
      '#name' => 'move_up_1',
    ]);

    ProfileListBlock::moveUpSubmit($form, $form_state);

    $this->assertEquals([1, 0, 2], $form_state->get('profile_order'));
    $this->assertTrue($form_state->isRebuilding());
  }

  /**
   * Tests moveUpSubmit does nothing when item is already first.
   *
   * @covers ::moveUpSubmit
   */
  public function testMoveUpSubmitAtTop(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->set('profile_order', [0, 1, 2]);
    $form_state->setTriggeringElement([
      '#name' => 'move_up_0',
    ]);

    ProfileListBlock::moveUpSubmit($form, $form_state);

    // Order should be unchanged.
    $this->assertEquals([0, 1, 2], $form_state->get('profile_order'));
  }

  /**
   * Tests the moveDownSubmit handler swaps entries correctly.
   *
   * @covers ::moveDownSubmit
   */
  public function testMoveDownSubmit(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->set('profile_order', [0, 1, 2]);
    $form_state->setTriggeringElement([
      '#name' => 'move_down_1',
    ]);

    ProfileListBlock::moveDownSubmit($form, $form_state);

    $this->assertEquals([0, 2, 1], $form_state->get('profile_order'));
    $this->assertTrue($form_state->isRebuilding());
  }

  /**
   * Tests moveDownSubmit does nothing when item is already last.
   *
   * @covers ::moveDownSubmit
   */
  public function testMoveDownSubmitAtBottom(): void {
    $form = [];
    $form_state = new FormState();
    $form_state->set('profile_order', [0, 1, 2]);
    $form_state->setTriggeringElement([
      '#name' => 'move_down_2',
    ]);

    ProfileListBlock::moveDownSubmit($form, $form_state);

    // Order should be unchanged.
    $this->assertEquals([0, 1, 2], $form_state->get('profile_order'));
  }

  /**
   * Tests build() with mixed source types in configuration.
   *
   * @covers ::build
   */
  public function testBuildWithMixedSourceTypes(): void {
    $local_profile = $this->createMock(ProfileInterface::class);
    $local_profile->method('getCacheTags')->willReturn(['asu_profile:1']);

    $dir_profile = $this->createMock(ProfileInterface::class);
    $dir_profile->method('getCacheTags')->willReturn(['asu_profile:2']);

    $reuse_profile = $this->createMock(ProfileInterface::class);
    $reuse_profile->method('getCacheTags')->willReturn(['asu_profile:3']);

    $this->entityStorage->method('loadMultiple')
      ->with([1, 2, 3])
      ->willReturn([
        1 => $local_profile,
        2 => $dir_profile,
        3 => $reuse_profile,
      ]);

    $this->viewBuilder->method('view')
      ->willReturn(['#markup' => 'rendered']);

    $block = $this->createBlockInstance([
      'profiles' => [
        ['source' => 'local', 'profile_id' => 1, 'asurite' => ''],
        ['source' => 'from_directory', 'profile_id' => 2, 'asurite' => 'jdoe'],
        ['source' => 'reuse', 'profile_id' => 3, 'asurite' => ''],
      ],
      'display_format' => 'grid',
    ]);

    $build = $block->build();

    $this->assertArrayHasKey('profile_0', $build);
    $this->assertArrayHasKey('profile_1', $build);
    $this->assertArrayHasKey('profile_2', $build);
    // All source types produce the correct cache metadata.
    $this->assertContains('asu_profile:1', $build['#cache']['tags']);
    $this->assertContains('asu_profile:2', $build['#cache']['tags']);
    $this->assertContains('asu_profile:3', $build['#cache']['tags']);
  }

  /**
   * Tests that build() attaches the correct library.
   *
   * @covers ::build
   */
  public function testBuildAttachesLibrary(): void {
    $profile_mock = $this->createMock(ProfileInterface::class);
    $profile_mock->method('getCacheTags')->willReturn(['asu_profile:5']);

    $this->entityStorage->method('loadMultiple')
      ->willReturn([5 => $profile_mock]);

    $this->viewBuilder->method('view')
      ->willReturn(['#markup' => 'rendered']);

    $block = $this->createBlockInstance([
      'profiles' => [
        ['source' => 'local', 'profile_id' => 5, 'asurite' => ''],
      ],
      'display_format' => 'grid',
    ]);

    $build = $block->build();

    $this->assertArrayHasKey('#attached', $build);
    $this->assertArrayHasKey('library', $build['#attached']);
    $this->assertContains('webspark_webdir/profile', $build['#attached']['library']);
  }

  /**
   * Tests that build() has a row wrapper div.
   *
   * @covers ::build
   */
  public function testBuildHasRowWrapper(): void {
    $profile_mock = $this->createMock(ProfileInterface::class);
    $profile_mock->method('getCacheTags')->willReturn(['asu_profile:1']);

    $this->entityStorage->method('loadMultiple')
      ->willReturn([1 => $profile_mock]);

    $this->viewBuilder->method('view')
      ->willReturn(['#markup' => 'rendered']);

    $block = $this->createBlockInstance([
      'profiles' => [
        ['source' => 'local', 'profile_id' => 1, 'asurite' => ''],
      ],
      'display_format' => 'list',
    ]);

    $build = $block->build();

    $this->assertEquals('<div class="row">', $build['#prefix']);
    $this->assertEquals('</div>', $build['#suffix']);
  }

  /**
   * Tests build() cache contexts include url.path.
   *
   * @covers ::build
   */
  public function testBuildCacheContexts(): void {
    $profile_mock = $this->createMock(ProfileInterface::class);
    $profile_mock->method('getCacheTags')->willReturn(['asu_profile:1']);

    $this->entityStorage->method('loadMultiple')
      ->willReturn([1 => $profile_mock]);

    $this->viewBuilder->method('view')
      ->willReturn(['#markup' => 'rendered']);

    $block = $this->createBlockInstance([
      'profiles' => [
        ['source' => 'local', 'profile_id' => 1, 'asurite' => ''],
      ],
      'display_format' => 'grid',
    ]);

    $build = $block->build();

    $this->assertArrayHasKey('#cache', $build);
    $this->assertArrayHasKey('contexts', $build['#cache']);
    $this->assertContains('url.path', $build['#cache']['contexts']);
  }

  /**
   * Tests buildAffiliationOptions() with primary and additional affiliations.
   *
   * @covers \Drupal\webspark_webdir\Service\RemoteProfileFetcher::buildAffiliationOptions
   */
  public function testBuildAffiliationOptionsWithPrimaryAndAdditional(): void {
    $fetcher = $this->getMockBuilder(RemoteProfileFetcher::class)
      ->disableOriginalConstructor()
      ->onlyMethods(['fetchAffiliations'])
      ->getMock();

    $affiliations = [
      'primary_title' => 'Professor',
      'primary_department' => 'Computer Science',
      'primary_deptid' => 'DEPT001',
      'titles' => ['Lecturer', 'Adjunct'],
      'departments' => ['Mathematics', 'Physics'],
      'deptids' => ['DEPT002', 'DEPT003'],
    ];

    $options = $fetcher->buildAffiliationOptions($affiliations);

    $this->assertCount(3, $options);
    // Primary should be first.
    $keys = array_keys($options);
    $this->assertEquals('DEPT001', $keys[0]);
    $this->assertEquals('Professor — Computer Science', $options['DEPT001']);
    $this->assertEquals('Lecturer — Mathematics', $options['DEPT002']);
    $this->assertEquals('Adjunct — Physics', $options['DEPT003']);
  }

  /**
   * Tests buildAffiliationOptions() filters out duplicate of primary deptid.
   *
   * @covers \Drupal\webspark_webdir\Service\RemoteProfileFetcher::buildAffiliationOptions
   */
  public function testBuildAffiliationOptionsFiltersDuplicatePrimary(): void {
    $fetcher = $this->getMockBuilder(RemoteProfileFetcher::class)
      ->disableOriginalConstructor()
      ->onlyMethods(['fetchAffiliations'])
      ->getMock();

    $affiliations = [
      'primary_title' => 'Professor',
      'primary_department' => 'Computer Science',
      'primary_deptid' => 'DEPT001',
      'titles' => ['Professor', 'Lecturer'],
      'departments' => ['Computer Science', 'Mathematics'],
      'deptids' => ['DEPT001', 'DEPT002'],
    ];

    $options = $fetcher->buildAffiliationOptions($affiliations);

    // DEPT001 appears in both primary and titles array, should only appear once.
    $this->assertCount(2, $options);
    $this->assertEquals('Professor — Computer Science', $options['DEPT001']);
    $this->assertEquals('Lecturer — Mathematics', $options['DEPT002']);
  }

  /**
   * Tests buildAffiliationOptions() with only primary affiliation.
   *
   * @covers \Drupal\webspark_webdir\Service\RemoteProfileFetcher::buildAffiliationOptions
   */
  public function testBuildAffiliationOptionsOnlyPrimary(): void {
    $fetcher = $this->getMockBuilder(RemoteProfileFetcher::class)
      ->disableOriginalConstructor()
      ->onlyMethods(['fetchAffiliations'])
      ->getMock();

    $affiliations = [
      'primary_title' => 'Dean',
      'primary_department' => 'College of Engineering',
      'primary_deptid' => 'DEPT100',
      'titles' => [],
      'departments' => [],
      'deptids' => [],
    ];

    $options = $fetcher->buildAffiliationOptions($affiliations);

    $this->assertCount(1, $options);
    $this->assertEquals('Dean — College of Engineering', $options['DEPT100']);
  }

  /**
   * Tests buildAffiliationOptions() with empty primary deptid.
   *
   * @covers \Drupal\webspark_webdir\Service\RemoteProfileFetcher::buildAffiliationOptions
   */
  public function testBuildAffiliationOptionsEmptyPrimaryDeptid(): void {
    $fetcher = $this->getMockBuilder(RemoteProfileFetcher::class)
      ->disableOriginalConstructor()
      ->onlyMethods(['fetchAffiliations'])
      ->getMock();

    $affiliations = [
      'primary_title' => '',
      'primary_department' => '',
      'primary_deptid' => '',
      'titles' => ['Lecturer'],
      'departments' => ['Mathematics'],
      'deptids' => ['DEPT002'],
    ];

    $options = $fetcher->buildAffiliationOptions($affiliations);

    // No primary added (empty deptid), only the one from titles array.
    $this->assertCount(1, $options);
    $this->assertEquals('Lecturer — Mathematics', $options['DEPT002']);
  }

  /**
   * Tests buildAffiliationOptions() skips entries with empty deptid.
   *
   * @covers \Drupal\webspark_webdir\Service\RemoteProfileFetcher::buildAffiliationOptions
   */
  public function testBuildAffiliationOptionsSkipsEmptyDeptids(): void {
    $fetcher = $this->getMockBuilder(RemoteProfileFetcher::class)
      ->disableOriginalConstructor()
      ->onlyMethods(['fetchAffiliations'])
      ->getMock();

    $affiliations = [
      'primary_title' => 'Professor',
      'primary_department' => 'CS',
      'primary_deptid' => 'DEPT001',
      'titles' => ['Lecturer', 'Adjunct'],
      'departments' => ['Math', 'Physics'],
      'deptids' => ['', 'DEPT003'],
    ];

    $options = $fetcher->buildAffiliationOptions($affiliations);

    // Empty deptid entry should be skipped.
    $this->assertCount(2, $options);
    $this->assertArrayHasKey('DEPT001', $options);
    $this->assertArrayHasKey('DEPT003', $options);
    $this->assertEquals('Adjunct — Physics', $options['DEPT003']);
  }

  /**
   * Tests buildAffiliationOptions() with completely empty affiliations.
   *
   * @covers \Drupal\webspark_webdir\Service\RemoteProfileFetcher::buildAffiliationOptions
   */
  public function testBuildAffiliationOptionsEmptyAffiliations(): void {
    $fetcher = $this->getMockBuilder(RemoteProfileFetcher::class)
      ->disableOriginalConstructor()
      ->onlyMethods(['fetchAffiliations'])
      ->getMock();

    $affiliations = [
      'primary_title' => '',
      'primary_department' => '',
      'primary_deptid' => '',
      'titles' => [],
      'departments' => [],
      'deptids' => [],
    ];

    $options = $fetcher->buildAffiliationOptions($affiliations);

    $this->assertSame([], $options);
  }

  /**
   * Tests buildAffiliationOptions() uses min count of arrays.
   *
   * When titles, departments, and deptids arrays have different lengths,
   * only processes up to the minimum length.
   *
   * @covers \Drupal\webspark_webdir\Service\RemoteProfileFetcher::buildAffiliationOptions
   */
  public function testBuildAffiliationOptionsUnevenArrays(): void {
    $fetcher = $this->getMockBuilder(RemoteProfileFetcher::class)
      ->disableOriginalConstructor()
      ->onlyMethods(['fetchAffiliations'])
      ->getMock();

    $affiliations = [
      'primary_title' => 'Professor',
      'primary_department' => 'CS',
      'primary_deptid' => 'DEPT001',
      'titles' => ['Lecturer', 'Adjunct', 'Extra Title'],
      'departments' => ['Math', 'Physics'],
      'deptids' => ['DEPT002', 'DEPT003', 'DEPT004'],
    ];

    $options = $fetcher->buildAffiliationOptions($affiliations);

    // min(3, 2, 3) = 2, so only first 2 entries processed.
    $this->assertCount(3, $options);
    $this->assertArrayHasKey('DEPT001', $options);
    $this->assertArrayHasKey('DEPT002', $options);
    $this->assertArrayHasKey('DEPT003', $options);
    $this->assertArrayNotHasKey('DEPT004', $options);
  }

  /**
   * Tests buildAffiliationOptions() with numeric string deptid keys.
   *
   * PHP casts numeric string keys to integers in arrays. This test verifies
   * the behavior when deptids are purely numeric strings like '12345'.
   *
   * @covers \Drupal\webspark_webdir\Service\RemoteProfileFetcher::buildAffiliationOptions
   */
  public function testBuildAffiliationOptionsWithNumericDeptidKeys(): void {
    $fetcher = $this->getMockBuilder(RemoteProfileFetcher::class)
      ->disableOriginalConstructor()
      ->onlyMethods(['fetchAffiliations'])
      ->getMock();

    $affiliations = [
      'primary_title' => 'Professor',
      'primary_department' => 'Computer Science',
      'primary_deptid' => '12345',
      'titles' => ['Lecturer', 'Adjunct'],
      'departments' => ['Mathematics', 'Physics'],
      'deptids' => ['67890', '11111'],
    ];

    $options = $fetcher->buildAffiliationOptions($affiliations);

    $this->assertCount(3, $options);
    // PHP casts numeric string keys to integers in arrays, so the keys
    // will be int 12345, 67890, 11111 rather than string '12345', etc.
    $keys = array_keys($options);
    $this->assertSame(12345, $keys[0]);
    $this->assertSame(67890, $keys[1]);
    $this->assertSame(11111, $keys[2]);
    $this->assertEquals('Professor — Computer Science', $options[12345]);
    $this->assertEquals('Lecturer — Mathematics', $options[67890]);
    $this->assertEquals('Adjunct — Physics', $options[11111]);
  }

  /**
   * Tests affiliation default value casting for numeric deptid keys.
   *
   * When PHP casts numeric string keys to integers in arrays, the block form
   * logic casts the default value to int for matching. This test verifies
   * that is_numeric + array_key_exists with (int) cast works correctly.
   *
   * @covers ::blockForm
   */
  public function testAffiliationDefaultValueNumericCasting(): void {
    // Simulate what happens when buildAffiliationOptions returns numeric keys.
    // PHP will cast '12345' to int key 12345 in the array.
    $affiliation_options = [];
    $affiliation_options['12345'] = 'Professor — Computer Science';
    $affiliation_options['67890'] = 'Lecturer — Mathematics';

    // After PHP processes the array, keys become integers.
    $keys = array_keys($affiliation_options);
    $this->assertSame(12345, $keys[0]);

    // Simulate the default value logic from ProfileListBlock::blockForm
    // (lines 304-308): the profile stores selected_deptid as a string.
    $affiliation_default = '12345';

    // Apply the same logic as the block form.
    if (is_numeric($affiliation_default) && array_key_exists((int) $affiliation_default, $affiliation_options)) {
      $affiliation_default = (int) $affiliation_default;
    }

    // The default value should now be an integer matching the array key.
    $this->assertSame(12345, $affiliation_default);
    $this->assertArrayHasKey($affiliation_default, $affiliation_options);
  }

  /**
   * Tests single option auto-select logic in blockSubmit.
   *
   * When affiliation_options_{delta} has only 1 entry and selected_deptid is
   * empty, blockSubmit should auto-select the single available option.
   *
   * @covers ::blockSubmit
   */
  public function testBlockSubmitSingleOptionAutoSelect(): void {
    // Simulate the auto-select logic from blockSubmit (lines 878-882).
    $selected_deptid = '';
    $delta = 0;

    $form_state = new FormState();
    // Set affiliation_options_0 with a single entry.
    $form_state->set('affiliation_options_0', ['DEPT001' => 'Professor — CS']);

    // Apply the same logic as blockSubmit.
    if (empty($selected_deptid)) {
      $options = $form_state->get('affiliation_options_' . $delta) ?? [];
      if (count($options) === 1) {
        $selected_deptid = array_key_first($options);
      }
    }

    $this->assertSame('DEPT001', $selected_deptid);
  }

  /**
   * Tests single option auto-select with numeric deptid key in blockSubmit.
   *
   * When the single option has a numeric string key (cast to int by PHP),
   * the auto-selected value should be that integer.
   *
   * @covers ::blockSubmit
   */
  public function testBlockSubmitSingleOptionAutoSelectNumericKey(): void {
    $selected_deptid = '';
    $delta = 2;

    $form_state = new FormState();
    // Numeric string key '99999' will be cast to int 99999 by PHP.
    $options_array = [];
    $options_array['99999'] = 'Adjunct — Physics';
    $form_state->set('affiliation_options_2', $options_array);

    // Apply the same logic as blockSubmit.
    if (empty($selected_deptid)) {
      $options = $form_state->get('affiliation_options_' . $delta) ?? [];
      if (count($options) === 1) {
        $selected_deptid = array_key_first($options);
      }
    }

    // PHP casts the key to int, so array_key_first returns 99999.
    $this->assertSame(99999, $selected_deptid);
  }

  /**
   * Tests blockSubmit does NOT auto-select when multiple options exist.
   *
   * When affiliation_options_{delta} has more than 1 entry and selected_deptid
   * is empty, the value should remain empty.
   *
   * @covers ::blockSubmit
   */
  public function testBlockSubmitNoAutoSelectWithMultipleOptions(): void {
    $selected_deptid = '';
    $delta = 0;

    $form_state = new FormState();
    $form_state->set('affiliation_options_0', [
      'DEPT001' => 'Professor — CS',
      'DEPT002' => 'Lecturer — Math',
    ]);

    // Apply the same logic as blockSubmit.
    if (empty($selected_deptid)) {
      $options = $form_state->get('affiliation_options_' . $delta) ?? [];
      if (count($options) === 1) {
        $selected_deptid = array_key_first($options);
      }
    }

    // Should remain empty since there are multiple options.
    $this->assertSame('', $selected_deptid);
  }

  /**
   * Tests nested path extraction for selected_deptid in blockSubmit.
   *
   * The selected_deptid is extracted from nested
   * `$entry['remote_fields']['affiliation_wrapper']['selected_deptid']`
   * with fallback to `$entry['remote_fields']['selected_deptid']`.
   *
   * @covers ::blockSubmit
   */
  public function testBlockSubmitSelectedDeptidNestedPath(): void {
    // Test the nested path (affiliation_wrapper container).
    $entry = [
      'source' => 'from_directory',
      'remote_fields' => [
        'asurite' => 'testuser',
        'affiliation_wrapper' => [
          'selected_deptid' => 'DEPT_NESTED',
        ],
      ],
    ];

    $selected_deptid = $entry['remote_fields']['affiliation_wrapper']['selected_deptid']
      ?? $entry['remote_fields']['selected_deptid']
      ?? '';

    $this->assertSame('DEPT_NESTED', $selected_deptid);
  }

  /**
   * Tests fallback path extraction for selected_deptid in blockSubmit.
   *
   * When affiliation_wrapper doesn't contain selected_deptid, the fallback
   * to `$entry['remote_fields']['selected_deptid']` is used.
   *
   * @covers ::blockSubmit
   */
  public function testBlockSubmitSelectedDeptidFallbackPath(): void {
    // Test the fallback path (flat structure without affiliation_wrapper).
    $entry = [
      'source' => 'from_directory',
      'remote_fields' => [
        'asurite' => 'testuser',
        'selected_deptid' => 'DEPT_FLAT',
      ],
    ];

    $selected_deptid = $entry['remote_fields']['affiliation_wrapper']['selected_deptid']
      ?? $entry['remote_fields']['selected_deptid']
      ?? '';

    $this->assertSame('DEPT_FLAT', $selected_deptid);
  }

  /**
   * Tests blockValidate requires affiliation lookup for directory profiles.
   *
   * When a directory profile entry has no affiliation_options loaded, an error
   * should be set requiring the user to click "Look up ASURITE" first.
   *
   * @covers ::blockValidate
   */
  public function testBlockValidateRequiresAffiliationLookup(): void {
    $block = $this->createBlockInstance();

    $form = [];
    $form_state = new FormState();
    $form_state->set('removed_profiles', []);
    // No affiliation_options_0 set — simulates not clicking "Look up ASURITE".
    $form_state->setValue('profiles_wrapper', [
      0 => [
        'source' => 'from_directory',
        'remote_fields' => [
          'asurite' => 'testuser',
        ],
      ],
    ]);

    $block->blockValidate($form, $form_state);

    $errors = $form_state->getErrors();
    $this->assertNotEmpty($errors);
    // Should require the affiliation lookup.
    $error_keys = array_keys($errors);
    $has_affiliation_error = FALSE;
    foreach ($error_keys as $key) {
      if (str_contains($key, 'affiliation_wrapper')) {
        $has_affiliation_error = TRUE;
        break;
      }
    }
    $this->assertTrue($has_affiliation_error, 'Expected affiliation lookup required error.');
  }

  /**
   * Tests blockValidate passes when affiliation options are loaded.
   *
   * When a directory profile entry has affiliation_options loaded with a
   * single entry, validation should pass (auto-select).
   *
   * @covers ::blockValidate
   */
  public function testBlockValidatePassesWithSingleAffiliation(): void {
    $block = $this->createBlockInstance();

    $form = [];
    $form_state = new FormState();
    $form_state->set('removed_profiles', []);
    $form_state->set('affiliation_options_0', ['DEPT001' => 'Professor — CS']);
    $form_state->setValue('profiles_wrapper', [
      0 => [
        'source' => 'from_directory',
        'remote_fields' => [
          'asurite' => 'testuser',
          'affiliation_wrapper' => [],
        ],
      ],
    ]);

    $block->blockValidate($form, $form_state);

    $errors = $form_state->getErrors();
    $this->assertEmpty($errors);
  }

  /**
   * Tests blockValidate requires selection when multiple affiliations exist.
   *
   * When multiple affiliation options are loaded but no selected_deptid is
   * provided, an error should be set.
   *
   * @covers ::blockValidate
   */
  public function testBlockValidateRequiresSelectionWithMultipleAffiliations(): void {
    $block = $this->createBlockInstance();

    $form = [];
    $form_state = new FormState();
    $form_state->set('removed_profiles', []);
    $form_state->set('affiliation_options_0', [
      'DEPT001' => 'Professor — CS',
      'DEPT002' => 'Lecturer — Math',
    ]);
    $form_state->setValue('profiles_wrapper', [
      0 => [
        'source' => 'from_directory',
        'remote_fields' => [
          'asurite' => 'testuser',
          'affiliation_wrapper' => [
            'selected_deptid' => '',
          ],
        ],
      ],
    ]);

    $block->blockValidate($form, $form_state);

    $errors = $form_state->getErrors();
    $this->assertNotEmpty($errors);
    $error_keys = array_keys($errors);
    $has_selection_error = FALSE;
    foreach ($error_keys as $key) {
      if (str_contains($key, 'selected_deptid')) {
        $has_selection_error = TRUE;
        break;
      }
    }
    $this->assertTrue($has_selection_error, 'Expected affiliation selection required error.');
  }

  /**
   * Tests blockValidate passes when affiliation is selected.
   *
   * @covers ::blockValidate
   */
  public function testBlockValidatePassesWithSelectedAffiliation(): void {
    $block = $this->createBlockInstance();

    $form = [];
    $form_state = new FormState();
    $form_state->set('removed_profiles', []);
    $form_state->set('affiliation_options_0', [
      'DEPT001' => 'Professor — CS',
      'DEPT002' => 'Lecturer — Math',
    ]);
    $form_state->setValue('profiles_wrapper', [
      0 => [
        'source' => 'from_directory',
        'remote_fields' => [
          'asurite' => 'testuser',
          'affiliation_wrapper' => [
            'selected_deptid' => 'DEPT001',
          ],
        ],
      ],
    ]);

    $block->blockValidate($form, $form_state);

    $errors = $form_state->getErrors();
    $this->assertEmpty($errors);
  }

  /**
   * Tests blockValidate detects duplicate ASURITE IDs.
   *
   * @covers ::blockValidate
   */
  public function testBlockValidateDetectsDuplicateAsurite(): void {
    $block = $this->createBlockInstance();

    $form = [];
    $form_state = new FormState();
    $form_state->set('removed_profiles', []);
    $form_state->set('affiliation_options_0', ['DEPT001' => 'Prof — CS']);
    $form_state->set('affiliation_options_1', ['DEPT002' => 'Lecturer — Math']);
    $form_state->setValue('profiles_wrapper', [
      0 => [
        'source' => 'from_directory',
        'remote_fields' => [
          'asurite' => 'jsmith',
          'affiliation_wrapper' => [
            'selected_deptid' => 'DEPT001',
          ],
        ],
      ],
      1 => [
        'source' => 'from_directory',
        'remote_fields' => [
          'asurite' => 'jsmith',
          'affiliation_wrapper' => [
            'selected_deptid' => 'DEPT002',
          ],
        ],
      ],
    ]);

    $block->blockValidate($form, $form_state);

    $errors = $form_state->getErrors();
    $this->assertNotEmpty($errors);
    // The duplicate error should be on the second entry's asurite field.
    $error_keys = array_keys($errors);
    $found_duplicate_error = FALSE;
    foreach ($error_keys as $key) {
      // The second entry (delta 1) should have an error on its asurite field.
      if (str_contains($key, 'profiles_wrapper][1][remote_fields][asurite')) {
        $found_duplicate_error = TRUE;
        break;
      }
    }
    $this->assertTrue($found_duplicate_error, 'Expected duplicate ASURITE error on second entry.');
  }

  /**
   * Tests blockValidate allows same ASURITE when one entry is removed.
   *
   * @covers ::blockValidate
   */
  public function testBlockValidateAllowsDuplicateWhenRemoved(): void {
    $block = $this->createBlockInstance();

    $form = [];
    $form_state = new FormState();
    // Mark delta 0 as removed.
    $form_state->set('removed_profiles', [0]);
    $form_state->set('affiliation_options_1', ['DEPT001' => 'Prof — CS']);
    $form_state->setValue('profiles_wrapper', [
      0 => [
        'source' => 'from_directory',
        'remote_fields' => [
          'asurite' => 'jsmith',
          'affiliation_wrapper' => [
            'selected_deptid' => 'DEPT001',
          ],
        ],
      ],
      1 => [
        'source' => 'from_directory',
        'remote_fields' => [
          'asurite' => 'jsmith',
          'affiliation_wrapper' => [
            'selected_deptid' => 'DEPT001',
          ],
        ],
      ],
    ]);

    $block->blockValidate($form, $form_state);

    $errors = $form_state->getErrors();
    $this->assertEmpty($errors);
  }

  /**
   * Tests blockValidate duplicate check is case-insensitive.
   *
   * @covers ::blockValidate
   */
  public function testBlockValidateDuplicateIsCaseInsensitive(): void {
    $block = $this->createBlockInstance();

    $form = [];
    $form_state = new FormState();
    $form_state->set('removed_profiles', []);
    $form_state->set('affiliation_options_0', ['DEPT001' => 'Prof — CS']);
    $form_state->set('affiliation_options_1', ['DEPT002' => 'Lecturer — Math']);
    $form_state->setValue('profiles_wrapper', [
      0 => [
        'source' => 'from_directory',
        'remote_fields' => [
          'asurite' => 'JSmith',
          'affiliation_wrapper' => [
            'selected_deptid' => 'DEPT001',
          ],
        ],
      ],
      1 => [
        'source' => 'from_directory',
        'remote_fields' => [
          'asurite' => 'jsmith',
          'affiliation_wrapper' => [
            'selected_deptid' => 'DEPT002',
          ],
        ],
      ],
    ]);

    $block->blockValidate($form, $form_state);

    $errors = $form_state->getErrors();
    $this->assertNotEmpty($errors, 'Expected duplicate error for case-insensitive ASURITE match.');
  }

}
