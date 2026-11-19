/* eslint-disable import/no-extraneous-dependencies */
/**
 * @file
 * jsdom environment bootstrap for asu-sparkles JS unit tests.
 *
 * Builds a minimal jsdom window, installs Drupal / drupalSettings / once
 * stubs, loads DOMPurify from the vendored CJS build, evals the IIFE, and
 * returns a env object the test files can call.
 *
 * Usage:
 *   const { buildEnv } = require('./helpers/jsdom-env');
 *   const env = buildEnv();   // fresh env per test (call inside each test)
 *   env.AsuSparkles._test.sanitizeHtml('<b>ok</b>');
 */

const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

// Absolute paths (resolved from this helper, so works from any cwd.
// __dirname = .../asufactory1/docroot/profiles/contrib/webspark/modules/asu_ai_chatbot_styles/tests/js/helpers
// MODULE_ROOT = 3 levels up  → .../asu_ai_chatbot_styles
// REPO_ROOT   = 9 levels up (helpers/js/tests/module/modules/webspark/contrib/profiles/docroot → asufactory1)
const MODULE_ROOT = path.resolve(__dirname, '../../..');
const REPO_ROOT = path.resolve(MODULE_ROOT, '../../../../../..');
const SPARKLES_JS = path.join(MODULE_ROOT, 'js/asu-sparkles.js');
const DOMPURIFY_CJS = path.resolve(
  REPO_ROOT,
  'docroot/libraries/dompurify/dist/purify.cjs.js',
);

/**
 * Builds a fresh jsdom environment with all stubs wired and the IIFE evaluated.
 *
 * @param {object} [overrides]
 *   Optional overrides merged into drupalSettings.ai_deepchat.
 * @return {{ window, document, AsuSparkles, buildRoot }}
 *   window / document from jsdom, plus the exposed Drupal.AsuSparkles and a
 *   helper to build a minimal .asu-sparkles DOM subtree.
 */
