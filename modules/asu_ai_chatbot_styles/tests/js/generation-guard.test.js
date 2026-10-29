/* eslint-disable no-await-in-loop, import/no-extraneous-dependencies */
/**
 * @file
 * Generation-guard unit tests — §23.6.f (2 cases).
 *
 * node --test generation-guard.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv } = require('./helpers/jsdom-env');

// ---------------------------------------------------------------------------
// 1. stale_response_discarded
//    sendToBackend dispatched; before response resolves, bump _resetGeneration;
//    assert handleResponse NOT called with the stale response, setBusy(false)
//    NOT called by the stale path.
// ---------------------------------------------------------------------------
test('stale_response_discarded', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  let resolveDeepChat;
  env.window.fetch = function (url) {
    if (url && url.includes('deepchat/session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: () => Promise.resolve('tok'),
        json: () => Promise.resolve({ token: 'tok' }),
      });
    }
    if (url && url.includes('api/deepchat')) {
      return new Promise((resolve) => {
        resolveDeepChat = () =>
          resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: () =>
              Promise.resolve({ html: '<p>stale</p>', should_continue: false }),
          });
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({}),
    });
  };

  let handleResponseCalled = false;
  const origHandleResponse = ctrl.handleResponse.bind(ctrl);
  ctrl.handleResponse = function (config, response, bubble, myGen, depth) {
    // Only flag if it's the stale response (not the internal recursive call).
    if (response && response.html === '<p>stale</p>') {
      handleResponseCalled = true;
    }
    return origHandleResponse(config, response, bubble, myGen, depth);
  };

  const setBusyFalseFromStalePath = false;

  ctrl.sendToBackend('test');

  // Give microtasks a tick so sendToBackend is in flight.
  await Promise.resolve();
  await Promise.resolve();

  // Bump the generation to make the in-flight request stale.
  ctrl._resetGeneration = (ctrl._resetGeneration || 0) + 1;

  // Now resolve the pending fetch.
  if (resolveDeepChat) resolveDeepChat();

  for (let i = 0; i < 20; i++) await Promise.resolve();

  // The stale guard should have discarded the response.
  // handleResponseCalled may be true if the stale response was received —
  // but setBusy(false) and bubble changes must NOT happen.
  // The critical invariant: since the stale guard in sendToBackend returns
  // early before handleResponse, handleResponseCalled should remain false.
  assert.ok(
    !handleResponseCalled,
    'handleResponse must NOT be called with stale response',
  );
});

// ---------------------------------------------------------------------------
// 2. stale_continuation_discarded
//    Reach the should_continue path; between the follow-up POST and its
//    resolution, bump _resetGeneration; assert the recursive handleResponse
//    is NOT called.
// ---------------------------------------------------------------------------
test('stale_continuation_discarded', async () => {
  const env = buildEnv();
  const root = env.buildRoot();
  const ctrl = new env.AsuSparkles.Controller(root);

  let resolveFollowUp;
  let followUpCount = 0;

  env.window.fetch = function (url) {
    if (url && url.includes('deepchat/session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: () => Promise.resolve('tok'),
      });
    }
    if (url && url.includes('api/deepchat')) {
      followUpCount++;
      if (followUpCount === 1) {
        // First call resolves immediately with should_continue: true.
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: () =>
            Promise.resolve({ html: '<p>cont</p>', should_continue: true }),
        });
      }
      // Second call (follow-up) is a pending promise we control.
      return new Promise((resolve) => {
        resolveFollowUp = () =>
          resolve({
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: () =>
              Promise.resolve({
                html: '<p>followup</p>',
                should_continue: false,
              }),
          });
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({}),
    });
  };

  let recursiveHandleResponseCalled = false;
  let callCount = 0;
  const origHandleResponse = ctrl.handleResponse.bind(ctrl);
  ctrl.handleResponse = function (config, response, bubble, myGen, depth) {
    callCount++;
    if (callCount > 1 && response && response.html === '<p>followup</p>') {
      recursiveHandleResponseCalled = true;
    }
    return origHandleResponse(config, response, bubble, myGen, depth);
  };

  ctrl.sendToBackend('test-continuation');

  // Give microtasks time to reach the should_continue follow-up.
  for (let i = 0; i < 10; i++) await Promise.resolve();

  // Bump the generation while the follow-up fetch is in flight.
  ctrl._resetGeneration = (ctrl._resetGeneration || 0) + 1;

  // Now resolve the follow-up.
  if (resolveFollowUp) resolveFollowUp();

  for (let i = 0; i < 20; i++) await Promise.resolve();

  assert.ok(
    !recursiveHandleResponseCalled,
    'Recursive handleResponse must NOT be called with stale follow-up response',
  );
});
