<?php

namespace Drupal\asu_brand;

use Drupal\asu_brand\Entity\AsuBrandPalette;
use Drupal\Component\Utility\Color;
use Drupal\Core\Cache\Cache;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Extension\ThemeExtensionList;
use Drupal\Core\File\FileSystemInterface;
use Drupal\Core\File\FileUrlGeneratorInterface;
use Psr\Log\LoggerInterface;

/**
 * Generates per-palette copies of the sentinel-compiled unbranded stylesheet.
 *
 * The Renovation theme ships ONE compiled unbranded stylesheet whose four UDS
 * brand tokens are unique sentinel values (never served raw). Applying a
 * palette rewrites every color literal of a sentinel's family to the same
 * color derived from the palette, and writes the result to the site's public
 * files so it works per-site on ACSF without any build toolchain.
 *
 * A sentinel's family is every mix of the sentinel with white and black:
 * Bootstrap bakes button hover/active states, subtle backgrounds, focus
 * rings, table variants, etc. as tint-color()/shade-color()/mix() chains of
 * the brand tokens at compile time. Each literal (hex, short hex, URL-encoded
 * hex in SVG data URIs, or a bare r,g,b triplet) is solved as
 * k * sentinel + a * white (+ the rest black) and rewritten as
 * k * palette color + a * white, so every weight and chain follows the
 * palette without listing them. The same is done for the families of the
 * real ASU colors, which UDS hardcodes in some rules (see ASU_COLORS).
 */
class PaletteCssGenerator {

  /**
   * Sentinel values compiled into the base stylesheet, keyed by token.
   *
   * MUST stay in sync with renovation.style.unbranded.scss. Each sentinel
   * matches the luminance class of the ASU color it replaces, so Bootstrap's
   * compile-time contrast and tint/shade decisions match the branded build.
   * Each has a zero channel and no two are proportional, so no color can
   * belong to two families.
   */
  public const SENTINELS = [
    'maroon' => '#8c008b',
    'gold' => '#00ffc1',
    'dark_maroon' => '#4a0028',
    'dark_gold' => '#5a6e00',
  ];

  /**
   * ASU colors hardcoded as literals in the compiled base, keyed by token.
   *
   * UDS ships some rules with literal brand hexes instead of the SCSS tokens
   * (e.g. `.btn-maroon:hover { background-color: #8C1D40 !important }`, or
   * `$uds-color-font-light-visited: #d3a524`, a shade of gold), so the
   * sentinel build cannot reach them. An unbranded stylesheet must never
   * contain ASU colors, so these and their tint/shade families are remapped
   * to the palette exactly like the sentinels.
   */
  public const ASU_COLORS = [
    'maroon' => '#8c1d40',
    'gold' => '#ffc627',
    'dark_maroon' => '#440e22',
    'dark_gold' => '#7f6227',
  ];

  /**
   * Minimum brand weight for a color to count as part of a family.
   *
   * Below it the color is effectively a neutral gray/white/black.
   */
  public const MIN_WEIGHT = 0.15;

  /**
   * Maximum per-channel error, in 0-255 units, when matching a family.
   *
   * Absorbs Sass rounding in chained derivations.
   */
  public const TOLERANCE = 2.0;

  /**
   * Bumped whenever the replacement logic changes.
   *
   * Part of the generated file name, so a deploy with new generator logic
   * produces a fresh file instead of serving one built by the old logic.
   */
  public const VERSION = 3;

  /**
   * Directory (stream URI) holding the generated palette stylesheets.
   */
  public const DIRECTORY = 'public://asu_brand/palettes';

  /**
   * Path of the sentinel base stylesheet, relative to the Renovation theme.
   */
  public const BASE_CSS = 'assets/css/renovation.style.unbranded.css';

  /**
   * Cache tags that depend on the served palette stylesheet.
   */
  public const CACHE_TAGS = ['library_info', 'config:asu_brand.settings'];