function buildEnv(overrides) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://techtestai.asu.ddev.site/',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // --- Drupal stub -----------------------------------------------------------
  window.Drupal = {
    t: (s) => s,
    behaviors: {},
    Html: {
      getUniqueId: (base) => `${base}-${Math.random().toString(36).slice(2)}`,
    },
    AsuSparkles: null, // will be set by the IIFE
  };

  // --- drupalSettings stub ---------------------------------------------------
  window.drupalSettings = {
    path: { baseUrl: '/' },
    ai_deepchat: {
      assistant_id: 'test-assistant',
      thread_id: 'thread-0',
      stream: false,
      first_message: 'Hello!',
      messages: [],
      send_typed_text: false,
      preset_questions: [],
      datalayer_section: 'test',
      scroll_trigger: '',
      ...(overrides || {}),
    },
  };

  // --- once stub (Drupal once polyfill) -------------------------------------
  const _processed = new WeakMap();
  window.once = function (id, selector, ctx) {
    const context = ctx || window.document;
    const elements = context.querySelectorAll
      ? Array.from(context.querySelectorAll(selector))
      : [];
    return elements.filter((el) => {
      if (!_processed.has(el)) {
        _processed.set(el, new Set());
      }
      const ids = _processed.get(el);
      if (ids.has(id)) {
        return false;
      }
      ids.add(id);
      return true;
    });
  };
  window.once.remove = function () {
    return [];
  };

  // --- fetch stub (can be overridden per test) ------------------------------
  window.fetch = function () {
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () =>
        Promise.resolve({ html: '<p>ok</p>', should_continue: false }),
    });
  };

  // --- TextDecoder / TextEncoder polyfill (required by readSseStream) -------
  if (!window.TextDecoder) {
    window.TextDecoder = TextDecoder;
  }
  if (!window.TextEncoder) {
    window.TextEncoder = TextEncoder;
  }

  // --- DOMPurify: load from vendored UMD build into the jsdom window --------
  // eval the UMD build directly inside jsdom. The UMD wrapper assigns to
  // globalThis.DOMPurify (which is window in the jsdom context), so after
  // eval dom.window.DOMPurify is set.
  try {
    const DOMPURIFY_JS = DOMPURIFY_CJS.replace('purify.cjs.js', 'purify.js');
    const purifySource = fs.readFileSync(DOMPURIFY_JS, 'utf8');
    dom.window.eval(purifySource);
    // dom.window.DOMPurify is now either an instance or a factory.
    // If it's a factory (no .sanitize), instantiate it with the jsdom window.
    if (
      dom.window.DOMPurify &&
      typeof dom.window.DOMPurify === 'function' &&
      !dom.window.DOMPurify.sanitize
    ) {
      dom.window.DOMPurify = dom.window.DOMPurify(dom.window);
    }
  } catch (e) {
    // DOMPurify failed to load — the fallback scrubber tests will cover this.
    dom.window.DOMPurify = undefined;
  }

  // --- Eval the IIFE --------------------------------------------------------
  const source = fs.readFileSync(SPARKLES_JS, 'utf8');
  dom.window.eval(source);

  const { AsuSparkles } = dom.window.Drupal;

  /**
   * Builds a minimal .asu-sparkles DOM subtree for Controller construction.
   *
   * @param {object} [opts]
   *   Optional extras (e.g. { withChips: true }).
   * @return {HTMLElement}
   *   The root element (already in document.body).
   */
  function buildRoot(opts) {
    const root = dom.window.document.createElement('div');
    root.className = 'asu-sparkles';
    root.setAttribute('data-state', 'collapsed');
    root.setAttribute('aria-label', 'ASU AI Chatbot');

    // FAB
    const fab = dom.window.document.createElement('button');
    fab.className = 'asu-sparkles__fab';
    root.appendChild(fab);

    // Log
    const log = dom.window.document.createElement('div');
    log.className = 'asu-sparkles__log';
    log.setAttribute('role', 'log');
    root.appendChild(log);

    // Input row
    const inputRow = dom.window.document.createElement('div');
    inputRow.className = 'asu-sparkles__input-row';

    const input = dom.window.document.createElement('input');
    input.className = 'asu-sparkles__input';
    input.type = 'text';
    inputRow.appendChild(input);

    const sendBtn = dom.window.document.createElement('button');
    sendBtn.className = 'asu-sparkles__send';
    inputRow.appendChild(sendBtn);

    root.appendChild(inputRow);

    // Live region
    const live = dom.window.document.createElement('div');
    live.className = 'asu-sparkles__live';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    root.appendChild(live);

    // Clear button (hidden initially, as in the real template)
    const clearBtn = dom.window.document.createElement('button');
    clearBtn.className = 'asu-sparkles__clear';
    clearBtn.type = 'button';
    clearBtn.setAttribute('aria-label', 'Clear the conversation');
    clearBtn.hidden = true;
    root.appendChild(clearBtn);

    // Optional chips: add chip <button> elements inside the log
    if (opts && opts.withChips) {
      const chipsContainer = dom.window.document.createElement('div');
      chipsContainer.className = 'asu-sparkles__chips';
      const chip1 = dom.window.document.createElement('button');
      chip1.type = 'button';
      chip1.className = 'asu-sparkles__chip';
      chip1.setAttribute('data-question-text', 'What is ASU?');
      chip1.textContent = 'What is ASU?';
      const chip2 = dom.window.document.createElement('button');
      chip2.type = 'button';
      chip2.className = 'asu-sparkles__chip';
      chip2.setAttribute('data-question-text', 'How do I apply?');
      chip2.textContent = 'How do I apply?';
      chipsContainer.appendChild(chip1);
      chipsContainer.appendChild(chip2);
      log.appendChild(chipsContainer);
    }

    dom.window.document.body.appendChild(root);
    return root;
  }

  return {
    window: dom.window,
    document: dom.window.document,
    AsuSparkles,
    buildRoot,
  };
}

module.exports = { buildEnv };
