<?php

namespace Drupal\Tests\webspark_blocks\Unit;

use Drupal\paragraphs\ParagraphInterface;
use Drupal\Tests\UnitTestCase;

/**
 * Tests the module-level Anchor Menu paragraph preprocess hook.
 *
 * @group webspark_blocks
 */
class AnchorMenuPreprocessTest extends UnitTestCase {

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    require_once dirname(__DIR__, 3) . '/webspark_blocks.module';
  }

  /**
   * Tests the generic hook provides IDs even before field rollout.
   */
  public function testLegacyTargetId(): void {
    $paragraph = $this->createMock(ParagraphInterface::class);
    $paragraph->method('bundle')->willReturn('anchor_menu_settings');
    $paragraph->method('id')->willReturn('636');
    $paragraph->method('hasField')->willReturn(FALSE);
    $variables = ['paragraph' => $paragraph];

    \webspark_blocks_preprocess_paragraph($variables);

    $this->assertSame('webspark-anchor-link--636', $variables['anchor_target_id']);
    $this->assertSame([], $variables['anchor_alias_ids']);
  }

  /**
   * Tests other paragraph bundles are left untouched.
   */
  public function testOtherParagraphBundle(): void {
    $paragraph = $this->createMock(ParagraphInterface::class);
    $paragraph->method('bundle')->willReturn('accordion_panel');
    $paragraph->expects($this->never())->method('id');
    $variables = ['paragraph' => $paragraph];

    \webspark_blocks_preprocess_paragraph($variables);

    $this->assertArrayNotHasKey('anchor_target_id', $variables);
    $this->assertArrayNotHasKey('anchor_alias_ids', $variables);
  }

}
