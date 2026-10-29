/* eslint-disable no-script-url, global-require, import/no-extraneous-dependencies */
/**
 * @file
 * Copy-button history regression tests — RED-first (TDD §copy-button-history).
 *
 * Tests:
 *   1. history_replay_strips_contrib_copy_button
 *      Asserts the real contrib markup is fully stripped on the renderMessage
 *      path and exactly one owned button.asu-sparkles__copy appears.
 *
 *   2. stripContribButtonsFromString_is_inert
 *      Asserts that DOMParser.parseFromString() does NOT fire onerror
 *      handlers when stripping — DOMParser inertness guarantee.
 *
 *   3. history_replay_xss_still_blocked
 *      Regression: XSS payloads still neutralized through the full
 *      renderMessage pipeline (strip-before-sanitize must not open a hole).
 *
 *   4. history_replay_preserves_benign_markdown
 *      Benign markdown elements (<p>,<strong>,<a href=https>,<ul>/<li>,
 *      <pre>/<code>,<img src=https>) survive the pipeline.
 *
 * node --test tests/js/copy-button-history.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv } = require('./helpers/jsdom-env');

// ---------------------------------------------------------------------------
// Helper: build a Controller with the test DOM and return {ctrl, bubble}.
// Mirrors the seedFirstMessage call-path: renderMessage(role, html, true)
// followed by addCopyButton(bubble) — exactly what history replay does.
// ---------------------------------------------------------------------------
function renderHistoryBubble(html, role) {
  role = role || 'assistant';
  const { AsuSparkles, buildRoot } = buildEnv();
  const root = buildRoot();
  const ctrl = new AsuSparkles.Controller(root);
  const bubble = ctrl.renderMessage(role, html, /* isHtml= */ true);
  if (role === 'assistant') {
    ctrl.addCopyButton(bubble);
  }
  return { bubble, ctrl };
}

// ---------------------------------------------------------------------------
// Test 1 — history_replay_strips_contrib_copy_button (RED: fails before fix)
// ---------------------------------------------------------------------------
test('history_replay_strips_contrib_copy_button', () => {
  const contribHtml =
    '<p>ASU answer.</p>' +
    '<div class="chat-buttons">' +
    '<img class="chat-button copy" src="/modules/contrib/ai/modules/ai_chatbot/assets/copy-icon.svg" ' +
    'alt="Copy message" title="Copy message">' +
    '</div>';

  const { bubble } = renderHistoryBubble(contribHtml);

  // 1a. No <img> pointing at the contrib copy-icon.svg
  const imgs = Array.from(bubble.querySelectorAll('img'));
  const contribImgs = imgs.filter((img) =>
    (img.getAttribute('src') || '').includes('copy-icon'),
  );
  assert.strictEqual(
    contribImgs.length,
    0,
    `Expected 0 contrib copy-icon imgs; found ${contribImgs.length}. ` +
      `bubble.innerHTML = ${bubble.innerHTML}`,
  );

  // 1b. No element with a class containing 'chat-button'
  const chatBtnEls = bubble.querySelectorAll('[class*="chat-button"]');
  assert.strictEqual(
    chatBtnEls.length,
    0,
    `Expected 0 .chat-button elements; found ${chatBtnEls.length}. ` +
      `bubble.innerHTML = ${bubble.innerHTML}`,
  );

  // 1c. Exactly ONE owned sparkles copy button
  const ownedBtns = bubble.querySelectorAll('button.asu-sparkles__copy');
  assert.strictEqual(
    ownedBtns.length,
    1,
    `Expected exactly 1 button.asu-sparkles__copy; found ${ownedBtns.length}. ` +
      `bubble.innerHTML = ${bubble.innerHTML}`,
  );

  // 1d. The answer text is preserved
  assert.ok(
    bubble.textContent.includes('ASU answer'),
    `Expected "ASU answer." in bubble text; got: ${bubble.textContent}`,
  );
});

// ---------------------------------------------------------------------------
// Test 2 — stripContribButtonsFromString_is_inert (RED: fails before fix)
// DOMParser.parseFromString MUST NOT fire event handlers.
// ---------------------------------------------------------------------------
test('stripContribButtonsFromString_is_inert', () => {
  const { AsuSparkles, window: win } = buildEnv();

  // The helper must be exposed on _test for direct testing.
  const stripFn = AsuSparkles._test.stripContribButtonsFromString;
  assert.ok(
    typeof stripFn === 'function',
    'AsuSparkles._test.stripContribButtonsFromString must be a function',
  );

  // Plant a sentinel that would fire if onerror executed.
  win.__inertTestFired = false;
  const maliciousHtml =
    '<p>text</p>' +
    '<div class="chat-buttons">' +
    '<img class="chat-button copy" src="x" ' +
    'onerror="window.__inertTestFired=true">' +
    '</div>';

  const result = stripFn(maliciousHtml);

  // The onerror handler must NOT have run.
  assert.strictEqual(
    win.__inertTestFired,
    false,
    'DOMParser must be inert — onerror fired during stripContribButtonsFromString',
  );

  // The contrib button node must have been stripped.
  assert.ok(
    !result.includes('chat-button'),
    `chat-button class must be stripped from result; got: ${result}`,
  );
});

