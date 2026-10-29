<?php

namespace Drupal\Tests\asu_degree_rfi\Unit;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Tests\UnitTestCase;
use Drupal\asu_degree_rfi\AsuDegreeRfiDataPotluckClient;
use Drupal\field\Entity\FieldStorageConfig;

/**
 * Tests the allowed_values_function callbacks for the degree list fields.
 *
 * Core's options module calls these with a NULL entity when building
 * allowed values outside an entity context (e.g. Views filters), so the
 * callbacks must accept NULL.
 *
 * @group asu_degree_rfi
 */
class AllowedValuesCallbacksTest extends UnitTestCase {

  /**
   * The mocked Data Potluck client.
   *
   * @var \Drupal\asu_degree_rfi\AsuDegreeRfiDataPotluckClient|\PHPUnit\Framework\MockObject\MockObject
   */
  protected $client;

  /**
   * The mocked default cache bin.
   *
   * @var \Drupal\Core\Cache\CacheBackendInterface|\PHPUnit\Framework\MockObject\MockObject
   */
  protected $cache;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    require_once __DIR__ . '/../../../asu_degree_rfi.module';

    $this->client = $this->createMock(AsuDegreeRfiDataPotluckClient::class);
    $this->cache = $this->createMock(CacheBackendInterface::class);

    $container = new ContainerBuilder();
    $container->set('asu_degree_rfi_data_potluck_client', $this->client);
    $container->set('cache.default', $this->cache);
    \Drupal::setContainer($container);
  }

  /**
   * College options come straight from the client, with a NULL entity.
   */
  public function testCollegeCodeAllowedValuesWithNullEntity(): void {
    $this->client->method('getColleges')->willReturn(['CLAS' => 'Liberal Arts']);
    $definition = $this->createMock(FieldStorageConfig::class);
    $cacheable = TRUE;

    $values = asu_degree_rfi_college_code_allowed_values($definition, NULL, $cacheable);

    $this->assertSame(['CLAS' => 'Liberal Arts'], $values);
  }

  /**
   * Department options merge all program types, sort, and cache.
   */
  public function testDeptCodeAllowedValuesWithNullEntity(): void {
    $this->cache->method('get')->willReturn(FALSE);
    $this->client->method('getDepartments')->willReturnMap([
      ['UG', ['B' => 'Biology']],
      ['GR', ['A' => 'Anthropology']],
      ['UGCM', []],
      ['OTHR', ['C' => 'Chemistry']],
    ]);
    $this->cache->expects($this->once())
      ->method('set')
      ->with('asu_degree_rfi:dept_options', $this->anything(), $this->anything());
    $definition = $this->createMock(FieldStorageConfig::class);
    $cacheable = TRUE;

    $values = asu_degree_rfi_dept_code_allowed_values($definition, NULL, $cacheable);

    $this->assertSame(
      ['A' => 'Anthropology', 'B' => 'Biology', 'C' => 'Chemistry'],
      $values,
    );
  }

}
