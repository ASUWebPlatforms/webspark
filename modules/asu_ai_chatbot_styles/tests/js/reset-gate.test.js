/* eslint-disable no-await-in-loop, import/no-extraneous-dependencies */
/**
 * @file
 * Reset-gate unit tests — §23.6.c (5 cases).
 *
 * node --test reset-gate.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv } = require('./helpers/jsdom-env');

// ---------------------------------------------------------------------------
// 1. submit_blocked_while_resetting
//    Set controller.resetting = true; call submitQuery; assert fetch not called,
//    announce fired with the waiting message, no bubble rendered.
// ---------------------------------------------------------------------------
test('submit_blocked_while_resetting', () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  ctrl.resetting = true;
  let fetchCalled = false;
  env.window.fetch = function () {
    fetchCalled = true;
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({}),
    });
  };

  let announced = '';
  ctrl.announce = function (msg) {
    announced = msg;
  };

  const logChildrenBefore = ctrl.log ? ctrl.log.children.length : 0;

  ctrl.submitQuery('hi', 'typed');

  assert.ok(!fetchCalled, 'fetch must NOT be called while resetting');
  assert.equal(
    announced,
    'Please wait — resetting the conversation.',
    `announce must be exactly 'Please wait — resetting the conversation.'; got: "${announced}"`,
  );
  const logChildrenAfter = ctrl.log ? ctrl.log.children.length : 0;
  assert.equal(
    logChildrenAfter,
    logChildrenBefore,
    'No new bubble appended while resetting',
  );
});

// ---------------------------------------------------------------------------
// 2. clear_aborts_inflight_submit
//    sendToBackend → pending fetch; clearConversation → signal.aborted === true;
//    _abortController is null after abort; no error bubble.
// ---------------------------------------------------------------------------
test('clear_aborts_inflight_submit', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  let capturedSignal = null;
  let resolveFetch;
  env.window.fetch = function (url, opts) {
    if (url && url.includes('deepchat/session')) {
      // CSRF token fetch
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ token: 'tok' }),
        text: () => Promise.resolve('tok'),
      });
    }
    if (url && url.includes('api/deepchat')) {
      capturedSignal = opts && opts.signal;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    }
    // reset-session fetch
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true, thread_id: 't2' }),
    });
  };

  let errorBubbleRendered = false;
  ctrl.replaceTyping = function (bubble, content, isError) {
    if (isError) errorBubbleRendered = true;
    if (bubble) bubble.textContent = content;
  };

  ctrl.sendToBackend('hello');

  // Give the microtask queue a tick so the fetch is in flight.
  await Promise.resolve();
  await Promise.resolve();

  ctrl.clearConversation();

  // Allow the abort to propagate.
  await Promise.resolve();
  await Promise.resolve();

  if (capturedSignal) {
    assert.ok(
      capturedSignal.aborted,
      'signal.aborted must be true after clearConversation',
    );
  }
  assert.equal(
    ctrl._abortController,
    null,
    '_abortController must be null after abort',
  );
  assert.ok(!errorBubbleRendered, 'AbortError must not render an error bubble');
});

// ---------------------------------------------------------------------------
// 3. clear_releases_gate_on_success
//    Stub reset endpoint → { thread_id: 't2' }; after microtask queue drains:
//    resetting === false, config.thread_id === 't2', input/send enabled.
// ---------------------------------------------------------------------------
test('clear_releases_gate_on_success', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  env.window.fetch = function (url) {
    // reset-session
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true, thread_id: 't2' }),
    });
  };

  ctrl.clearConversation();

  // Drain microtask queue sufficiently.
  for (let i = 0; i < 10; i++) await Promise.resolve();

  const config = env.window.drupalSettings.ai_deepchat;
  assert.equal(ctrl.resetting, false, 'resetting must be false after success');
  assert.equal(
    config.thread_id,
    't2',
    `thread_id must update to 't2'; got ${config.thread_id}`,
  );
  if (ctrl.input)
    assert.equal(ctrl.input.disabled, false, 'input must be enabled');
  if (ctrl.sendBtn)
    assert.equal(ctrl.sendBtn.disabled, false, 'sendBtn must be enabled');
});

// ---------------------------------------------------------------------------
// 4. clear_releases_gate_on_failure
//    Stub reset endpoint to reject with TypeError; assert resetting === false,
//    old thread_id preserved, input/send enabled, no error bubble.
// ---------------------------------------------------------------------------
test('clear_releases_gate_on_failure', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const oldThreadId = env.window.drupalSettings.ai_deepchat.thread_id;

  env.window.fetch = function () {
    return Promise.reject(new TypeError('Network error'));
  };

  let errorBubbleRendered = false;
  ctrl.replaceTyping = function (bubble, content, isError) {
    if (isError) errorBubbleRendered = true;
    if (bubble) bubble.textContent = content;
  };

  ctrl.clearConversation();

  for (let i = 0; i < 10; i++) await Promise.resolve();

  const config = env.window.drupalSettings.ai_deepchat;
  assert.equal(ctrl.resetting, false, 'resetting must be false after failure');
  assert.equal(
    config.thread_id,
    oldThreadId,
    `Old thread_id must be preserved; got ${config.thread_id}`,
  );
  if (ctrl.input)
    assert.equal(ctrl.input.disabled, false, 'input must be enabled');
  if (ctrl.sendBtn)
    assert.equal(ctrl.sendBtn.disabled, false, 'sendBtn must be enabled');
  assert.ok(!errorBubbleRendered, 'No error bubble on reset failure');
});

// ---------------------------------------------------------------------------
// 6. double_clear_stale_success_does_not_release (FIX 2 RED)
//
// Clear A fires, then Clear B fires before A's reset-session response.
// When A's response resolves, it must NOT release resetting / re-enable UI /
// commit its thread_id, because B is still pending.
// Only when B resolves should the gate open and B's thread_id be applied.
// ---------------------------------------------------------------------------
test('double_clear_stale_success_does_not_release', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  // Two deferred resolvers — one per clear.
  let resolveA;
  let resolveB;
  let callCount = 0;

  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      callCount += 1;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveB = resolve;
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({}),
    });
  };

  // Clear A — starts first reset.
  ctrl.clearConversation();
  // Allow microtasks to set up A's fetch.
  await Promise.resolve();

  // Clear B — starts second reset; A is still pending.
  ctrl.clearConversation();
  await Promise.resolve();

  // Resolve A's response AFTER B has been dispatched.
  resolveA({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ success: true, thread_id: 'thread-A' }),
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();

  // A's stale resolve must NOT release the gate — B is still pending.
  assert.equal(
    ctrl.resetting,
    true,
    'resetting must stay true — B is still pending after A resolves',
  );
  if (ctrl.input)
    assert.equal(
      ctrl.input.disabled,
      true,
      'input must stay disabled — B is still pending',
    );
  if (ctrl.sendBtn)
    assert.equal(
      ctrl.sendBtn.disabled,
      true,
      'sendBtn must stay disabled — B is still pending',
    );
  const config = env.window.drupalSettings.ai_deepchat;
  assert.notEqual(
    config.thread_id,
    'thread-A',
    "A's thread_id must NOT be committed while B is pending",
  );

  // Now resolve B.
  resolveB({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ success: true, thread_id: 'thread-B' }),
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();

  assert.equal(
    ctrl.resetting,
    false,
    'resetting must be false after B resolves',
  );
  assert.equal(
    config.thread_id,
    'thread-B',
    "B's thread_id must be applied after B resolves",
  );
  if (ctrl.input)
    assert.equal(
      ctrl.input.disabled,
      false,
      'input must be enabled after B resolves',
    );
  if (ctrl.sendBtn)
    assert.equal(
      ctrl.sendBtn.disabled,
      false,
      'sendBtn must be enabled after B resolves',
    );
});

// ---------------------------------------------------------------------------
// 7. detach_root_context_cleans_up (FIX 3 RED)
//
// When Drupal.behaviors.asuAiChatbotSparkles.detach() is called with the
// widget root AS the context (not just an ancestor), the controller's
// observers must be disconnected and AbortControllers aborted.
// ---------------------------------------------------------------------------
test('detach_root_context_cleans_up', () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  // The behavior's detach reads root._asuSparklesController (set by attach()).
  // Simulate what attach() does:
  root._asuSparklesController = ctrl;

  // Simulate observers/handlers being set so they can be verified.
  // We track disconnected/aborted state via flags.
  let logObserverDisconnected = false;
  let rootObserverDisconnected = false;

  ctrl._logObserver = {
    disconnect() {
      logObserverDisconnected = true;
    },
    observe() {},
  };
  ctrl._rootObserver = {
    disconnect() {
      rootObserverDisconnected = true;
    },
    observe() {},
  };

  let abortControllerAborted = false;
  ctrl._abortController = {
    abort() {
      abortControllerAborted = true;
    },
    signal: { aborted: false },
  };

  let resetAbortControllerAborted = false;
  ctrl._resetAbortController = {
    abort() {
      resetAbortControllerAborted = true;
    },
    signal: { aborted: false },
  };

  // Detach with the widget root as context (the bug: root is skipped by
  // querySelectorAll because it does not match itself).
  const behavior = env.window.Drupal.behaviors.asuAiChatbotSparkles;
  behavior.detach(root, {}, 'unload');

  assert.ok(
    logObserverDisconnected,
    'logObserver must be disconnected when root is the detach context',
  );
  assert.ok(
    rootObserverDisconnected,
    'rootObserver must be disconnected when root is the detach context',
  );
  assert.ok(
    abortControllerAborted,
    '_abortController must be aborted when root is the detach context',
  );
  assert.ok(
    resetAbortControllerAborted,
    '_resetAbortController must be aborted when root is the detach context',
  );
});

// ---------------------------------------------------------------------------
// 8. resetting_ui_input_disabled_during_reset (FIX 4 RED)
//
// After clearConversation() is called, input.disabled and sendBtn.disabled
// must both be true for the entire duration of the reset window.
// Specifically: setBusy(false) fires to clear busy state, but it must NOT
// re-enable input/sendBtn while resetting is active.
// ---------------------------------------------------------------------------
test('resetting_ui_input_disabled_during_reset', () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  // Intercept the reset-session fetch so it never resolves (gate stays open).
  env.window.fetch = function () {
    return new Promise(() => {}); // never resolves
  };

  ctrl.clearConversation();

  // Immediately after clearConversation (synchronous), resetting must be true
  // and input/send must be disabled even though setBusy(false) was called.
  assert.equal(
    ctrl.resetting,
    true,
    'resetting must be true after clearConversation',
  );
  if (ctrl.input) {
    assert.equal(
      ctrl.input.disabled,
      true,
      'input.disabled must be true while resetting (setBusy(false) must not win)',
    );
  }
  if (ctrl.sendBtn) {
    assert.equal(
      ctrl.sendBtn.disabled,
      true,
      'sendBtn.disabled must be true while resetting (setBusy(false) must not win)',
    );
  }
});

// ---------------------------------------------------------------------------
// 5. abort_error_not_rendered_as_error_bubble
//    Fetch rejects with DOMException { name: 'AbortError' }; assert that
//    replaceTyping is NOT called with the generic error string, setBusy(false)
//    NOT called, token NOT cleared.
// ---------------------------------------------------------------------------
test('abort_error_not_rendered_as_error_bubble', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  // Pre-load a cached CSRF token so fetch calls go straight to postMessage.
  env.window.Drupal.AsuSparkles.csrfToken = 'pre-tok';

  const abortErr = new env.window.DOMException(
    'The user aborted a request.',
    'AbortError',
  );
  env.window.fetch = function (url) {
    if (url && url.includes('deepchat/session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: () => Promise.resolve('tok'),
      });
    }
    return Promise.reject(abortErr);
  };

  let replaceTypingGenericError = false;
  ctrl.replaceTyping = function (bubble, content, isError) {
    if (
      isError &&
      (content.includes('went wrong') || content.includes('Sorry'))
    ) {
      replaceTypingGenericError = true;
    }
    if (bubble) bubble.textContent = content;
  };

  let setBusyFalseCalled = false;
  ctrl.setBusy = function (busy) {
    if (!busy) setBusyFalseCalled = true;
    ctrl.busy = !!busy;
  };

  ctrl.sendToBackend('test-abort');

  for (let i = 0; i < 20; i++) await Promise.resolve();

  assert.ok(
    !replaceTypingGenericError,
    'AbortError must NOT render a generic error bubble',
  );
  assert.ok(
    !setBusyFalseCalled,
    'setBusy(false) must NOT be called by the AbortError swallow path',
  );
  // Token must NOT be cleared by the AbortError swallow.
  assert.ok(
    env.window.Drupal.AsuSparkles.csrfToken !== null,
    'csrfToken must NOT be cleared on AbortError',
  );
});

// ---------------------------------------------------------------------------
// Iter-12 new cases (RED first — will fail until production code is updated)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// i12-1. reset_success_announces_cleared_and_commits_thread
//   On a successful reset (ok + thread_id), announce 'Conversation cleared.'
//   ONLY AFTER the response, and commit the new thread_id.
//   The synchronous announce that existed before Fix 1 must be GONE:
//   i.e. announce must NOT fire before the fetch resolves.
// ---------------------------------------------------------------------------
test('reset_success_announces_cleared_and_commits_thread', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push({ msg, resolvingNow: !!ctrl._resolving });
  };

  let resolveFetch;
  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      return new Promise(function (resolve) {
        resolveFetch = resolve;
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  ctrl.clearConversation();

  // Drain sync + microtasks — fetch is still pending.
  for (let i = 0; i < 5; i++) await Promise.resolve();

  // Must NOT have announced yet (synchronous announce removed by Fix 1).
  // Exact count: zero 'Conversation cleared.' before fetch resolves.
  const clearedBeforeResolve = announcements.filter(function (a) {
    return a.msg === 'Conversation cleared.';
  }).length;
  assert.equal(
    clearedBeforeResolve,
    0,
    `Must have ZERO 'Conversation cleared.' before the fetch resolves; got ${clearedBeforeResolve}`,
  );

  // Now resolve with success.
  resolveFetch({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ success: true, thread_id: 'new-thread-1' }),
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();

  // Exactly one 'Conversation cleared.' after success.
  const clearedCount = announcements.filter(function (a) {
    return a.msg === 'Conversation cleared.';
  }).length;
  assert.equal(
    clearedCount,
    1,
    `Must announce 'Conversation cleared.' exactly once on success; got ${clearedCount}`,
  );
  // Exactly zero failure announcements.
  const failureCount = announcements.filter(function (a) {
    return a.msg === 'The conversation could not be reset. Please try again.';
  }).length;
  assert.equal(
    failureCount,
    0,
    `Must have ZERO failure announcements on success; got ${failureCount}`,
  );

  const config = env.window.drupalSettings.ai_deepchat;
  assert.equal(
    config.thread_id,
    'new-thread-1',
    'thread_id must be committed on success',
  );
  assert.equal(ctrl.resetting, false, 'resetting must be false after success');
});

// ---------------------------------------------------------------------------
// i12-2. reset_non_ok_announces_failure_keeps_old_thread_and_releases
//   When the server returns ok=false (e.g. 404), the gate releases,
//   old thread_id is preserved, and the failure message is announced.
// ---------------------------------------------------------------------------
test('reset_non_ok_announces_failure_keeps_old_thread_and_releases', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const oldThreadId = env.window.drupalSettings.ai_deepchat.thread_id;
  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({}),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  ctrl.clearConversation();
  for (let i = 0; i < 10; i++) await Promise.resolve();

  assert.equal(ctrl.resetting, false, 'resetting must be false after non-ok');
  const config = env.window.drupalSettings.ai_deepchat;
  assert.equal(
    config.thread_id,
    oldThreadId,
    'Old thread_id must be preserved on non-ok response',
  );
  const failureCount = announcements.filter(function (msg) {
    return msg === 'The conversation could not be reset. Please try again.';
  }).length;
  assert.equal(
    failureCount,
    1,
    `Must announce failure exactly once on non-ok response; got ${failureCount}`,
  );
  const clearedCount = announcements.filter(function (msg) {
    return msg === 'Conversation cleared.';
  }).length;
  assert.equal(
    clearedCount,
    0,
    `Must have ZERO 'Conversation cleared.' on failure; got ${clearedCount}`,
  );
});

// ---------------------------------------------------------------------------
// i12-3. reset_success_false_treated_as_failure
//   When server returns ok=true but body has { success: false }, treat as failure.
// ---------------------------------------------------------------------------
test('reset_success_false_treated_as_failure', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const oldThreadId = env.window.drupalSettings.ai_deepchat.thread_id;
  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ success: false }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  ctrl.clearConversation();
  for (let i = 0; i < 10; i++) await Promise.resolve();

  assert.equal(
    ctrl.resetting,
    false,
    'resetting must be false after success:false',
  );
  const config = env.window.drupalSettings.ai_deepchat;
  assert.equal(
    config.thread_id,
    oldThreadId,
    'Old thread_id must be preserved when success:false',
  );
  const failureCountI3 = announcements.filter(function (msg) {
    return msg === 'The conversation could not be reset. Please try again.';
  }).length;
  assert.equal(
    failureCountI3,
    1,
    `Must announce failure exactly once when success:false; got ${failureCountI3}`,
  );
  const clearedCountI3 = announcements.filter(function (msg) {
    return msg === 'Conversation cleared.';
  }).length;
  assert.equal(
    clearedCountI3,
    0,
    `Must have ZERO 'Conversation cleared.' on success:false; got ${clearedCountI3}`,
  );
});

// ---------------------------------------------------------------------------
// i12-4. reset_network_error_announces_failure_keeps_thread
//   Network error (TypeError) releases gate, keeps old thread, announces failure.
// ---------------------------------------------------------------------------
test('reset_network_error_announces_failure_keeps_thread', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const oldThreadId = env.window.drupalSettings.ai_deepchat.thread_id;
  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      return Promise.reject(new TypeError('Network error'));
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  ctrl.clearConversation();
  for (let i = 0; i < 10; i++) await Promise.resolve();

  assert.equal(
    ctrl.resetting,
    false,
    'resetting must be false after network error',
  );
  const config = env.window.drupalSettings.ai_deepchat;
  assert.equal(
    config.thread_id,
    oldThreadId,
    'Old thread_id preserved on network error',
  );
  const failureCountI4 = announcements.filter(function (msg) {
    return msg === 'The conversation could not be reset. Please try again.';
  }).length;
  assert.equal(
    failureCountI4,
    1,
    `Must announce failure exactly once on network error; got ${failureCountI4}`,
  );
  const clearedCountI4 = announcements.filter(function (msg) {
    return msg === 'Conversation cleared.';
  }).length;
  assert.equal(
    clearedCountI4,
    0,
    `Must have ZERO 'Conversation cleared.' on network error; got ${clearedCountI4}`,
  );
});

// ---------------------------------------------------------------------------
// i12-5. reset_timeout_aborts_releases_and_announces_failure
//   A never-resolving reset-session fetch triggers the 10 s timeout:
//   abort is called, resetting=false, failure announced, old thread kept.
// ---------------------------------------------------------------------------
test('reset_timeout_aborts_releases_and_announces_failure', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const oldThreadId = env.window.drupalSettings.ai_deepchat.thread_id;
  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  // Never-resolving fetch that honours the abort signal.
  env.window.fetch = function (url, opts) {
    if (url && url.includes('reset-session')) {
      return new Promise(function (resolve, reject) {
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', function () {
            const err = new env.window.DOMException(
              'The user aborted a request.',
              'AbortError',
            );
            reject(err);
          });
        }
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  // Replace jsdom's window.setTimeout so we can fire it manually.
  let capturedTimerCb = null;
  let capturedTimerDelay = null;
  const origSetTimeout = env.window.setTimeout;
  const origClearTimeout = env.window.clearTimeout;
  env.window.setTimeout = function (cb, delay) {
    capturedTimerCb = cb;
    capturedTimerDelay = delay;
    return 9999; // fake timer id
  };
  env.window.clearTimeout = function (id) {
    if (id === 9999) capturedTimerCb = null;
  };

  try {
    ctrl.clearConversation();
    // Drain microtasks so the fetch is in flight.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    // Verify resetting is true before timeout.
    assert.equal(ctrl.resetting, true, 'resetting must be true before timeout');
    assert.ok(
      capturedTimerCb !== null,
      'setTimeout must have been called with a callback',
    );
    assert.ok(
      capturedTimerDelay >= 10000,
      `RESET_TIMEOUT_MS must be >= 10000; got ${capturedTimerDelay}`,
    );

    // Fire the timeout callback manually (simulates time advance past 10 s).
    capturedTimerCb();
    // Drain microtasks from the abort (the abort causes the fetch to reject).
    for (let i = 0; i < 20; i++) await Promise.resolve();

    assert.equal(
      ctrl.resetting,
      false,
      'resetting must be false after timeout',
    );
    const config = env.window.drupalSettings.ai_deepchat;
    assert.equal(
      config.thread_id,
      oldThreadId,
      'Old thread_id must be preserved after timeout',
    );
    const failureCountI5 = announcements.filter(function (msg) {
      return msg === 'The conversation could not be reset. Please try again.';
    }).length;
    assert.equal(
      failureCountI5,
      1,
      `Must announce failure exactly once on timeout; got ${failureCountI5}`,
    );
    const clearedCountI5 = announcements.filter(function (msg) {
      return msg === 'Conversation cleared.';
    }).length;
    assert.equal(
      clearedCountI5,
      0,
      `Must have ZERO 'Conversation cleared.' on timeout; got ${clearedCountI5}`,
    );
  } finally {
    env.window.setTimeout = origSetTimeout;
    env.window.clearTimeout = origClearTimeout;
  }
});

// ---------------------------------------------------------------------------
// i12-6. reset_timeout_does_not_fire_after_success
//   Timer is cleared on settle; a successful reset must NOT trigger the timeout.
// ---------------------------------------------------------------------------
test('reset_timeout_does_not_fire_after_success', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  let resolveFetch;
  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      return new Promise(function (resolve) {
        resolveFetch = resolve;
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  // Capture the timer callback so we can try to fire it late.
  let capturedTimerCb = null;
  const origSetTimeout = env.window.setTimeout;
  const origClearTimeout = env.window.clearTimeout;
  env.window.setTimeout = function (cb, delay) {
    capturedTimerCb = cb;
    return 9998; // fake timer id
  };
  env.window.clearTimeout = function (id) {
    if (id === 9998) capturedTimerCb = null; // timer cleared on settle
  };

  try {
    ctrl.clearConversation();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    // Resolve BEFORE the timeout.
    resolveFetch({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () =>
        Promise.resolve({ success: true, thread_id: 'settled-thread' }),
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Success path should have released gate and cleared the timer.
    assert.equal(
      ctrl.resetting,
      false,
      'resetting must be false after success',
    );
    assert.equal(
      capturedTimerCb,
      null,
      'Timer must be cleared (clearTimeout called) on settle',
    );

    // Exactly one 'Conversation cleared.' on success.
    const clearedCountI6 = announcements.filter(function (msg) {
      return msg === 'Conversation cleared.';
    }).length;
    assert.equal(
      clearedCountI6,
      1,
      `Must announce 'Conversation cleared.' exactly once; got ${clearedCountI6}`,
    );
    // Zero failure announcements.
    const failureCountI6 = announcements.filter(function (msg) {
      return msg === 'The conversation could not be reset. Please try again.';
    }).length;
    assert.equal(
      failureCountI6,
      0,
      `No failure announced after successful reset (timer was cleared on settle); got ${failureCountI6}`,
    );
  } finally {
    env.window.setTimeout = origSetTimeout;
    env.window.clearTimeout = origClearTimeout;
  }
});

// ---------------------------------------------------------------------------
// i12-7. csrf_fetch_receives_abort_signal
//   When a submit is in flight and clearConversation() is called,
//   ensureCsrfToken must receive (and forward) the submit's AbortController
//   signal. Aborting the submit controller rejects the CSRF fetch with
//   AbortError, which is swallowed (no error bubble).
// ---------------------------------------------------------------------------
test('csrf_fetch_receives_abort_signal', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  // Clear any cached CSRF token so the fetch must be made.
  env.window.Drupal.AsuSparkles.csrfToken = null;

  let capturedCsrfSignal = null;
  let csrfReject;

  env.window.fetch = function (url, opts) {
    if (url && url.includes('deepchat/session')) {
      capturedCsrfSignal = opts && opts.signal;
      // Hang until externally rejected via the captured signal.
      return new Promise(function (resolve, reject) {
        csrfReject = reject;
        // Also honour the signal's abort event if it fires.
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', function () {
            const err = new env.window.DOMException(
              'The user aborted a request.',
              'AbortError',
            );
            reject(err);
          });
        }
      });
    }
    if (url && url.includes('api/deepchat')) {
      return new Promise(function () {}); // never resolves
    }
    // reset-session
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ thread_id: 'r1' }),
    });
  };

  let errorBubbleRendered = false;
  ctrl.replaceTyping = function (bubble, content, isError) {
    if (isError) errorBubbleRendered = true;
  };

  // Start a submit — this should call ensureCsrfToken with the submit signal.
  ctrl.sendToBackend('hello');
  for (let i = 0; i < 3; i++) await Promise.resolve();

  // CSRF fetch should now be in flight with the submit's signal.
  assert.ok(
    capturedCsrfSignal !== null && capturedCsrfSignal !== undefined,
    'ensureCsrfToken must forward the submit signal to the CSRF fetch',
  );

  // Abort via clearConversation (which aborts _abortController).
  ctrl.clearConversation();
  for (let i = 0; i < 10; i++) await Promise.resolve();

  // The signal should now be aborted.
  if (capturedCsrfSignal) {
    assert.ok(
      capturedCsrfSignal.aborted,
      'The submit signal forwarded to CSRF fetch must be aborted',
    );
  }
  assert.ok(
    !errorBubbleRendered,
    'AbortError from CSRF fetch must not render an error bubble',
  );
});

// ---------------------------------------------------------------------------
// i12-8. chips_and_clear_disabled_during_reset_then_reenabled
//   After clearConversation(), chips (<button>) and clearBtn must be disabled.
//   After the reset settles, all must be re-enabled.
// ---------------------------------------------------------------------------
test('chips_and_clear_disabled_during_reset_then_reenabled', async () => {
  const env = buildEnv();
  // Build root WITH chips and a clearBtn.
  const root = env.buildRoot({ withChips: true });
  const ctrl = new env.AsuSparkles.Controller(root);

  // Give clearBtn a hidden=false so it counts as present.
  if (ctrl.clearBtn) ctrl.clearBtn.hidden = false;

  let resolveFetch;
  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      return new Promise(function (resolve) {
        resolveFetch = resolve;
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  ctrl.clearConversation();
  // Drain microtasks.
  for (let i = 0; i < 5; i++) await Promise.resolve();

  // All chips must be disabled during reset.
  const chipsDisabledDuringReset =
    ctrl.chips.length > 0 &&
    ctrl.chips.every(function (c) {
      return c.disabled === true;
    });
  assert.ok(
    chipsDisabledDuringReset,
    `All chips must be disabled during reset (found ${ctrl.chips.length} chips)`,
  );

  // clearBtn must be disabled during reset.
  if (ctrl.clearBtn) {
    assert.equal(
      ctrl.clearBtn.disabled,
      true,
      'clearBtn must be disabled during reset',
    );
  }

  // Resolve the reset.
  resolveFetch({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve({ success: true, thread_id: 'after-reset' }),
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();

  // All chips must be re-enabled.
  const chipsReenabledAfterReset = ctrl.chips.every(function (c) {
    return c.disabled === false;
  });
  assert.ok(
    chipsReenabledAfterReset,
    'All chips must be re-enabled after reset',
  );

  // clearBtn must be re-enabled.
  if (ctrl.clearBtn) {
    assert.equal(
      ctrl.clearBtn.disabled,
      false,
      'clearBtn must be re-enabled after reset',
    );
  }
});

// ---------------------------------------------------------------------------
// REVIEW-FIX CYCLE 2 — Iter 12 — new RED tests
// These tests enforce the EXACT findings from the reviewer's iter-12 report:
//   P1-c: success criterion must be data.success === true (not !false)
//   P1-a+P1-b: timeout is generation-owned; cleared only at full settle
//   P2-a: chip click handler guards on this.resetting
//   P2-b: exact-once announcement assertions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// rc2-1. reset_200_success_false_is_failure (exact-once announce)
//   200 + { success: false } must announce failure exactly once,
//   ZERO 'Conversation cleared.' calls, keep old thread_id, release gate.
// ---------------------------------------------------------------------------
test('reset_200_success_false_is_failure', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const oldThreadId = env.window.drupalSettings.ai_deepchat.thread_id;
  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ success: false }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  ctrl.clearConversation();
  for (let i = 0; i < 10; i++) await Promise.resolve();

  // Exactly zero 'Conversation cleared.' announcements.
  const clearedCount = announcements.filter(
    (m) => m === 'Conversation cleared.',
  ).length;
  assert.equal(
    clearedCount,
    0,
    `Must have ZERO 'Conversation cleared.' on success:false; got ${clearedCount}`,
  );

  // Exactly one failure announcement.
  const failureCount = announcements.filter(
    (m) => m === 'The conversation could not be reset. Please try again.',
  ).length;
  assert.equal(
    failureCount,
    1,
    `Must announce failure exactly once on success:false; got ${failureCount}`,
  );

  assert.equal(
    ctrl.resetting,
    false,
    'resetting must be false after success:false',
  );
  const config = env.window.drupalSettings.ai_deepchat;
  assert.equal(
    config.thread_id,
    oldThreadId,
    'Old thread_id must be preserved on success:false',
  );
});

// ---------------------------------------------------------------------------
// rc2-2. reset_200_success_true_null_thread_keeps_old_thread_and_announces_cleared
//   200 + { success: true, thread_id: null } (observed live on techtestai):
//   - announce 'Conversation cleared.' exactly once
//   - KEEP old thread_id (do NOT commit null)
//   - release gate
// ---------------------------------------------------------------------------
test('reset_200_success_true_null_thread_keeps_old_thread_and_announces_cleared', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const oldThreadId = env.window.drupalSettings.ai_deepchat.thread_id;
  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ success: true, thread_id: null }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  ctrl.clearConversation();
  for (let i = 0; i < 10; i++) await Promise.resolve();

  // Exactly one 'Conversation cleared.' announcement.
  const clearedCount = announcements.filter(
    (m) => m === 'Conversation cleared.',
  ).length;
  assert.equal(
    clearedCount,
    1,
    `Must announce 'Conversation cleared.' exactly once on success+null-thread; got ${clearedCount}`,
  );

  // Exactly zero failure announcements.
  const failureCount = announcements.filter(
    (m) => m === 'The conversation could not be reset. Please try again.',
  ).length;
  assert.equal(
    failureCount,
    0,
    `Must have ZERO failure announcements on success+null-thread; got ${failureCount}`,
  );

  // Old thread_id must be kept (null thread_id must NOT be committed).
  const config = env.window.drupalSettings.ai_deepchat;
  assert.equal(
    config.thread_id,
    oldThreadId,
    `Old thread_id must be kept when server returns null thread_id; got ${config.thread_id}`,
  );

  assert.equal(
    ctrl.resetting,
    false,
    'resetting must be false after success+null-thread',
  );
});

// ---------------------------------------------------------------------------
// rc2-3. reset_empty_body_treated_as_failure
//   200 + empty/malformed body (json() resolves to {}) is NOT a confirmed success:
//   data.success is undefined, NOT === true, so treat as failure.
//   Exactly zero cleared announcements, exactly one failure announcement.
// ---------------------------------------------------------------------------
test('reset_empty_body_treated_as_failure', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const oldThreadId = env.window.drupalSettings.ai_deepchat.thread_id;
  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({}), // empty body
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  ctrl.clearConversation();
  for (let i = 0; i < 10; i++) await Promise.resolve();

  const clearedCount = announcements.filter(
    (m) => m === 'Conversation cleared.',
  ).length;
  assert.equal(
    clearedCount,
    0,
    `Must have ZERO 'Conversation cleared.' on empty body; got ${clearedCount}`,
  );

  const failureCount = announcements.filter(
    (m) => m === 'The conversation could not be reset. Please try again.',
  ).length;
  assert.equal(
    failureCount,
    1,
    `Must announce failure exactly once on empty body; got ${failureCount}`,
  );

  assert.equal(ctrl.resetting, false, 'resetting released on empty body');
  const config = env.window.drupalSettings.ai_deepchat;
  assert.equal(
    config.thread_id,
    oldThreadId,
    'Old thread_id kept on empty body',
  );
});

// ---------------------------------------------------------------------------
// rc2-4. reset_hanging_body_times_out_as_failure
//   Simulates a response whose headers arrive (ok=true) but whose body
//   (.json()) never resolves. The safety timeout must still fire because
//   the timer must NOT be cleared at the headers step.
// ---------------------------------------------------------------------------
test('reset_hanging_body_times_out_as_failure', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const oldThreadId = env.window.drupalSettings.ai_deepchat.thread_id;
  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  // fetch resolves with ok=true, but .json() never resolves (hanging body).
  env.window.fetch = function (url, opts) {
    if (url && url.includes('reset-session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        // json() never resolves — simulates a stalled response body
        json: () =>
          new Promise(function (resolve, reject) {
            // honour the signal in case the timeout fires before json resolves
            if (opts && opts.signal) {
              opts.signal.addEventListener('abort', function () {
                reject(
                  new env.window.DOMException(
                    'The user aborted a request.',
                    'AbortError',
                  ),
                );
              });
            }
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  // Replace setTimeout/clearTimeout so we control the timer manually.
  let capturedTimerCb = null;
  let timerCleared = false;
  const origSetTimeout = env.window.setTimeout;
  const origClearTimeout = env.window.clearTimeout;
  env.window.setTimeout = function (cb, delay) {
    capturedTimerCb = cb;
    return 7777;
  };
  env.window.clearTimeout = function (id) {
    if (id === 7777) {
      timerCleared = true;
      capturedTimerCb = null;
    }
  };

  try {
    ctrl.clearConversation();
    // Drain microtasks — headers arrive (ok path fires), body still pending.
    for (let i = 0; i < 8; i++) await Promise.resolve();

    // KEY ASSERTION: timer must still be armed after headers arrive.
    // If the production code clears the timer in the first .then, this fails.
    assert.ok(
      capturedTimerCb !== null,
      'Timer must still be armed after response headers arrive (body still pending)',
    );
    assert.equal(
      timerCleared,
      false,
      'clearTimeout must NOT have been called yet — timer must stay armed until full settle',
    );

    // Now fire the timeout manually (simulates 10 s elapsed).
    capturedTimerCb();
    for (let i = 0; i < 20; i++) await Promise.resolve();

    assert.equal(
      ctrl.resetting,
      false,
      'resetting must be false after timeout fires',
    );
    const config = env.window.drupalSettings.ai_deepchat;
    assert.equal(
      config.thread_id,
      oldThreadId,
      'Old thread_id preserved after body-hang timeout',
    );
    const failureCount = announcements.filter(
      (m) => m === 'The conversation could not be reset. Please try again.',
    ).length;
    assert.equal(
      failureCount,
      1,
      `Exactly one failure announcement on timeout; got ${failureCount}`,
    );
  } finally {
    env.window.setTimeout = origSetTimeout;
    env.window.clearTimeout = origClearTimeout;
  }
});

// ---------------------------------------------------------------------------
// rc2-5. overlapping_clear_stale_settle_does_not_clear_or_abort_newer_reset
//   Full sequence:
//     1. Clear A fires → timer A created (gen=1)
//     2. Clear B fires → timer B created (gen=2); A's timer must be CANCELLED
//     3. A's fetch settles (stale) → stale guard fires → returns without
//        touching B's timer, B's abort controller, or the gate
//     4. Assert B's timer still armed, B's reset not aborted, gate still owned
//     5. B settles → gate released, B's timer cleared, thread_id committed
// ---------------------------------------------------------------------------
test('overlapping_clear_stale_settle_does_not_clear_or_abort_newer_reset', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  let resolveA;
  let resolveB;
  let fetchCallCount = 0;

  env.window.fetch = function (url, opts) {
    if (url && url.includes('reset-session')) {
      fetchCallCount += 1;
      if (fetchCallCount === 1) {
        return new Promise(function (resolve) {
          resolveA = resolve;
        });
      }
      return new Promise(function (resolve) {
        resolveB = resolve;
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  // Intercept setTimeout/clearTimeout to track timer lifetimes.
  const timerMap = {}; // id -> { cb, cleared }
  let timerIdSeq = 100;
  const origSetTimeout = env.window.setTimeout;
  const origClearTimeout = env.window.clearTimeout;
  env.window.setTimeout = function (cb, delay) {
    const id = timerIdSeq++;
    timerMap[id] = { cb, cleared: false, delay };
    return id;
  };
  env.window.clearTimeout = function (id) {
    if (timerMap[id]) {
      timerMap[id].cleared = true;
      timerMap[id].cb = null;
    }
  };

  try {
    // Step 1: Clear A fires (gen will become 1, timerA created).
    ctrl.clearConversation();
    await Promise.resolve();

    const timerIds = Object.keys(timerMap).map(Number);
    assert.equal(timerIds.length, 1, 'One timer after Clear A');
    const timerAId = timerIds[0];

    // Step 2: Clear B fires (gen becomes 2, timerA must be cleared, timerB created).
    ctrl.clearConversation();
    await Promise.resolve();

    // Timer A must be cleared (generation-owned: new Clear cancels prior timer).
    assert.equal(
      timerMap[timerAId].cleared,
      true,
      'Clear B must cancel (clearTimeout) timer A',
    );

    // Timer B must be armed.
    const allTimerIds = Object.keys(timerMap).map(Number);
    const timerBId = allTimerIds.find((id) => id !== timerAId);
    assert.ok(timerBId !== undefined, 'Timer B must have been created');
    assert.equal(
      timerMap[timerBId].cleared,
      false,
      'Timer B must NOT be cleared before A settles',
    );

    // Step 3: Settle A's fetch (stale — gen is now 2, A is gen 1).
    resolveA({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true, thread_id: 'thread-A' }),
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // Step 4: Assertions after stale A settles.
    assert.equal(
      timerMap[timerBId].cleared,
      false,
      "Stale A's settle must NOT clear B's timer",
    );
    assert.equal(
      ctrl.resetting,
      true,
      'Gate must still be owned by B after stale A settles',
    );
    const configAfterA = env.window.drupalSettings.ai_deepchat;
    assert.notEqual(
      configAfterA.thread_id,
      'thread-A',
      "Stale A must NOT commit thread-A's thread_id",
    );

    // Check that A's settle announced zero times (stale guard returns silently).
    const clearedCountAfterA = announcements.filter(
      (m) => m === 'Conversation cleared.',
    ).length;
    assert.equal(clearedCountAfterA, 0, 'Stale A must not announce anything');

    // Step 5: Settle B.
    resolveB({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true, thread_id: 'thread-B' }),
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // After B settles, gate released, B's timer cleared.
    assert.equal(
      ctrl.resetting,
      false,
      'resetting must be false after B settles',
    );
    assert.equal(
      timerMap[timerBId].cleared,
      true,
      "B's timer must be cleared when B settles",
    );
    const configAfterB = env.window.drupalSettings.ai_deepchat;
    assert.equal(
      configAfterB.thread_id,
      'thread-B',
      "B's thread_id must be committed after B settles",
    );

    // Exactly one 'Conversation cleared.' from B.
    const finalClearedCount = announcements.filter(
      (m) => m === 'Conversation cleared.',
    ).length;
    assert.equal(
      finalClearedCount,
      1,
      `Exactly one 'Conversation cleared.' from B; got ${finalClearedCount}`,
    );
  } finally {
    env.window.setTimeout = origSetTimeout;
    env.window.clearTimeout = origClearTimeout;
  }
});

// ---------------------------------------------------------------------------
// rc2-6. chip_click_blocked_during_reset
//   While resetting=true, a chip click must NOT change input.value, must NOT
//   call onSubmit, must NOT setState to open.
// ---------------------------------------------------------------------------
test('chip_click_blocked_during_reset', async () => {
  const env = buildEnv();
  const root = env.buildRoot({ withChips: true });
  const ctrl = new env.AsuSparkles.Controller(root);

  // Stub fetch so the reset never resolves (gate stays open).
  env.window.fetch = function () {
    return new Promise(() => {});
  };

  // Stub onSubmit to detect if it's called.
  let onSubmitCalled = false;
  ctrl.onSubmit = function () {
    onSubmitCalled = true;
  };

  // Start a clear — sets resetting=true.
  ctrl.clearConversation();
  await Promise.resolve();

  assert.equal(
    ctrl.resetting,
    true,
    'resetting must be true before chip click',
  );

  // Simulate a chip click while resetting.
  const chip = ctrl.chips[0];
  assert.ok(chip, 'Chip must exist in the DOM');

  const inputBefore = ctrl.input ? ctrl.input.value : '';
  chip.click();
  await Promise.resolve();

  // Input value must not change during reset.
  if (ctrl.input) {
    assert.equal(
      ctrl.input.value,
      inputBefore,
      'input.value must NOT change during reset (chip click must be blocked)',
    );
  }
  assert.ok(
    !onSubmitCalled,
    'onSubmit must NOT be called during reset (chip click must be blocked)',
  );
});

// ---------------------------------------------------------------------------
// REVIEW-FIX CYCLE 3 — Iter 12 — RED tests for the two new P1 edges
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// rc3-1. reset_timeout_then_late_success_body_stays_failure  [RED]
//
// Scenario: headers arrive (ok=true), body (.json()) is still being read.
// The reset timer fires (timeout): sets _resetTimedOutGen, aborts the
// controller, and calls _finishReset(gen, 'failure') — settles as FAILURE.
// THEN, after the timeout has already settled the generation, the body
// promise resolves with { success: true, thread_id: 'late-thread' }.
// The json() mock does NOT listen to the abort signal, simulating a body
// that was already buffered before the abort propagated.
//
// Required outcome (P1-1 fix):
//   - timeout path terminally settled the generation as FAILURE
//   - the late .then(data) path is a no-op (ONCE guard blocks it)
//   - resetting === false  (released by timeout _finishReset)
//   - config.thread_id !== 'late-thread'  (old thread kept)
//   - announce called EXACTLY ONCE with the failure message (from timeout)
//   - announce NEVER called with 'Conversation cleared.'
// ---------------------------------------------------------------------------
test('reset_timeout_then_late_success_body_stays_failure', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const oldThreadId = env.window.drupalSettings.ai_deepchat.thread_id;
  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  // Two-stage fetch:
  //   - headers arrive immediately (ok=true)
  //   - json() is a deferred promise with an external resolver
  //   - json() does NOT listen to the abort signal (body was already buffered)
  //   This means the timeout callback fires BEFORE the body settles,
  //   and then resolveJsonBody() resolves it AFTER the timeout.
  let resolveJsonBody;
  env.window.fetch = function (url) {
    if (url && url.includes('reset-session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        // json() does NOT reject on abort — simulates a body already buffered.
        json: () =>
          new Promise(function (resolve) {
            resolveJsonBody = resolve;
            // No abort listener — the body resolves independently of the signal.
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  // Intercept setTimeout/clearTimeout so we control when the timeout fires.
  let capturedTimerCb = null;
  const origSetTimeout = env.window.setTimeout;
  const origClearTimeout = env.window.clearTimeout;
  env.window.setTimeout = function (cb) {
    capturedTimerCb = cb;
    return 5555;
  };
  env.window.clearTimeout = function (id) {
    if (id === 5555) capturedTimerCb = null;
  };

  try {
    ctrl.clearConversation();
    // Drain microtasks — headers arrive (first .then), json() body still pending.
    for (let i = 0; i < 8; i++) await Promise.resolve();

    assert.ok(capturedTimerCb !== null, 'Timer must be armed after clear');
    assert.equal(ctrl.resetting, true, 'resetting must be true before timeout');

    // Fire the timeout — must: set _resetTimedOutGen, abort, settle as failure.
    // With the ONCE guard (_finishReset), this terminally settles the generation.
    capturedTimerCb();
    // Drain timeout callback microtasks.
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // Gate must be released by the timeout path.
    assert.equal(
      ctrl.resetting,
      false,
      'resetting must be false after timeout fires',
    );

    // NOW the late body resolves with success — simulates P1-1.
    // With the ONCE guard in _finishReset, this .then(data) call is a no-op.
    // Without the fix, it would enter the success branch and commit the thread.
    assert.ok(
      resolveJsonBody !== undefined,
      'resolveJsonBody must have been captured',
    );
    resolveJsonBody({ success: true, thread_id: 'late-thread' });
    for (let i = 0; i < 20; i++) await Promise.resolve();

    // Outcome assertions — the ONCE guard must have blocked the late success.
    const config = env.window.drupalSettings.ai_deepchat;
    assert.notEqual(
      config.thread_id,
      'late-thread',
      "Late success body must NOT commit 'late-thread' after timeout already settled the generation",
    );
    assert.equal(
      config.thread_id,
      oldThreadId,
      `Old thread_id must be kept; got ${config.thread_id}`,
    );

    const clearedCount = announcements.filter(
      (m) => m === 'Conversation cleared.',
    ).length;
    assert.equal(
      clearedCount,
      0,
      `'Conversation cleared.' must NEVER be announced; got ${clearedCount}`,
    );

    const failureCount = announcements.filter(
      (m) => m === 'The conversation could not be reset. Please try again.',
    ).length;
    assert.equal(
      failureCount,
      1,
      `Failure must be announced exactly once (by timeout path); got ${failureCount}`,
    );
  } finally {
    env.window.setTimeout = origSetTimeout;
    env.window.clearTimeout = origClearTimeout;
  }
});

// ---------------------------------------------------------------------------
// rc3-2. reset_current_gen_abort_releases_and_announces_failure  [RED]
//
// Scenario: the current-generation reset controller is aborted externally —
// NOT stale (generation matches), NOT a detach teardown (_detaching is false),
// NOT a self-timeout (no timeout marker set).
//
// Required outcome (P1-2 fix):
//   - resetting === false  (gate released)
//   - input.disabled === false, sendBtn.disabled === false  (controls re-enabled)
//   - announce called EXACTLY ONCE with 'The conversation could not be reset. Please try again.'
//   - announce NEVER called with 'Conversation cleared.'
// ---------------------------------------------------------------------------
test('reset_current_gen_abort_releases_and_announces_failure', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  // Never-resolving fetch that honours the abort signal.
  env.window.fetch = function (url, opts) {
    if (url && url.includes('reset-session')) {
      return new Promise(function (resolve, reject) {
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', function () {
            const err = new env.window.DOMException(
              'The user aborted a request.',
              'AbortError',
            );
            reject(err);
          });
        }
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  // Start a reset.
  ctrl.clearConversation();
  // Drain microtasks so the fetch is in flight and resetting=true.
  for (let i = 0; i < 5; i++) await Promise.resolve();

  assert.equal(ctrl.resetting, true, 'resetting must be true before abort');
  assert.ok(
    ctrl._resetAbortController !== null,
    '_resetAbortController must exist',
  );

  // Abort the current-generation controller directly —
  // NOT via clearConversation (not stale), NOT via detach (_detaching is false),
  // NOT via the timeout (no _resetTimedOutGen marker set).
  const capturedController = ctrl._resetAbortController;
  // Verify this is genuinely the current-gen controller, not a timeout-owned abort.
  assert.equal(
    ctrl._resetTimedOutGen,
    null,
    '_resetTimedOutGen must be null (not a timeout abort)',
  );
  assert.ok(!ctrl._detaching, '_detaching must be falsy (not a detach abort)');

  capturedController.abort();
  // Drain the AbortError propagation.
  for (let i = 0; i < 20; i++) await Promise.resolve();

  // Gate must be released.
  assert.equal(
    ctrl.resetting,
    false,
    'resetting must be false after current-gen abort (P1-2 fix: must release, not lock)',
  );

  // Controls must be re-enabled.
  if (ctrl.input) {
    assert.equal(
      ctrl.input.disabled,
      false,
      'input must be re-enabled after current-gen abort',
    );
  }
  if (ctrl.sendBtn) {
    assert.equal(
      ctrl.sendBtn.disabled,
      false,
      'sendBtn must be re-enabled after current-gen abort',
    );
  }

  // Failure announced exactly once.
  const failureCount = announcements.filter(
    (m) => m === 'The conversation could not be reset. Please try again.',
  ).length;
  assert.equal(
    failureCount,
    1,
    `Failure must be announced exactly once on current-gen abort; got ${failureCount}`,
  );

  // 'Conversation cleared.' must never be announced.
  const clearedCount = announcements.filter(
    (m) => m === 'Conversation cleared.',
  ).length;
  assert.equal(
    clearedCount,
    0,
    `'Conversation cleared.' must NEVER be announced on abort; got ${clearedCount}`,
  );
});

// ---------------------------------------------------------------------------
// rc3-3. reset_detach_abort_stays_silent  [confirm existing behavior]
//
// Scenario: detach teardown sets _detaching=true and aborts the controller.
// The resulting AbortError must be SILENT — no announce, no gate mutation.
// (This test confirms the existing detach behavior is preserved by the fix.)
// ---------------------------------------------------------------------------
test('reset_detach_abort_stays_silent', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const announcements = [];
  ctrl.announce = function (msg) {
    announcements.push(msg);
  };

  // Never-resolving fetch that honours the abort signal.
  env.window.fetch = function (url, opts) {
    if (url && url.includes('reset-session')) {
      return new Promise(function (resolve, reject) {
        if (opts && opts.signal) {
          opts.signal.addEventListener('abort', function () {
            const err = new env.window.DOMException(
              'The user aborted a request.',
              'AbortError',
            );
            reject(err);
          });
        }
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  // Start a reset.
  ctrl.clearConversation();
  for (let i = 0; i < 5; i++) await Promise.resolve();

  assert.equal(
    ctrl.resetting,
    true,
    'resetting must be true before detach abort',
  );

  // Simulate detach teardown: set _detaching flag then abort.
  ctrl._detaching = true;
  ctrl._resetAbortController.abort();
  for (let i = 0; i < 20; i++) await Promise.resolve();

  // Gate must NOT be released (widget is being torn down; no need to announce).
  // The key invariant: NO announce, widget is detaching.
  assert.equal(
    announcements.length,
    0,
    `Detach abort must be SILENT — no announce; got ${announcements.length} announcement(s)`,
  );
  // resetting may be true or false (widget is detaching anyway), but no announce.
});