// ---------------------------------------------------------------------------
// Test 3 — history_replay_xss_still_blocked (regression: pipeline must not
// open a XSS hole). Tests the full renderMessage path.
// ---------------------------------------------------------------------------
test('history_replay_xss_still_blocked', () => {
  // Payloads embedded inside contrib-looking html to ensure
  // strip-before-sanitize does not accidentally allow XSS through.
  const xssPayloads = [
    // img onerror
    '<p>safe</p><img src="x" onerror="window.__xss1=1"><div class="chat-buttons"><img class="chat-button copy" src="copy-icon.svg"></div>',
    // javascript: href
    '<p>safe</p><a href="javascript:window.__xss2=1">click</a><div class="chat-buttons"><img class="chat-button copy" src="copy-icon.svg"></div>',
    // script tag
    '<p>safe</p><script>window.__xss3=1</script><div class="chat-buttons"><img class="chat-button copy" src="copy-icon.svg"></div>',
  ];

  xssPayloads.forEach(function checkXssPayload(html, i) {
    const { bubble } = renderHistoryBubble(html);

    // onerror / script must not have fired (jsdom would set globals if they did)
    // We can't easily check window globals from here without coupling to the
    // env, so assert on the DOM output instead.
    assert.ok(
      !bubble.innerHTML.includes('onerror'),
      `XSS payload ${i}: onerror survived in innerHTML: ${bubble.innerHTML}`,
    );
    assert.ok(
      !bubble.innerHTML.toLowerCase().includes('<script'),
      `XSS payload ${i}: <script> survived in innerHTML: ${bubble.innerHTML}`,
    );
    assert.ok(
      !bubble.innerHTML.includes('javascript:'),
      `XSS payload ${i}: javascript: survived in innerHTML: ${bubble.innerHTML}`,
    );
    // Contrib copy icon must also be gone
    assert.ok(
      !bubble.innerHTML.includes('copy-icon'),
      `XSS payload ${i}: contrib copy-icon survived in innerHTML: ${bubble.innerHTML}`,
    );
    // Safe text preserved
    assert.ok(
      bubble.textContent.includes('safe'),
      `XSS payload ${i}: safe text lost. textContent: ${bubble.textContent}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4 — history_replay_preserves_benign_markdown
// Benign markup must survive the strip-before-sanitize pipeline.
// ---------------------------------------------------------------------------
test('history_replay_preserves_benign_markdown', () => {
  const benignHtml =
    '<p>Hello <strong>world</strong>.</p>' +
    '<a href="https://asu.edu">ASU</a>' +
    '<ul><li>item one</li><li>item two</li></ul>' +
    '<pre><code>const x = 1;</code></pre>' +
    '<img src="https://asu.edu/img/logo.png" alt="ASU logo">';

  const { bubble } = renderHistoryBubble(benignHtml);

  assert.ok(
    bubble.innerHTML.includes('<p>') || bubble.innerHTML.includes('<p '),
    `<p> must survive; innerHTML: ${bubble.innerHTML}`,
  );
  assert.ok(
    bubble.innerHTML.includes('<strong>'),
    `<strong> must survive; innerHTML: ${bubble.innerHTML}`,
  );
  assert.ok(
    bubble.innerHTML.includes('https://asu.edu'),
    `https link must survive; innerHTML: ${bubble.innerHTML}`,
  );
  assert.ok(
    bubble.innerHTML.includes('<ul>'),
    `<ul> must survive; innerHTML: ${bubble.innerHTML}`,
  );
  assert.ok(
    bubble.innerHTML.includes('<li>'),
    `<li> must survive; innerHTML: ${bubble.innerHTML}`,
  );
  assert.ok(
    bubble.innerHTML.includes('<code>'),
    `<code> must survive; innerHTML: ${bubble.innerHTML}`,
  );
  assert.ok(
    bubble.innerHTML.includes('<img'),
    `<img> must survive; innerHTML: ${bubble.innerHTML}`,
  );
  assert.ok(
    bubble.innerHTML.includes('https://asu.edu/img/logo.png'),
    `img src must survive; innerHTML: ${bubble.innerHTML}`,
  );
});