  /**
   * Innermost `{ ... }` block: a declaration block, never a selector list.
   *
   * Color literals are only rewritten inside these, so an ID selector that
   * happens to look like a hex color (`#deface {}`) is never touched. Nested
   * at-rules (`@media { .x {} }`) are not innermost, their inner rules are.
   */
  protected const BLOCK_PATTERN = '/\{[^{}]*\}/';

  /**
   * Hex color literal: `#rrggbb`, `#rgb`, or URL-encoded `%23rrggbb`.
   *
   * `url(#id)` fragment references are excluded; they are not colors.
   */
  protected const HEX_PATTERN = '/(?<!url\()(?<!url\(\')(?<!url\(")(#|%23)([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i';

  /**
   * Bare `r,g,b` triplet as emitted in rgb()/rgba() and `--bs-*-rgb` values.
   */
  protected const TRIPLET_PATTERN = '/(?<=[(:])(\s*)(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?=\s*[,);])/';

  /**
   * MD5 of the base stylesheet, memoized per request.
   */
  protected ?string $baseHash = NULL;

  public function __construct(
    protected ConfigFactoryInterface $configFactory,
    protected EntityTypeManagerInterface $entityTypeManager,
    protected FileSystemInterface $fileSystem,
    protected ThemeExtensionList $themeList,
    protected FileUrlGeneratorInterface $fileUrlGenerator,
    protected LoggerInterface $logger,
  ) {}

  /**
   * Generates (or refreshes) the stylesheet for a palette.
   *
   * @return string|null
   *   The URI of the generated file, or NULL on failure.
   */
  public function generate(AsuBrandPalette $palette): ?string {
    $uri = $this->uriFor($palette);
    if (!$uri) {
      return NULL;
    }
    $colors = [];
    foreach (array_keys(self::SENTINELS) as $token) {
      $colors[$token] = strtolower($palette->getColorValue($token) ?? '');
      if (!Color::validateHex($colors[$token])) {
        $this->logger->error('Palette @id has an invalid color for token @token; generation aborted.', [
          '@id' => $palette->id(),
          '@token' => $token,
        ]);
        return NULL;
      }
    }
    $css = self::replaceColors(file_get_contents($this->basePath()), $colors);

    $dir = self::DIRECTORY;
    if (!$this->fileSystem->prepareDirectory($dir, FileSystemInterface::CREATE_DIRECTORY | FileSystemInterface::MODIFY_PERMISSIONS)) {
      $this->logger->error('Could not prepare the palette stylesheet directory @dir.', ['@dir' => self::DIRECTORY]);
      return NULL;
    }
    // One file per palette, content-addressed for cache busting.
    $this->deleteFiles($palette->id());
    if (!file_put_contents($uri, $css)) {
      $this->logger->error('Could not write the palette stylesheet @uri.', ['@uri' => $uri]);
      return NULL;
    }
    return $uri;
  }

  /**
   * Root-relative URL of the ACTIVE palette's stylesheet, or NULL.
   *
   * Regenerates the file when missing (e.g. after a files-only restore, or
   * after a deploy rebuilt the base stylesheet — see uriFor()), so config
   * remains the single source of truth.
   */
  public function getActiveCssUrl(): ?string {
    $active = $this->configFactory->get('asu_brand.settings')->get('asu_brand.asu_brand_active_palette');
    if (!$active) {
      return NULL;
    }
    $palette = $this->entityTypeManager->getStorage('asu_brand_palette')->load($active);
    if (!$palette instanceof AsuBrandPalette) {
      return NULL;
    }
    $uri = $this->uriFor($palette);
    if (!$uri || (!file_exists($uri) && !$this->generate($palette))) {
      return NULL;
    }
    return $this->fileUrlGenerator->generateString($uri);
  }

  /**
   * Deletes all generated stylesheets for a palette id.
   */
  public function deleteFiles(string $id): void {
    if (is_dir($this->fileSystem->realpath(self::DIRECTORY) ?: '')) {
      foreach ($this->fileSystem->scanDirectory(self::DIRECTORY, '/^' . preg_quote($id, '/') . '\..*\.css$/') as $file) {
        $this->fileSystem->delete($file->uri);
      }
    }
  }

