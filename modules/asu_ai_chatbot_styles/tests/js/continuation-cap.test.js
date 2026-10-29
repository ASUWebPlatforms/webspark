/* eslint-disable import/no-extraneous-dependencies */
/**
 * @file
 * Continuation-cap unit tests — §23.6.b (3 cases).
 *
 * node --test continuation-cap.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv } = require('./helpers/jsdom-env');

// ---------------------------------------------------------------------------
// 1. cap_allows_10_follow_ups
//    Mock postMessage so it always returns { html: 'x', should_continue: true }.
//    After 11 total POSTs (initial + 10 follow-ups), the cap trips:
//    - Error bubble rendered (replaceTyping called with isError=true).
//    - setBusy(false) called exactly once for the cap trip.
//    - No 12th POST.
// ---------------------------------------------------------------------------
test('cap_allows_10_follow_ups', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const { CONTINUATION_LIMIT } = env.AsuSparkles._test;
  assert.equal(CONTINUATION_LIMIT, 10, 'CONTINUATION_LIMIT must be 10');

  let postCount = 0;
  // Override postMessage to always say should_continue.
  ctrl.postMessage = function (url, config, messages, signal) {
    postCount++;
    return Promise.resolve({ html: 'x', should_continue: true });
  };
  // Override ensureCsrfToken to avoid network.
  ctrl.ensureCsrfToken = function () {
    return Promise.resolve('tok');
  };
  ctrl.endpointUrl = function () {
    return '/api/deepchat?token=tok';
  };

  const replaceTypingCalls = [];
  const origReplace = ctrl.replaceTyping.bind(ctrl);
  ctrl.replaceTyping = function (bubble, content, isError) {
    replaceTypingCalls.push({ content, isError });
    return origReplace(bubble, content, isError);
  };

  let setBusyFalseCount = 0;
  const origSetBusy = ctrl.setBusy.bind(ctrl);
  ctrl.setBusy = function (busy) {
    if (!busy) setBusyFalseCount++;
    return origSetBusy(busy);
  };

  // Trigger the chain via handleResponse directly with depth=0.
  const config = env.window.drupalSettings.ai_deepchat;
  const typing = ctrl.renderTyping();
  const myGen = ctrl._resetGeneration;
  await new Promise((resolve) => {
    const origBusy = ctrl.setBusy;
    // Resolve when setBusy(false) is called (cap trip or natural end).
    ctrl.setBusy = function (busy) {
      origBusy.call(ctrl, busy);
      if (!busy) resolve();
    };
    ctrl.handleResponse(
      config,
      { html: 'x', should_continue: true },
      typing,
      myGen,
      0,
    );
  });

  // 11 total POSTs: the initial is counted as postCount from handleResponse
  // (the should_continue path); at d=0 the first call fires (d+1=1 <= 10),
  // ... at d=9 the 10th follow-up fires (d+1=10 <= 10), at d=10 cap trips.
  // The first call to handleResponse is from sendToBackend (not postMessage),
  // so postMessage is called 10 times for the follow-ups.
  assert.equal(
    postCount,
    10,
    `Expected 10 postMessage calls (follow-ups); got ${postCount}`,
  );

  // The last replaceTyping call should be an error bubble (cap trip).
  const last = replaceTypingCalls[replaceTypingCalls.length - 1];
  assert.ok(
    last && last.isError,
    `Last replaceTyping should be isError; got ${JSON.stringify(last)}`,
  );
  assert.ok(
    last.content.includes('stopped') || last.content.includes('Please try'),
    `Cap error message unexpected: ${last.content}`,
  );
});

// ---------------------------------------------------------------------------
// 2. cap_stops_at_11th
//    Verify that at d+1 > CONTINUATION_LIMIT, no POST is issued.
//    Call handleResponse directly with depth = CONTINUATION_LIMIT (10).
// ---------------------------------------------------------------------------
test('cap_stops_at_11th', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const { CONTINUATION_LIMIT } = env.AsuSparkles._test;
  let postCount = 0;
  ctrl.postMessage = function () {
    postCount++;
    return Promise.resolve({ html: 'x', should_continue: true });
  };
  ctrl.ensureCsrfToken = function () {
    return Promise.resolve('tok');
  };
  ctrl.endpointUrl = function () {
    return '/api/deepchat?token=tok';
  };

  const genBefore = ctrl._resetGeneration;

  const config = env.window.drupalSettings.ai_deepchat;
  const typing = ctrl.renderTyping();
  const myGen = ctrl._resetGeneration;

  await new Promise((resolve) => {
    ctrl.setBusy = function (busy) {
      if (!busy) resolve();
    };
    // depth = CONTINUATION_LIMIT means d+1 = 11 > 10 → cap trips immediately.
    ctrl.handleResponse(
      config,
      { html: 'x', should_continue: true },
      typing,
      myGen,
      CONTINUATION_LIMIT,
    );
  });

  assert.equal(
    postCount,
    0,
    `No POST should be issued at cap; got ${postCount}`,
  );
  assert.equal(
    ctrl._resetGeneration,
    genBefore,
    '_resetGeneration must not change on cap trip',
  );
});

// ---------------------------------------------------------------------------
// 3. cap_not_triggered_when_should_continue_false
//    One response with should_continue: false → normal success path.
// ---------------------------------------------------------------------------
test('cap_not_triggered_when_should_continue_false', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  let announceText = '';
  ctrl.announce = function (msg) {
    announceText = msg;
  };

  let replaceTypingErrors = 0;
  ctrl.replaceTyping = function (bubble, content, isError) {
    if (isError) replaceTypingErrors++;
    // call original for DOM side effect
    if (bubble) bubble.textContent = content;
  };

  const config = env.window.drupalSettings.ai_deepchat;
  const typing = ctrl.renderTyping();
  const myGen = ctrl._resetGeneration;

  await new Promise((resolve) => {
    ctrl.setBusy = function (busy) {
      if (!busy) resolve();
    };
    ctrl.handleResponse(
      config,
      { html: '<p>Hi</p>', should_continue: false },
      typing,
      myGen,
      0,
    );
  });

  assert.equal(replaceTypingErrors, 0, 'No error bubble on normal completion');
  assert.ok(announceText.length > 0, 'announce should fire on success');
});
