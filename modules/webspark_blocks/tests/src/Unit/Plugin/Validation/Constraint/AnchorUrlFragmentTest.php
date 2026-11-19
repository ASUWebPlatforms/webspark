<?php

namespace Drupal\Tests\webspark_blocks\Unit\Plugin\Validation\Constraint;

use Drupal\Tests\UnitTestCase;
use Drupal\webspark_blocks\Plugin\Validation\Constraint\AnchorUrlFragment;
use Drupal\webspark_blocks\Plugin\Validation\Constraint\AnchorUrlFragmentValidator;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/**
 * Tests validation of Anchor Menu URL fragments.
 *
 * @group webspark_blocks
 *
 * @coversDefaultClass \Drupal\webspark_blocks\Plugin\Validation\Constraint\AnchorUrlFragment
 */
class AnchorUrlFragmentTest extends UnitTestCase {

  /**
   * Tests the supported fragment pattern.
   *
   * @param mixed $fragment
   *   The candidate fragment.
   * @param bool $expected
   *   Whether the candidate is valid.
   *
   * @dataProvider fragmentProvider
   *
   * @covers \Drupal\webspark_blocks\Plugin\Validation\Constraint\AnchorUrlFragmentValidator::validate
   */
  public function testFragmentPattern($fragment, bool $expected): void {
    $this->assertSame($expected, AnchorUrlFragment::isValid($fragment));
  }

  /**
   * Provides supported and rejected fragment values.
   */
  public static function fragmentProvider(): array {
    return [
      'single letter' => ['a', TRUE],
      'simple fragment' => ['admissions', TRUE],
      'hyphenated fragment' => ['admissions-2026', TRUE],
      'maximum length' => [str_repeat('a', 64), TRUE],
      'empty string' => ['', FALSE],
      'null' => [NULL, FALSE],
      'uppercase' => ['Admissions', FALSE],
      'leading digit' => ['2admissions', FALSE],
      'leading hyphen' => ['-admissions', FALSE],
      'trailing hyphen' => ['admissions-', FALSE],
      'whitespace' => ['admissions 2026', FALSE],
      'hash character' => ['#admissions', FALSE],
      'over maximum length' => [str_repeat('a', 65), FALSE],
    ];
  }

  /**
   * Tests that blank optional values are accepted by the validator.
   *
   * @covers ::isValid
   */
  public function testBlankValuesAreAllowed(): void {
    $context = $this->createMock(ExecutionContextInterface::class);
    $context->expects($this->never())
      ->method('addViolation');

    $validator = new AnchorUrlFragmentValidator();
    $validator->initialize($context);
    $validator->validate([
      (object) ['value' => NULL],
      (object) ['value' => ''],
    ], new AnchorUrlFragment());

    $this->addToAssertionCount(1);
  }

  /**
   * Tests that an invalid value is rejected by the field validator.
   *
   * @covers \Drupal\webspark_blocks\Plugin\Validation\Constraint\AnchorUrlFragmentValidator::validate
   */
  public function testInvalidValueIsRejected(): void {
    $constraint = new AnchorUrlFragment();
    $context = $this->createMock(ExecutionContextInterface::class);
    $context->expects($this->once())
      ->method('addViolation')
      ->with($constraint->invalidMessage);

    $validator = new AnchorUrlFragmentValidator();
    $validator->initialize($context);
    $validator->validate([
      (object) ['value' => 'invalid-fragment-'],
    ], $constraint);
  }

  /**
   * Tests that reverting an older revision retains the latest alias history.
   *
   * @covers ::mergeHistory
   */
  public function testRevisionRevertPreservesAliasHistory(): void {
    $aliases = AnchorUrlFragment::mergeHistory(
      'alpha',
      'charlie',
      ['alpha'],
      ['alpha', 'bravo']
    );

    $this->assertSame(['bravo', 'charlie'], $aliases);
  }

  /**
   * Tests that clearing the current fragment preserves its old URL.
   *
   * @covers ::mergeHistory
   */
  public function testClearingFragmentPreservesAlias(): void {
    $aliases = AnchorUrlFragment::mergeHistory('', 'admissions', ['old-link'], ['old-link']);

    $this->assertSame(['old-link', 'admissions'], $aliases);
  }

  /**
   * Tests that alias history is de-duplicated on repeated saves.
   *
   * @covers ::mergeHistory
   */
  public function testRepeatedSaveDoesNotDuplicateAliases(): void {
    $aliases = AnchorUrlFragment::mergeHistory(
      'current-link',
      'current-link',
      ['old-link', 'old-link'],
      ['old-link']
    );

    $this->assertSame(['old-link'], $aliases);
  }

}