  /**
   * Deletes every generated stylesheet.
   *
   * The active palette's file is regenerated lazily by getActiveCssUrl() on
   * the next library rebuild, so this is safe to call at any time.
   */
  public function deleteAllFiles(): void {
    if (is_dir($this->fileSystem->realpath(self::DIRECTORY) ?: '')) {
      $this->fileSystem->deleteRecursive(self::DIRECTORY);
    }
  }

  /**
   * Invalidates the caches that hold the served palette stylesheet URL.
   */
  public function invalidateCaches(): void {
    Cache::invalidateTags(self::CACHE_TAGS);
  }

  /**
   * The content-addressed URI for a palette's stylesheet, or NULL.
   *
   * The hash covers the palette colors, the base stylesheet contents and the
   * generator version: a deploy that rebuilds the base (e.g. a UDS upgrade)
   * or changes the replacement logic yields a new file name, so the stale
   * file is never served and the new one is generated on the next library
   * rebuild — no palette re-save needed.
   */
  protected function uriFor(AsuBrandPalette $palette): ?string {
    $base_hash = $this->baseHash();
    if (!$base_hash) {
      return NULL;
    }
    $hash = substr(hash('sha256', serialize([
      $palette->getColors(),
      $base_hash,
      self::VERSION,
    ])), 0, 8);
    return self::DIRECTORY . '/' . $palette->id() . '.' . $hash . '.css';
  }

  /**
   * Rewrites every brand-family color literal for a palette.
   *
   * @param string $css
   *   The sentinel base stylesheet.
   * @param string[] $colors
   *   Palette colors '#rrggbb', keyed by token.
   *
   * @return string
   *   The stylesheet with the colors replaced.
   */
  public static function replaceColors(string $css, array $colors): string {
    $targets = array_map([self::class, 'hexToRgb'], $colors);
    $families = self::families();
    return preg_replace_callback(self::BLOCK_PATTERN, static function ($block) use ($targets, $families) {
      $out = preg_replace_callback(self::HEX_PATTERN, static function ($m) use ($targets, $families) {
        $rgb = self::mapColor(self::hexToRgb($m[2]), $targets, $families);
        return $rgb ? $m[1] . substr(self::rgbToHex($rgb), 1) : $m[0];
      }, $block[0]);
      return preg_replace_callback(self::TRIPLET_PATTERN, static function ($m) use ($targets, $families) {
        $rgb = self::mapColor([(int) $m[2], (int) $m[3], (int) $m[4]], $targets, $families);
        return $rgb ? $m[1] . implode(',', $rgb) : $m[0];
      }, $out);
    }, $css);
  }

  /**
   * Every color literal of a stylesheet, as the generator sees them.
   *
   * Shares the scanner with replaceColors(), so tests that assert on the
   * generated output cannot drift from what generation actually rewrites.
   *
   * @param string $css
   *   A stylesheet.
   *
   * @return array
   *   Map of '#rrggbb' => [r, g, b].
   */
  public static function findColors(string $css): array {
    $colors = [];
    preg_match_all(self::BLOCK_PATTERN, $css, $blocks);
    foreach ($blocks[0] as $block) {
      preg_match_all(self::HEX_PATTERN, $block, $m);
      foreach ($m[2] as $hex) {
        $rgb = self::hexToRgb($hex);
        $colors[self::rgbToHex($rgb)] = $rgb;
      }
      preg_match_all(self::TRIPLET_PATTERN, $block, $m, PREG_SET_ORDER);
      foreach ($m as $t) {
        $rgb = [(int) $t[2], (int) $t[3], (int) $t[4]];
        $colors[self::rgbToHex($rgb)] = $rgb;
      }
    }
    return $colors;
  }

