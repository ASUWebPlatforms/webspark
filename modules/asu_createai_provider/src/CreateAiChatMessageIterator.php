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
    $warned_tool_call = FALSE;
    foreach ($this->iterator as $chunk) {
      $delta = $chunk['choices'][0]['delta']['content'] ?? '';
      $finish_reason = $chunk['choices'][0]['finish_reason'] ?? NULL;
      if (!empty($finish_reason)) {
        $this->setFinishReason($finish_reason);
      }
      // This iterator only reads delta.content; it never accumulates
      // delta.tool_calls (a known, documented gap — see AGENTS.md). Log
      // loudly (once per response, since a single tool call streams across
      // many chunks) rather than silently dropping the tool call, since
      // nothing upstream currently guards against a streamed request that
      // ends up needing tool calling.
      if (!$warned_tool_call && !empty($chunk['choices'][0]['delta']['tool_calls'])) {
        \Drupal::logger('asu_createai_provider')->warning(
          'CreateAI streamed response requested a tool call, but the streaming path does not support tool calling. The tool call was dropped. Use non-streamed chat for any tool-calling request.'
        );
        $warned_tool_call = TRUE;
      }
      yield $this->createStreamedChatMessage('assistant', $delta, [], NULL, $chunk);
    }
  }

}
