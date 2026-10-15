<?php

namespace Drupal\Tests\asu_editor_guardrails\Unit\EventSubscriber;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Config\ImmutableConfig;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Flood\FloodInterface;
use Drupal\Core\Session\AccountProxyInterface;
use Drupal\Tests\UnitTestCase;
use Drupal\ai_automators\Event\ShouldProcessFieldEvent;
use Drupal\asu_editor_guardrails\EventSubscriber\AutomatorGuardrailSubscriber;
use Drupal\node\NodeInterface;
use Drupal\Core\DependencyInjection\ContainerBuilder;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Psr\Log\LoggerInterface;

/**
 * Tests AutomatorGuardrailSubscriber's veto/cooldown decisions.
 *
 * @group asu_editor_guardrails
 * @coversDefaultClass \Drupal\asu_editor_guardrails\EventSubscriber\AutomatorGuardrailSubscriber
 */
class AutomatorGuardrailSubscriberTest extends UnitTestCase {

  /**
   * Builds a mock entity implementing both interfaces the subscriber checks.
   *
   * NodeInterface conveniently already extends both ContentEntityInterface
   * and EntityPublishedInterface, so mocking it satisfies the subscriber's
   * `instanceof EntityPublishedInterface` check without a hand-rolled
   * double (which trips PHPUnit's mock generator on ContentEntityInterface's
   * \IteratorAggregate inheritance).
   */
  protected function mockEntity(bool $published, bool $accessible, ?string $id = '1', string $entityTypeId = 'node', string $bundle = 'article'): NodeInterface {
    $entity = $this->createMock(NodeInterface::class);
    $entity->method('isPublished')->willReturn($published);
    $entity->method('access')->willReturn($accessible);
    $entity->method('id')->willReturn($id);
    $entity->method('getEntityTypeId')->willReturn($entityTypeId);
    $entity->method('bundle')->willReturn($bundle);
    return $entity;
  }

  /**
   * Builds a container with mocked services the subscriber relies on.
   *
   * Registers current_user (for the per-user cap) and logger.factory (for
   * the access-exception fail-closed path), and returns the mocked account
   * for direct constructor injection.
   */
  protected function setUpCurrentUser(string $uid = '5'): AccountProxyInterface {
    $account = $this->createMock(AccountProxyInterface::class);
    $account->method('id')->willReturn($uid);
    $logger = $this->createMock(LoggerInterface::class);
    $loggerFactory = $this->createMock(LoggerChannelFactoryInterface::class);
    $loggerFactory->method('get')->willReturn($logger);
    $container = new ContainerBuilder();
    $container->set('current_user', $account);
    $container->set('logger.factory', $loggerFactory);
    \Drupal::setContainer($container);
    return $account;
  }

  /**
   * Builds a config factory returning the default rate-limit values.
   *
   * Matches config/install/asu_editor_guardrails.settings.yml.
   */
  protected function mockConfigFactory(): ConfigFactoryInterface {
    $values = [
      'ckeditor_limit' => 30,
      'ckeditor_window' => 300,
      'automator_cooldown' => 300,
      'automator_user_limit' => 20,
      'automator_user_window' => 300,
    ];
    $config = $this->createMock(ImmutableConfig::class);
    $config->method('get')->willReturnCallback(fn (string $key) => $values[$key] ?? NULL);
    $configFactory = $this->createMock(ConfigFactoryInterface::class);
    $configFactory->method('get')->willReturn($config);
    return $configFactory;
  }

  /**
   * @covers ::onShouldProcessField
   */
  public function testUnpublishedEntityIsVetoed() {
    $currentUser = $this->setUpCurrentUser();
    $entity = $this->mockEntity(published: FALSE, accessible: TRUE);
    $fieldDefinition = $this->createMock(FieldDefinitionInterface::class);
    $event = new ShouldProcessFieldEvent($entity, $fieldDefinition, [], TRUE);

    $flood = $this->createMock(FloodInterface::class);
    $flood->expects($this->never())->method('isAllowed');

    (new AutomatorGuardrailSubscriber($flood, $this->mockConfigFactory(), $currentUser))->onShouldProcessField($event);

    $this->assertFalse($event->shouldProcess());
  }

