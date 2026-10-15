<?php

namespace Drupal\Tests\webspark_ckeditor_plugins\Kernel;

use Drupal\KernelTests\KernelTestBase;
use Drupal\filter\FilterPluginCollection;

/**
 * Tests the reversed list start attribute filter.
 *
 * @group webspark_ckeditor_plugins
 *
 * @coversDefaultClass \Drupal\webspark_ckeditor_plugins\Plugin\Filter\ReversedListStart
 */
class ReversedListStartTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'filter',
    'editor',
    'ckeditor5',
    'webspark_ckeditor_plugins',
  ];

  /**
   * The filter under test.
   *
   * @var \Drupal\webspark_ckeditor_plugins\Plugin\Filter\ReversedListStart
   */
  protected $filter;

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();

    $manager = $this->container->get('plugin.manager.filter');
    $filters = new FilterPluginCollection($manager, []);
    $this->filter = $filters->get('webspark_reversed_list_start');
  }

  /**
   * Runs text through the filter and returns the processed markup.
   */
  protected function process($text) {
    return $this->filter->process($text, 'en')->getProcessedText();
  }

  /**
   * A reversed list without a start attribute counts down from the item count.
   */
  public function testStartIsAddedFromItemCount() {
    $output = $this->process('<ol reversed><li>a</li><li>b</li><li>c</li></ol>');
    $this->assertStringContainsString('start="3"', $output);
  }

  /**
   * CKEditor 5 serialises the boolean attribute as reversed="reversed".
   */
  public function testExplicitBooleanAttributeValue() {
    $output = $this->process('<ol reversed="reversed"><li>a</li><li>b</li></ol>');
    $this->assertStringContainsString('start="2"', $output);
  }

  /**
   * An author's start value shifts the whole sequence.
   *
   * CKEditor stores the ascending first number, so "start at 5" on a three
   * item list is start="5", meaning 5, 6, 7. Reversed that is 7, 6, 5.
   */
  public function testAuthoredStartShiftsTheSequence() {
    $output = $this->process('<ol reversed start="5"><li>a</li><li>b</li><li>c</li></ol>');
    $this->assertStringContainsString('start="7"', $output);
  }

  /**
   * The shift is applied for a two item list as well.
   */
  public function testAuthoredStartOnShortList() {
    $output = $this->process('<ol reversed start="20"><li>a</li><li>b</li></ol>');
    $this->assertStringContainsString('start="21"', $output);
  }

  /**
   * A start of 1 is equivalent to no start at all.
   */
  public function testAuthoredStartOfOneMatchesImpliedStart() {
    $output = $this->process('<ol reversed start="1"><li>a</li><li>b</li><li>c</li></ol>');
    $this->assertStringContainsString('start="3"', $output);
  }

  /**
   * A single item list keeps the author's number.
   */
  public function testSingleItemListKeepsAuthoredStart() {
    $output = $this->process('<ol reversed start="5"><li>a</li></ol>');
    $this->assertStringContainsString('start="5"', $output);
  }

  /**
   * Nested lists are shifted independently of their parent.
   */
  public function testNestedListCountsItsOwnItems() {
    $output = $this->process(
      '<ol reversed start="5"><li>a<ol reversed><li>x</li><li>y</li></ol></li><li>b</li><li>c</li></ol>'
    );
    // Outer: three items from 5, so 7. Inner: two items from 1, so 2.
    $this->assertStringContainsString('start="7"', $output);
    $this->assertStringContainsString('start="2"', $output);
  }

  /**
   * A nested list without the attribute is not made reversed.
   */
  public function testNestedListIsNotForcedReversed() {
    $output = $this->process(
      '<ol reversed><li>a<ol><li>x</li><li>y</li></ol></li><li>b</li></ol>'
    );
    $this->assertSame(1, substr_count($output, 'reversed'));
    $this->assertSame(1, substr_count($output, 'start='));
  }

  /**
   * An ascending list is untouched.
   */
  public function testAscendingListIsUntouched() {
    $input = '<ol><li>a</li><li>b</li></ol>';
    $this->assertSame($input, $this->process($input));
  }

  /**
   * An ascending list keeps its author start value untouched.
   */
  public function testAscendingListWithStartIsUntouched() {
    $input = '<ol start="5"><li>a</li><li>b</li><li>c</li></ol>';
    $this->assertSame($input, $this->process($input));
  }

  /**
   * Text containing no reversed list passes through byte-identical.
   */
  public function testUnrelatedMarkupIsUnchanged() {
    $input = '<p>Some <em>markup</em> with an <a href="/x">link</a>.</p>';
    $this->assertSame($input, $this->process($input));
  }

  /**
   * An empty reversed list is left alone rather than given start="0".
   */
  public function testEmptyListGetsNoStart() {
    $output = $this->process('<ol reversed></ol>');
    $this->assertStringNotContainsString('start=', $output);
  }

}
