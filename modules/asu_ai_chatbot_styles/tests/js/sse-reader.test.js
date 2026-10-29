/* eslint-disable import/no-extraneous-dependencies */
/**
 * @file
 * SSE-reader unit tests — §23.6.d (4 cases).
 *
 * node --test sse-reader.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv } = require('./helpers/jsdom-env');

/**
 * Builds a minimal Response-like object whose body is a ReadableStream
 * that yields the given chunks (each chunk is a Uint8Array/string).
 *
 * @param {string[]} chunks
 * @return {object}  Fake Response
 */
function makeSseResponse(chunks) {
  const enc = new TextEncoder();
  let idx = 0;
  const readable = {
    getReader: () => ({
      read: () => {
        if (idx >= chunks.length) {
          return Promise.resolve({ done: true, value: undefined });
        }
        const value =
          typeof chunks[idx] === 'string'
            ? enc.encode(chunks[idx])
            : chunks[idx];
        idx++;
        return Promise.resolve({ done: false, value });
      },
    }),
  };
  return {
    body: readable,
    headers: { get: () => 'text/event-stream' },
  };
}

// ---------------------------------------------------------------------------
// 1. readSse_single_event_html
//    A single SSE chunk "data: {"html":"abc"}\n\n" → {html:"abc"}
// ---------------------------------------------------------------------------
test('readSse_single_event_html', async () => {
  const { AsuSparkles } = buildEnv();
  const { readSseStream } = AsuSparkles._test;

  const response = makeSseResponse(['data: {"html":"abc"}\n\n']);
  const result = await readSseStream(response);
  assert.equal(
    result.html,
    'abc',
    `Expected html=abc; got ${JSON.stringify(result)}`,
  );
});

// ---------------------------------------------------------------------------
// 2. readSse_multi_chunk_concat
//    Three events (a, b, c) across TWO reader reads → {html:"abc"}
//    Chunk 1: 'data: {"html":"a"}\n\ndata: {"html":"b"}\n\n'
//    Chunk 2: 'data: {"html":"c"}\n\n'
// ---------------------------------------------------------------------------
test('readSse_multi_chunk_concat', async () => {
  const { AsuSparkles } = buildEnv();
  const { readSseStream } = AsuSparkles._test;

  const response = makeSseResponse([
    'data: {"html":"a"}\n\ndata: {"html":"b"}\n\n',
    'data: {"html":"c"}\n\n',
  ]);
  const result = await readSseStream(response);
  assert.equal(
    result.html,
    'abc',
    `Expected html=abc; got ${JSON.stringify(result)}`,
  );
});

// ---------------------------------------------------------------------------
// 3. readSse_overwrite_true_replaces
//    {html:"a"} then {html:"XYZ",overwrite:true} → {html:"XYZ"}
// ---------------------------------------------------------------------------
test('readSse_overwrite_true_replaces', async () => {
  const { AsuSparkles } = buildEnv();
  const { readSseStream } = AsuSparkles._test;

  const response = makeSseResponse([
    'data: {"html":"a"}\n\n',
    'data: {"html":"XYZ","overwrite":true}\n\n',
  ]);
  const result = await readSseStream(response);
  assert.equal(
    result.html,
    'XYZ',
    `Expected html=XYZ; got ${JSON.stringify(result)}`,
  );
});

// ---------------------------------------------------------------------------
// 4. readSse_ignores_done_and_malformed
//    Mix in data: [DONE] and data: {malformed — final html unchanged.
// ---------------------------------------------------------------------------
test('readSse_ignores_done_and_malformed', async () => {
  const { AsuSparkles } = buildEnv();
  const { readSseStream } = AsuSparkles._test;

  const response = makeSseResponse([
    'data: {"html":"hello"}\n\n',
    'data: [DONE]\n\n',
    'data: {malformed\n\n',
    'data: {"html":" world"}\n\n',
  ]);
  const result = await readSseStream(response);
  assert.equal(
    result.html,
    'hello world',
    `Expected html='hello world'; got ${JSON.stringify(result)}`,
  );
});