  /**
   * @covers ::onShouldProcessField
   */
  public function testInaccessibleEntityIsVetoed() {
    $currentUser = $this->setUpCurrentUser();
    $entity = $this->mockEntity(published: TRUE, accessible: FALSE);
    $fieldDefinition = $this->createMock(FieldDefinitionInterface::class);
    $event = new ShouldProcessFieldEvent($entity, $fieldDefinition, [], TRUE);

    $flood = $this->createMock(FloodInterface::class);
    $flood->expects($this->never())->method('isAllowed');

    (new AutomatorGuardrailSubscriber($flood, $this->mockConfigFactory(), $currentUser))->onShouldProcessField($event);

    $this->assertFalse($event->shouldProcess());
  }

  /**
   * @covers ::onShouldProcessField
   */
  public function testAlreadySkippedEventIsLeftAlone() {
    $currentUser = $this->setUpCurrentUser();
    // Entity mock would fail loudly if isPublished()/access() were called;
    // asserting no calls happen proves the early-return short-circuit works.
    $entity = $this->createMock(NodeInterface::class);
    $entity->expects($this->never())->method('isPublished');
    $entity->expects($this->never())->method('access');
    $fieldDefinition = $this->createMock(FieldDefinitionInterface::class);
    $event = new ShouldProcessFieldEvent($entity, $fieldDefinition, [], FALSE);

    $flood = $this->createMock(FloodInterface::class);
    (new AutomatorGuardrailSubscriber($flood, $this->mockConfigFactory(), $currentUser))->onShouldProcessField($event);

    $this->assertFalse($event->shouldProcess());
  }

  /**
   * @covers ::onShouldProcessField
   */
  public function testCooldownVetoesRegardlessOfEditMode() {
    $currentUser = $this->setUpCurrentUser();
    // The historical gap: ComplexTextChat-based rules never set edit_mode,
    // so the cooldown must still apply with an empty automatorConfig.
    $entity = $this->mockEntity(published: TRUE, accessible: TRUE);
    $fieldDefinition = $this->createMock(FieldDefinitionInterface::class);
    $fieldDefinition->method('getName')->willReturn('field_summary');
    $event = new ShouldProcessFieldEvent($entity, $fieldDefinition, [], TRUE);

    $flood = $this->createMock(FloodInterface::class);
    $flood->method('isAllowed')->willReturn(FALSE);
    $flood->expects($this->never())->method('register');

    (new AutomatorGuardrailSubscriber($flood, $this->mockConfigFactory(), $currentUser))->onShouldProcessField($event);

    $this->assertFalse($event->shouldProcess());
  }

  /**
   * @covers ::onShouldProcessField
   */
  public function testAllowedWhenNotThrottled() {
    $currentUser = $this->setUpCurrentUser();
    $entity = $this->mockEntity(published: TRUE, accessible: TRUE);
    $fieldDefinition = $this->createMock(FieldDefinitionInterface::class);
    $fieldDefinition->method('getName')->willReturn('field_summary');
    $event = new ShouldProcessFieldEvent($entity, $fieldDefinition, [], TRUE);

    $flood = $this->createMock(FloodInterface::class);
    $flood->method('isAllowed')->willReturn(TRUE);
    $flood->expects($this->exactly(2))->method('register');

    (new AutomatorGuardrailSubscriber($flood, $this->mockConfigFactory(), $currentUser))->onShouldProcessField($event);

    $this->assertTrue($event->shouldProcess());
  }

  /**
   * @covers ::onShouldProcessField
   */
  public function testAccessExceptionFailsClosed() {
    $currentUser = $this->setUpCurrentUser();
    $entity = $this->createMock(NodeInterface::class);
    $entity->method('isPublished')->willReturn(TRUE);
    $entity->method('access')->willThrowException(new \RuntimeException('broken access handler'));
    $entity->method('id')->willReturn('1');
    $entity->method('getEntityTypeId')->willReturn('node');
    $fieldDefinition = $this->createMock(FieldDefinitionInterface::class);
    $event = new ShouldProcessFieldEvent($entity, $fieldDefinition, [], TRUE);

    $flood = $this->createMock(FloodInterface::class);
    $flood->expects($this->never())->method('isAllowed');

    (new AutomatorGuardrailSubscriber($flood, $this->mockConfigFactory(), $currentUser))->onShouldProcessField($event);

    $this->assertFalse($event->shouldProcess());
  }

}
