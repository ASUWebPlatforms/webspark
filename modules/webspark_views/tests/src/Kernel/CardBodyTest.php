<?php

namespace Drupal\Tests\webspark_views\Kernel;

use Drupal\Core\Render\Markup;
use Drupal\KernelTests\KernelTestBase;
use Drupal\filter\Entity\FilterFormat;
use Drupal\webspark_views\Plugin\views\style\CardViewFormat;

/**
 * Tests the card body builder used by the card view format.
 *
 * @group webspark_views
 */
class CardBodyTest extends KernelTestBase {

  /**
   * {@inheritdoc}
   */
  protected static $modules = [
    'system',
    'user',
    'field',
    'filter',
    'text',
    'views',
    'webspark_views',
  ];

  /**
   * {@inheritdoc}
   */
  protected function setUp(): void {
    parent::setUp();
    $this->installConfig(['system', 'filter']);
    $this->container->get('module_handler')->loadInclude('webspark_views', 'module');

    // A restrictive format that allows only <strong> and <em>.
    FilterFormat::create([
      'format' => 'card_limited',
      'name' => 'Card limited',
      'filters' => [
        'filter_html' => [
          'status' => 1,
          'settings' => ['allowed_html' => '<strong> <em>'],
        ],
      ],
    ])->save();
  }

  /**
   * Builds a minimal node-like object with a single text body field.
   */
  protected function node(string $value, string $summary = ''): object {
    $item = (object) ['value' => $value, 'summary' => $summary];
    $field = new class($item) {

      public function __construct(private object $item) {}

      /**
       * Whether the field has no value or summary.
       */
      public function isEmpty(): bool {
        return $this->item->value === '' && $this->item->summary === '';
      }

      /**
       * Returns a property of the single field item.
       */
      public function __get(string $name) {
        return $this->item->{$name};
      }

    };
    return new class($field) {

      public function __construct(private object $field) {}

      /**
       * Whether the node has the given field.
       */
      public function hasField(string $name): bool {
        return $name === 'body';
      }

      /**
       * Returns the body field.
       */
      public function get(string $name): object {
        return $this->field;
      }

    };
  }

  /**
   * Allowed tags survive, disallowed tags and attributes are stripped.
   */
  public function testConfiguredFormatFiltersMarkup(): void {
    $truncated = FALSE;
    $result = _webspark_views_get_body(
      $this->node('<p onclick="x()">Hello <strong>world</strong> <script>alert(1)</script><em>!</em></p>'),
      'body',
      ['body_text_format' => 'card_limited'],
      $truncated,
    );

    $this->assertInstanceOf(Markup::class, $result);
    $html = (string) $result;
    $this->assertStringContainsString('<strong>world</strong>', $html);
    $this->assertStringContainsString('<em>!</em>', $html);
    $this->assertStringNotContainsString('<script', $html);
    $this->assertStringNotContainsString('onclick', $html);
    $this->assertStringNotContainsString('<p', $html);
    $this->assertFalse($truncated);
  }

  /**
   * The summary is preferred over the full value when present.
   */
  public function testSummaryIsPreferred(): void {
    $truncated = FALSE;
    $result = _webspark_views_get_body(
      $this->node('<strong>full</strong>', '<em>summary</em>'),
      'body',
      ['body_text_format' => 'card_limited'],
      $truncated,
    );

    $this->assertSame('<em>summary</em>', trim((string) $result));
  }

  /**
   * A missing format falls back without fataling and still escapes markup.
   */
  public function testMissingFormatFallsBackSafely(): void {
    $truncated = FALSE;
    $result = _webspark_views_get_body(
      $this->node('<script>alert(1)</script>plain'),
      'body',
      ['body_text_format' => 'does_not_exist'],
      $truncated,
    );

    $this->assertInstanceOf(Markup::class, $result);
    $this->assertStringNotContainsString('<script', (string) $result);
    $this->assertStringContainsString('plain', (string) $result);
  }

  /**
   * Long bodies are truncated and flagged.
   */
  public function testLongBodyIsTruncated(): void {
    $truncated = FALSE;
    $result = _webspark_views_get_body(
      $this->node(str_repeat('word ', 100)),
      'body',
      ['body_text_format' => 'card_limited'],
      $truncated,
    );

    $this->assertTrue($truncated);
    $this->assertLessThanOrEqual(210, mb_strlen((string) $result));
  }

  /**
   * Missing or empty body fields return NULL.
   */
  public function testMissingOrEmptyBodyReturnsNull(): void {
    $truncated = FALSE;
    $this->assertNull(_webspark_views_get_body($this->node('x'), 'field_nope', [], $truncated));
    $this->assertNull(_webspark_views_get_body($this->node(''), 'body', [], $truncated));
  }

  /**
   * With no usable format at all, the site fallback format is used.
   */
  public function testSiteFallbackFormatIsUsedWhenDefaultIsUnavailable(): void {
    $default = FilterFormat::load(CardViewFormat::DEFAULT_BODY_TEXT_FORMAT);
    if ($default) {
      $default->disable()->save();
    }
    $this->assertNotEmpty(_webspark_views_fallback_format_id());
    $this->assertSame(
      $this->config('filter.settings')->get('fallback_format'),
      _webspark_views_fallback_format_id(),
    );

    $truncated = FALSE;
    $result = _webspark_views_get_body(
      $this->node('<script>alert(1)</script><strong>plain</strong>'),
      'body',
      ['body_text_format' => 'does_not_exist'],
      $truncated,
    );

    $this->assertInstanceOf(Markup::class, $result);
    $this->assertStringNotContainsString('<script', (string) $result);
    $this->assertStringContainsString('plain', (string) $result);
  }

  /**
   * The default body text format constant is the documented fallback.
   */
  public function testDefaultFormatConstantExists(): void {
    $this->assertNotEmpty(CardViewFormat::DEFAULT_BODY_TEXT_FORMAT);
  }

}
