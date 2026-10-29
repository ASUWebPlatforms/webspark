/* eslint-disable no-await-in-loop, import/no-extraneous-dependencies */
/**
 * @file
 * CSRF-retry unit tests — §23.6.e (3 cases).
 *
 * node --test csrf-retry.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv } = require('./helpers/jsdom-env');

/**
 * Creates a fetch mock that returns the given sequence of status codes.
 * The first call is the session/token fetch; subsequent calls are the
 * postMessage chain. This helper returns a tuple
 * [fetchMock, getCallCount] where getCallCount returns the number of
 * postMessage-level fetch calls (excluding the session call).
 *
 * @param {object} win - jsdom window
 * @param {number[]} statuses - status codes to return for /api/deepchat calls
 * @return {{ getCallCount: () => number }}
 */
function installCsrfFetchMock(win, statuses) {
  let deepchatCalls = 0;

  win.fetch = function (url, opts) {
    if (url && url.includes('deepchat/session')) {
      // Token fetch always succeeds.
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: () => Promise.resolve('session-token'),
        json: () => Promise.resolve({ token: 'session-token' }),
      });
    }

    // /api/deepchat calls.
    const status =
      statuses[deepchatCalls] !== undefined ? statuses[deepchatCalls] : 200;
    deepchatCalls++;

    if (status === 403) {
      return Promise.resolve({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ error: 'csrf' }),
      });
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () =>
        Promise.resolve({ html: '<p>ok</p>', should_continue: false }),
    });
  };

  return { getCallCount: () => deepchatCalls };
}

// ---------------------------------------------------------------------------
// 1. csrf_one_shot_retry_200_after_403
//    Mock [403, 200]; assert fetch call count = 2, success response returned.
// ---------------------------------------------------------------------------
test('csrf_one_shot_retry_200_after_403', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const { getCallCount } = installCsrfFetchMock(env.window, [403, 200]);

  // Clear cached token to force the token-fetch path.
  env.window.Drupal.AsuSparkles.csrfToken = null;

  // Override replaceTyping + setBusy to capture the final response path.
  let gotHtmlContent = null;
  let busyFalseCount = 0;
  ctrl.replaceTyping = function (bubble, content, isError) {
    if (!isError && content) {
      gotHtmlContent = content;
    }
    if (bubble) bubble.textContent = content;
  };
  ctrl.setBusy = function (busy) {
    if (!busy) busyFalseCount++;
    ctrl.busy = !!busy;
  };

  ctrl.sendToBackend('hello');
  for (let i = 0; i < 30; i++) await Promise.resolve();

  assert.equal(
    getCallCount(),
    2,
    `Expected 2 deepchat calls; got ${getCallCount()}`,
  );
  assert.ok(
    gotHtmlContent !== null,
    `Expected success response html to be set`,
  );
});

// ---------------------------------------------------------------------------
// 2. csrf_stops_after_second_403
//    Mock [403, 403]; assert fetch call count = 2, csrfToken === null,
//    generic error bubble rendered, no third attempt.
// ---------------------------------------------------------------------------
test('csrf_stops_after_second_403', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const { getCallCount } = installCsrfFetchMock(env.window, [403, 403]);
  env.window.Drupal.AsuSparkles.csrfToken = null;

  let errorBubbleRendered = false;
  ctrl.replaceTyping = function (bubble, content, isError) {
    if (isError) errorBubbleRendered = true;
    if (bubble) bubble.textContent = content;
  };

  let setBusyFalseCalled = false;
  ctrl.setBusy = function (busy) {
    if (!busy) setBusyFalseCalled = true;
    ctrl.busy = !!busy;
  };

  ctrl.sendToBackend('hello');
  for (let i = 0; i < 30; i++) await Promise.resolve();

  assert.equal(
    getCallCount(),
    2,
    `Expected 2 deepchat calls; got ${getCallCount()}`,
  );
  assert.equal(
    env.window.Drupal.AsuSparkles.csrfToken,
    null,
    'csrfToken must be null after double 403',
  );
  assert.ok(
    errorBubbleRendered,
    'Generic error bubble must be rendered after double 403',
  );
});

// ---------------------------------------------------------------------------
// 3. csrf_no_retry_on_200
//    Mock [200]; fetch call count = 1.
// ---------------------------------------------------------------------------
test('csrf_no_retry_on_200', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  const { getCallCount } = installCsrfFetchMock(env.window, [200]);
  env.window.Drupal.AsuSparkles.csrfToken = null;

  ctrl.handleResponse = function (config, response) {
    ctrl.setBusy(false);
  };

  ctrl.sendToBackend('hello');
  for (let i = 0; i < 20; i++) await Promise.resolve();

  assert.equal(
    getCallCount(),
    1,
    `Expected 1 deepchat call; got ${getCallCount()}`,
  );
});
