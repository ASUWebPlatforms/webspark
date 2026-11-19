<?php

namespace Drupal\Tests\asu_brand\Unit;

use Drupal\asu_brand\PaletteCssGenerator;
use Drupal\Tests\UnitTestCase;

/**
 * Guards the sentinel-replacement coverage of the palette CSS generator.
 *
 * @coversDefaultClass \Drupal\asu_brand\PaletteCssGenerator
 * @group asu_brand
 */
class PaletteCssGeneratorTest extends UnitTestCase {

  /**
   * Path to the compiled Renovation assets, relative to this file.
   */
  private const ASSETS = __DIR__ . '/../../../../../themes/renovation/assets/css/';

  /**
   * A palette unrelated to both the sentinels and ASU.
   */
  private const PALETTE = [
    'maroon' => '#0d3b66',
    'gold' => '#f4a261',
    'dark_maroon' => '#081f33',
    'dark_gold' => '#c17a3a',
  ];

  /**
   * Tints, shades and chained mixes resolve to their sentinel weights.
   *
   * @covers ::solveMix
   * @dataProvider mixProvider
   */
  public function testSolveMix(array $rgb, array $sentinel, float $k, float $a): void {
    $mix = PaletteCssGenerator::solveMix($rgb, $sentinel);
    $this->assertNotNull($mix);
    $this->assertEqualsWithDelta($k, $mix[0], 0.02);
    $this->assertEqualsWithDelta($a, $mix[1], 0.02);
  }

  /**
   * Reference values captured from the compiled Bootstrap output.
   *
   * @return array
   *   Test cases of [color, sentinel, sentinel weight, white weight].
   */
  public static function mixProvider(): array {
    $maroon = [140, 0, 139];
    $gold = [0, 255, 193];
    return [
      'exact sentinel' => [$maroon, $maroon, 1, 0],
      'tint 15 (btn hover)' => [[0x26, 0xff, 0xca], $gold, 0.85, 0.15],
      'shade 60 (text emphasis)' => [[0x38, 0x00, 0x38], $maroon, 0.4, 0],
      'tint 80 + shade 10 (table border)' => [[0xd1, 0xb8, 0xd1], $maroon, 0.18, 0.72],
    ];
  }

  /**
   * Neutral and unrelated colors are never treated as a sentinel's family.
   *
   * @covers ::solveMix
   */
  public function testSolveMixRejectsUnrelatedColors(): void {
    foreach (PaletteCssGenerator::SENTINELS as $sentinel) {
      $s = PaletteCssGenerator::hexToRgb($sentinel);
      foreach (['#ffffff', '#000000', '#191919', '#dee2e6', '#212529', '#00a3e0', '#78be20'] as $color) {
        $this->assertNull(PaletteCssGenerator::solveMix(PaletteCssGenerator::hexToRgb($color), $s), "$color matched the $sentinel family.");
      }
    }
  }

  /**
   * No color of the branded build may belong to a sentinel family.
   *
   * Otherwise a real (non-brand) color in the base would be rewritten to a
   * palette color. Fails when a sentinel is changed to a value too close to
   * an existing UDS color.
   */
  public function testSentinelsAreUniqueAgainstBrandedBuild(): void {
    foreach (PaletteCssGenerator::findColors($this->css('renovation.style.css')) as $hex => $rgb) {
      if (in_array($hex, PaletteCssGenerator::ASU_COLORS, TRUE)) {
        continue;
      }
      foreach (PaletteCssGenerator::SENTINELS as $token => $sentinel) {
        $this->assertNull(
          PaletteCssGenerator::solveMix($rgb, PaletteCssGenerator::hexToRgb($sentinel)),
          sprintf('Branded color %s falls in the %s sentinel family (%s).', $hex, $token, $sentinel)
        );
      }
    }
  }

  /**
   * Generating with the ASU colors reproduces the branded build.
   *
   * This is the end-to-end check that every brand-derived color of the
   * sentinel base is reached: any color left unmapped (or mapped wrong)
   * shows up as a color the branded build does not have. Sass rounding of
   * chained mixes may differ by one unit per channel.
   */
  public function testAsuPaletteReproducesBrandedBuild(): void {
    $generated = PaletteCssGenerator::replaceColors($this->css('renovation.style.unbranded.css'), PaletteCssGenerator::ASU_COLORS);
    $branded = PaletteCssGenerator::findColors($this->css('renovation.style.css'));
    foreach (PaletteCssGenerator::findColors($generated) as $hex => $rgb) {
      if (isset($branded[$hex])) {
        continue;
      }
      $near = array_filter($branded, static fn ($b) => max(array_map(static fn ($x, $y) => abs($x - $y), $b, $rgb)) <= 1);
      $this->assertNotEmpty($near, "Generated color $hex does not exist in the branded build: a brand-derived color is not remapped.");
    }
  }

  /**
   * No sentinel-family or ASU-family color survives generation with a palette.
   *
   * Covers UDS literals that are shades of a brand color rather than the
   * color itself (e.g. $uds-color-font-light-visited #d3a524, a gold shade).
   *
   * @covers ::replaceColors
   */
  public function testNoBrandFamilySurvivesReplacement(): void {
    $out = PaletteCssGenerator::replaceColors($this->css('renovation.style.unbranded.css'), self::PALETTE);
    foreach (PaletteCssGenerator::findColors($out) as $hex => $rgb) {
      foreach (PaletteCssGenerator::families() as [$token, $brand]) {
        $this->assertNull(
          PaletteCssGenerator::solveMix($rgb, $brand),
          sprintf('Brand-family color %s (%s %s) leaked through generation.', $hex, $token, PaletteCssGenerator::rgbToHex($brand))
        );
      }
    }
  }

  /**
   * Color literals are only rewritten inside declaration blocks.
   *
   * @covers ::replaceColors
   */
  public function testSelectorsAndFragmentReferencesAreUntouched(): void {
    $sentinel = ltrim(PaletteCssGenerator::SENTINELS['maroon'], '#');
    $css = "#$sentinel,a{color:#$sentinel;mask:url(#$sentinel);fill:url('#$sentinel')}";
    $out = PaletteCssGenerator::replaceColors($css, self::PALETTE);
    $this->assertSame("#$sentinel,a{color:" . self::PALETTE['maroon'] . ";mask:url(#$sentinel);fill:url('#$sentinel')}", $out);
  }

  /**
   * Reads a committed compiled stylesheet.
   */
  private function css(string $file): string {
    $this->assertFileExists(self::ASSETS . $file);
    return file_get_contents(self::ASSETS . $file);
  }

}
