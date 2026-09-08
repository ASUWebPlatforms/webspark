<?php

namespace Drupal\asu_createai_provider;

use Drupal\ai\OperationType\Chat\StreamedChatMessageIterator;

/**
 * Streamed chat message iterator for the CreateAI provider.
 *
 * Wraps a generator of decoded Server-Sent Events chunks from CreateAI's
 * OpenAI-compatible /chat/completions streaming endpoint and turns each
 * chunk's `choices[0].delta.content` into a streamed chat message.
 */
class CreateAiChatMessageIterator extends StreamedChatMessageIterator {

  /**
   * {@inheritdoc}
   */
  public function doIterate(): \Generator {
    foreach ($this->iterator as $chunk) {
      $delta = $chunk['choices'][0]['delta']['content'] ?? '';
      $finish_reason = $chunk['choices'][0]['finish_reason'] ?? NULL;
      if (!empty($finish_reason)) {
        $this->setFinishReason($finish_reason);
      }
      yield $this->createStreamedChatMessage('assistant', $delta, [], NULL, $chunk);
    }
  }

}
