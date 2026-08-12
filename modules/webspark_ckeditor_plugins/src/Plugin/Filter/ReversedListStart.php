<?php

namespace Drupal\webspark_ckeditor_plugins\Plugin\Filter;

use Drupal\Component\Utility\Html;
use Drupal\filter\FilterProcessResult;
use Drupal\filter\Plugin\FilterBase;

/**
 * Writes an explicit start attribute onto reversed ordered lists.
 *
 * When an <ol reversed> has no start attribute, the browser must derive the
 * starting value at layout time from the number of list items. Chromium can
 * resolve that value incorrectly when the number is read from generated
 * content -- as the UDS list styles do, via li::before and
 * counter(list-item) -- producing zero and negative numbering that varies
 * between page loads. Stating the value explicitly removes the computation,
 * so there is nothing left to resolve out of order.
 *
 * The value is the highest number in the sequence the author chose. CKEditor
 * stores the ascending first number in `start`, so a three item list set to
 * "start at 5" is saved as <ol reversed start="5">. Left alone the browser
 * counts down from 5 and renders 5, 4, 3, but the numbers the author picked
 * are 5, 6 and 7, so reversing them has to begin at 7.
 *
 * Note that this filter must only ever run on stored data, never on its own
 * output, since it reads `start` as the author's value and rewrites it.
 *
 * @Filter(
 *   id = "webspark_reversed_list_start",
 *   title = @Translation("Add explicit start attribute to reversed lists"),
 *   description = @Translation("Prevents incorrect numbering in reversed numbered lists by writing the highest number of the sequence into the start attribute. Place this filter after any filter that restricts allowed HTML."),
 *   type = Drupal\filter\Plugin\FilterInterface::TYPE_TRANSFORM_IRREVERSIBLE
 * )
 */
class ReversedListStart extends FilterBase {

  /**
   * {@inheritdoc}
   */
  public function process($text, $langcode) {
    // Avoid parsing a DOM for the vast majority of fields, which contain no
    // reversed list at all.
    if (stripos($text, 'reversed') === FALSE) {
      return new FilterProcessResult($text);
    }

    $dom = Html::load($text);
    $xpath = new \DOMXPath($dom);
    $changed = FALSE;

    $lists = $xpath->query('//ol[@reversed]');
    if ($lists === FALSE) {
      return new FilterProcessResult($text);
    }

    foreach ($lists as $ol) {
      if (!$ol instanceof \DOMElement) {
        continue;
      }

      // Count direct children only. Nested lists have their own counter
      // scope and are matched separately by the query above.
      $count = (int) $xpath->evaluate('count(./li)', $ol);

      if ($count < 1) {
        continue;
      }

      // An absent start attribute means the sequence begins at 1.
      $first = $ol->hasAttribute('start') ? (int) $ol->getAttribute('start') : 1;
      $highest = (string) ($first + $count - 1);

      if ($ol->getAttribute('start') !== $highest) {
        $ol->setAttribute('start', $highest);
        $changed = TRUE;
      }
    }

    // Return the original string when nothing was altered, so that unrelated
    // markup is never normalised by a DOM round trip.
    if (!$changed) {
      return new FilterProcessResult($text);
    }

    return new FilterProcessResult(Html::serialize($dom));
  }

  /**
   * {@inheritdoc}
   */
  public function tips($long = FALSE) {
    return $this->t('Reversed numbered lists count down from the number of items to one.');
  }

}