  /**
   * Maps one color to its palette equivalent, or NULL when unrelated.
   *
   * @param int[] $rgb
   *   The color as [r, g, b].
   * @param array $targets
   *   Palette colors as [r, g, b], keyed by token.
   * @param array|null $families
   *   [token, [r, g, b]] pairs, sentinels first; NULL to use families().
   *
   * @return int[]|null
   *   The replacement [r, g, b], or NULL to leave the color untouched.
   */
  public static function mapColor(array $rgb, array $targets, ?array $families = NULL): ?array {
    foreach ($families ?? self::families() as [$token, $brand]) {
      $mix = self::solveMix($rgb, $brand);
      if ($mix) {
        [$k, $a] = $mix;
        return array_map(static fn ($c) => (int) max(0, min(255, round($k * $c + $a * 255))), $targets[$token]);
      }
    }
    return NULL;
  }

  /**
   * Solves a color as k * brand + a * white (+ the rest black).
   *
   * Least squares over the three channels, accepted only when the fit is
   * within TOLERANCE on every channel and the weights form a valid mix.
   *
   * @param int[] $rgb
   *   The color as [r, g, b].
   * @param int[] $brand
   *   The brand color (sentinel or ASU) as [r, g, b].
   *
   * @return float[]|null
   *   [k, a] or NULL when the color is not in the brand color's family.
   */
  public static function solveMix(array $rgb, array $brand): ?array {
    // Normal equations for minimizing sum((k*s + a*255 - c)^2).
    $ss = $sc = $s = $c = 0;
    foreach ([0, 1, 2] as $i) {
      $ss += $brand[$i] ** 2;
      $sc += $brand[$i] * $rgb[$i];
      $s += $brand[$i];
      $c += $rgb[$i];
    }
    $det = $ss * 3 * 255 ** 2 - (255 * $s) ** 2;
    if ($det == 0) {
      return NULL;
    }
    $k = ($sc * 3 * 255 ** 2 - 255 * $s * 255 * $c) / $det;
    $a = ($ss * 255 * $c - 255 * $s * $sc) / $det;
    if ($k < self::MIN_WEIGHT || $a < -0.01 || $k + $a > 1.01) {
      return NULL;
    }
    foreach ([0, 1, 2] as $i) {
      if (abs($k * $brand[$i] + $a * 255 - $rgb[$i]) > self::TOLERANCE) {
        return NULL;
      }
    }
    return [$k, max(0.0, $a)];
  }

  /**
   * Brand colors whose families are remapped, resolved to [r, g, b].
   *
   * Sentinels first (what the base is built from), then the ASU literals.
   *
   * @return array
   *   List of [token, [r, g, b]] pairs.
   */
  public static function families(): array {
    static $families;
    if ($families === NULL) {
      $families = [];
      foreach ([self::SENTINELS, self::ASU_COLORS] as $set) {
        foreach ($set as $token => $hex) {
          $families[] = [$token, self::hexToRgb($hex)];
        }
      }
    }
    return $families;
  }

  /**
   * Absolute filesystem path of the sentinel base stylesheet.
   */
  protected function basePath(): ?string {
    try {
      $theme_path = $this->themeList->getPath('renovation');
    }
    catch (\Exception $e) {
      return NULL;
    }
    return DRUPAL_ROOT . '/' . $theme_path . '/' . self::BASE_CSS;
  }

  /**
   * MD5 of the base stylesheet, or NULL (logged) when it cannot be read.
   */
  protected function baseHash(): ?string {
    if ($this->baseHash === NULL) {
      $base = $this->basePath();
      if (!$base || !is_readable($base)) {
        $this->logger->error('Unbranded palette base stylesheet not found at @path; the default ASU stylesheet is served.', ['@path' => $base ?? '(unresolved)']);
        return NULL;
      }
      $this->baseHash = md5_file($base);
    }
    return $this->baseHash;
  }

  /**
   * Converts a hex color ('#rrggbb', '#rgb', with or without '#') to [r, g, b].
   */
  public static function hexToRgb(string $hex): array {
    return array_values(Color::hexToRgb($hex));
  }

  /**
   * Converts [r, g, b] to '#rrggbb'.
   */
  public static function rgbToHex(array $rgb): string {
    return Color::rgbToHex($rgb);
  }

}
