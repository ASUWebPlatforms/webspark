<?php

namespace Drupal\Tests\webspark_utility\Unit\Drush;

use Drupal\Tests\UnitTestCase;
use Drupal\webspark_utility\Drush\Commands\WebsparkUtilityCommands;
use Drush\Log\DrushLoggerManager;
use Psr\Log\AbstractLogger;

/**
 * Tests WebsparkUtilityCommands::rollBack() against a real git repository.
 *
 * @group webspark_utility
 */
class WebsparkUtilityCommandsTest extends UnitTestCase {

  /**
   * Temporary git repository used as the working directory.
   *
   * @var string
   */
  protected string $repo;

  /**
   * The directory to return to after each test.
   *
   * @var string
   */
  protected string $originalCwd;

  /**
   * Records captured by the test logger, as [level, message] pairs.
   *
   * @var array
   */
  protected array $records = [];

  /**
   * The command object under test.
   *
   * @var \Drupal\webspark_utility\Drush\Commands\WebsparkUtilityCommands
   */
  protected WebsparkUtilityCommands $command;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->originalCwd = getcwd();
    $this->repo = sys_get_temp_dir() . '/webspark_utility_rollback_' . uniqid();
    mkdir($this->repo . '/config', 0777, TRUE);
    file_put_contents($this->repo . '/config/example.yml', "key: original\n");
    chdir($this->repo);
    exec('git init -q && git -c user.email=t@example.com -c user.name=test add -A && git -c user.email=t@example.com -c user.name=test commit -qm init 2>&1', $out, $code);
    $this->assertSame(0, $code, 'Fixture git repository was created.');

    $records = &$this->records;
    $collector = new class($records) extends AbstractLogger {

      /**
       * Captured records.
       *
       * @var array
       */
      private array $records;

      public function __construct(array &$records) {
        $this->records = &$records;
      }

      /**
       * {@inheritdoc}
       */
      public function log($level, $message, array $context = []): void {
        $this->records[] = [$level, (string) $message];
      }

    };
    $manager = new DrushLoggerManager();
    $manager->add('test', $collector);
    $this->command = new WebsparkUtilityCommands();
    $this->command->setLogger($manager);
  }

  /**
   * {@inheritdoc}
   */
  protected function tearDown(): void {
    chdir($this->originalCwd);
    exec('rm -rf ' . escapeshellarg($this->repo));
    parent::tearDown();
  }

  /**
   * Invokes the private rollBack() method.
   */
  protected function rollBack(string $path): void {
    $method = new \ReflectionMethod($this->command, 'rollBack');
    $method->setAccessible(TRUE);
    $method->invoke($this->command, $path);
  }

  /**
   * Returns the logged messages at a given level.
   */
  protected function messages(string $level): array {
    return array_column(array_filter($this->records, fn($r) => $r[0] === $level), 1);
  }

  /**
   * A modified tracked file is restored and success is reported.
   */
  public function testRestoresModifiedFilesAndReportsSuccess(): void {
    file_put_contents($this->repo . '/config/example.yml', "key: changed\n");

    $this->rollBack('config');

    $this->assertSame("key: original\n", file_get_contents($this->repo . '/config/example.yml'));
    $this->assertSame([], $this->messages('error'));
    $this->assertContains('YAML files were successfully restored at config', $this->messages('notice'));
  }

  /**
   * A failed git restore is reported as an error, not as success.
   */
  public function testReportsFailureWhenRestoreFails(): void {
    $this->rollBack('does-not-exist');

    $errors = $this->messages('error');
    $this->assertCount(1, $errors);
    $this->assertStringStartsWith('Failed to restore YAML files at does-not-exist', $errors[0]);
    $this->assertNotContains('YAML files were successfully restored at does-not-exist', $this->messages('notice'));
  }

}
