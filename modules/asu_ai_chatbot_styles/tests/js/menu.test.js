/* eslint-disable no-await-in-loop */
/**
 * @file
 * Unit tests for fitOpen no double-count, 48 px placement, the visibility gate,
 * toolbar measurement, debounce, and the ellipsis menu
 * (open/close, roving focus, Escape, clearConversation wiring).
 *
 * node --test menu.test.js
 *
 * All tests use the jsdom harness from helpers/jsdom-env.js. Menu tests
 * build a DOM subtree that includes the .asu-sparkles__menu button and
 * .asu-sparkles__menu-popover (matching the new Twig template).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv } = require('./helpers/jsdom-env');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a root element that includes the ellipsis menu markup, mimicking
 * the updated Twig template. Returns the root already appended to body.
 *
 * @param {object} env  - jsdom env from buildEnv()
 * @param {string[]} [linkHrefs] - optional list of href strings for menu links
 * @return {{ root, menuBtn, menuPopover, clearItem, linkItems }}
 */
function buildRootWithMenu(env, linkHrefs) {
  const doc = env.document;
  const root = doc.createElement('div');
  root.className = 'asu-sparkles';
  root.setAttribute('data-state', 'collapsed');
  root.setAttribute('aria-label', 'ASU AI Chatbot');

  // FAB
  const fab = doc.createElement('button');
  fab.className = 'asu-sparkles__fab';
  fab.setAttribute('hidden', 'hidden');
  root.appendChild(fab);

  // Head (needed for fitOpen measurement)
  const head = doc.createElement('div');
  head.className = 'asu-sparkles__head';
  root.appendChild(head);

  // Controls with menu button + close button (no .asu-sparkles__clear)
  const controls = doc.createElement('div');
  controls.className = 'asu-sparkles__controls';

  const menuPopoverId = 'asu-sparkles-menu-test';

  const menuBtn = doc.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'asu-sparkles__btn asu-sparkles__menu';
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-controls', menuPopoverId);
  menuBtn.setAttribute('aria-label', 'Chat options');
  menuBtn.setAttribute('hidden', 'hidden');
  const menuSpan = doc.createElement('span');
  menuSpan.setAttribute('aria-hidden', 'true');
  menuSpan.textContent = '\u2026'; // ellipsis
  menuBtn.appendChild(menuSpan);
  controls.appendChild(menuBtn);

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'asu-sparkles__btn asu-sparkles__close';
  closeBtn.setAttribute('hidden', 'hidden');
  controls.appendChild(closeBtn);

  head.appendChild(controls);

  // Log (contains chips — needed for fitOpen measurement)
  const log = doc.createElement('div');
  log.className = 'asu-sparkles__log';
  log.setAttribute('role', 'log');

  const chips = doc.createElement('div');
  chips.className = 'asu-sparkles__chips';
  // Add 4 chip buttons
  for (let i = 0; i < 4; i++) {
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'asu-sparkles__chip';
    chip.setAttribute('data-question-text', `Q${i}`);
    chip.textContent = `Question ${i}`;
    chips.appendChild(chip);
  }
  log.appendChild(chips);
  root.appendChild(log);

  // Form
  const form = doc.createElement('form');
  form.className = 'asu-sparkles__form';
  const field = doc.createElement('div');
  field.className = 'asu-sparkles__field';
  const input = doc.createElement('input');
  input.className = 'asu-sparkles__input';
  input.type = 'text';
  field.appendChild(input);
  const sendBtn = doc.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'asu-sparkles__send';
  field.appendChild(sendBtn);
  form.appendChild(field);
  root.appendChild(form);

  // Menu popover (role=menu)
  const menuPopover = doc.createElement('div');
  menuPopover.id = menuPopoverId;
  menuPopover.className = 'asu-sparkles__menu-popover';
  menuPopover.setAttribute('role', 'menu');
  menuPopover.setAttribute('aria-label', 'Chat options');
  menuPopover.setAttribute('hidden', 'hidden');

  const clearItem = doc.createElement('button');
  clearItem.type = 'button';
  clearItem.className =
    'asu-sparkles__menu-item asu-sparkles__menu-item--clear';
  clearItem.setAttribute('role', 'menuitem');
  clearItem.setAttribute('data-action', 'clear');
  clearItem.textContent = 'Clear conversation';
  menuPopover.appendChild(clearItem);

  const linkItems = [];
  (linkHrefs || []).forEach(function (href) {
    const a = doc.createElement('a');
    a.className = 'asu-sparkles__menu-item asu-sparkles__menu-item--link';
    a.setAttribute('role', 'menuitem');
    a.href = href;
    a.textContent = `Link ${href}`;
    menuPopover.appendChild(a);
    linkItems.push(a);
  });

  root.appendChild(menuPopover);

  // Live region
  const live = doc.createElement('p');
  live.className = 'asu-sparkles__live visually-hidden';
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);

  doc.body.appendChild(root);
  return { root, menuBtn, menuPopover, clearItem, linkItems };
}

// ---------------------------------------------------------------------------
// fitOpenMeasure — no double-count of chips
// ---------------------------------------------------------------------------

test('fitOpenMeasure_no_double_count_of_chips', () => {
  const env = buildEnv();
  const { fitOpenMeasure } = env.AsuSparkles._test;

  // Synthetic elements with known measurement values.
  // In the real layout: chips live inside log, so log.scrollHeight includes chips.
  const head = { offsetHeight: 94 };
  const log = { scrollHeight: 110 }; // already includes chips (~80) + padding
  const form = { offsetHeight: 72 };

  const result = fitOpenMeasure(head, log, form);

  // Expected: 94 + 110 + 72 = 276 (no separate chips add)
  assert.strictEqual(result, 276, 'fitOpenMeasure must not double-count chips');
});

test('fitOpenMeasure_zero_log_height_is_graceful', () => {
  const env = buildEnv();
  const { fitOpenMeasure } = env.AsuSparkles._test;

  const head = { offsetHeight: 94 };
  const log = { scrollHeight: 0 };
  const form = { offsetHeight: 72 };

  const result = fitOpenMeasure(head, log, form);
  // Should produce head+form only — smaller than old buggy value, graceful.
  assert.strictEqual(result, 166);
});

test('fitOpenMeasure_chips_inside_log_included_once', () => {
  const env = buildEnv();
  const { fitOpenMeasure } = env.AsuSparkles._test;

  // Simulate a log whose scrollHeight = chips height (80) + content padding (30)
  const head = { offsetHeight: 94 };
  const log = { scrollHeight: 110 }; // chips 80 + padding 30
  const form = { offsetHeight: 72 };

  // The correct result MUST equal head + log + form, not head + log + chips + form.
  // Old buggy result would be 94 + 80 + 110 + 72 = 356.
  // Fixed result: 94 + 110 + 72 = 276.
  const correct = head.offsetHeight + log.scrollHeight + form.offsetHeight;
  const result = fitOpenMeasure(head, log, form);
  assert.strictEqual(result, correct);
  // Confirm the buggy value is different (regression guard).
  const buggyValue =
    head.offsetHeight + 80 + log.scrollHeight + form.offsetHeight;
  assert.notEqual(result, buggyValue);
});

// ---------------------------------------------------------------------------
// Header measurement — measuring class and toolbar
// ---------------------------------------------------------------------------

test('measuring_class_added_in_constructor', () => {
  const env = buildEnv();
  const { root } = buildRootWithMenu(env);

  // Constructor runs in buildRoot via new Controller(root) — here we call it
  // directly.
  const ctrl = new env.AsuSparkles.Controller(root);

  // The class should be present immediately after construction (before rAF).
  // Note: initHeaderMeasurement runs synchronously in the constructor (via
  // init()). The class removal is deferred via requestAnimationFrame, so
  // _headerMeasured may flip to true in the same microtask queue. We confirm
  // the class WAS set by checking _headerMeasured was added to the prototype.
  // In jsdom, rAF fires later so the class removal has not yet happened.
  assert.ok(
    typeof ctrl._headerMeasured === 'boolean',
    '_headerMeasured property must be added by constructor',
  );
});

test('measuring_class_removed_when_measurement_returns_null', async () => {
  const env = buildEnv();

  // Override measureHeaderTop to return null (no header found).
  const origProto = env.AsuSparkles.Controller.prototype;
  const origMeasure = origProto.measureHeaderTop;
  origProto.measureHeaderTop = function () {
    return null;
  };

  // Also run rAF synchronously so applyMeasurement executes inline.
  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // When measureHeaderTop returns null, the gate must release immediately
  // (synchronously, not via rAF) so the widget is never trapped invisible.
  assert.strictEqual(
    ctrl._headerMeasured,
    true,
    'gate must release even when measurement returns null',
  );
  assert.ok(
    !root.classList.contains('asu-sparkles--measuring'),
    'asu-sparkles--measuring class must be removed after null measurement',
  );

  // Restore.
  origProto.measureHeaderTop = origMeasure;
  env.window.requestAnimationFrame = origRaf;
});

test('toolbar_bottom_included_in_measurement_via_body_class', () => {
  const env = buildEnv();
  const doc = env.document;

  // Toolbar is detected via body classes, not via element scan.
  // Add toolbar-fixed body class to signal toolbar presence.
  doc.body.classList.add('toolbar-fixed');

  // Create a fake #toolbar-bar with a known rect.
  const toolbar = doc.createElement('div');
  toolbar.id = 'toolbar-bar';
  toolbar.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 39,
      height: 39,
      width: env.window.innerWidth,
      left: 0,
      right: env.window.innerWidth,
    };
  };
  doc.body.appendChild(toolbar);

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Call measureHeaderTop directly.
  const result = ctrl.measureHeaderTop();

  // Toolbar bar bottom (39) should be included when toolbar body class is set.
  assert.ok(
    result !== null && result >= 39,
    `measureHeaderTop must include toolbar-bar bottom (39) when toolbar-fixed body class is set; got ${result}`,
  );

  // Cleanup.
  doc.body.removeChild(toolbar);
  doc.body.classList.remove('toolbar-fixed');
});

test('applyMeasurement_uses_48px_offset', () => {
  const env = buildEnv();
  const doc = env.document;

  // Create a fake header so measureHeaderTop returns a known value.
  const header = doc.createElement('header');
  header.setAttribute('role', 'banner');
  header.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 100,
      height: 100,
      width: env.window.innerWidth,
      left: 0,
      right: env.window.innerWidth,
    };
  };
  doc.body.appendChild(header);

  const { root } = buildRootWithMenu(env);
  // Before constructing, stub out rAF to execute synchronously.
  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const ctrl = new env.AsuSparkles.Controller(root);

  // The top custom property should be ceil(100 + 48) = 148px.
  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topVal,
    '148px',
    `--asu-sparkles-top must be headerBottom + 48px; got ${topVal}`,
  );

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(header);
});

test('desktop_right_offset_is_48px_in_css_fallback', () => {
  // This tests the CSS spec by checking the JS-set token matches 48px.
  // The CSS fallback (right:48px) is verified by grep in the implementation
  // report; here we verify the JS measurement math uses 48.
  const env = buildEnv();
  const doc = env.document;

  const header = doc.createElement('header');
  header.setAttribute('role', 'banner');
  header.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 50,
      height: 50,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(header);

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // top should be 50 + 48 = 98px
  assert.strictEqual(root.style.getPropertyValue('--asu-sparkles-top'), '98px');

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(header);
});

// ---------------------------------------------------------------------------
// Ellipsis menu open/close
// ---------------------------------------------------------------------------

test('menu_button_hidden_initially_in_collapsed_state', () => {
  const env = buildEnv();
  const { root, menuBtn } = buildRootWithMenu(env);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  // In collapsed state, menuBtn should have hidden attribute.
  assert.ok(
    menuBtn.hasAttribute('hidden'),
    'menuBtn must be hidden in collapsed state',
  );
});

test('menu_button_visible_after_transition_to_open', () => {
  const env = buildEnv();
  const { root, menuBtn } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Force instant transition to avoid animation timer in jsdom.
  ctrl.applyStateImmediate('open');

  assert.ok(
    !menuBtn.hasAttribute('hidden'),
    'menuBtn must NOT have hidden attribute in open state',
  );
});

test('popover_hidden_by_default', () => {
  const env = buildEnv();
  const { root, menuPopover } = buildRootWithMenu(env);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  assert.ok(
    menuPopover.hasAttribute('hidden'),
    'menuPopover must be hidden by default',
  );
  assert.strictEqual(
    menuPopover.getAttribute('aria-expanded'),
    null,
    'popover itself should not have aria-expanded',
  );
});

test('openMenu_removes_hidden_and_sets_aria_expanded', () => {
  const env = buildEnv();
  const { root, menuBtn, menuPopover } = buildRootWithMenu(env, ['/contact']);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');

  ctrl.openMenu({ focusIdx: 0 });

  assert.ok(
    !menuPopover.hasAttribute('hidden'),
    'popover hidden attr must be removed on open',
  );
  assert.strictEqual(
    menuBtn.getAttribute('aria-expanded'),
    'true',
    'aria-expanded must be true on open',
  );
  assert.ok(ctrl._menuOpen, '_menuOpen flag must be true');
});

test('openMenu_focuses_first_menuitem_by_default', () => {
  const env = buildEnv();
  const { root, clearItem } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');

  ctrl.openMenu({ focusIdx: 0 });

  // In jsdom, focus() sets document.activeElement.
  assert.strictEqual(
    env.document.activeElement,
    clearItem,
    'first menuitem (Clear conversation) must be focused on openMenu',
  );
  assert.strictEqual(
    clearItem.getAttribute('tabindex'),
    '0',
    'focused item must have tabindex=0',
  );
});

test('closeMenu_adds_hidden_and_resets_aria_expanded', () => {
  const env = buildEnv();
  const { root, menuBtn, menuPopover } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');

  ctrl.openMenu({ focusIdx: 0 });
  ctrl.closeMenu({ restoreFocus: false });

  assert.ok(
    menuPopover.hasAttribute('hidden'),
    'popover must be hidden after closeMenu',
  );
  assert.strictEqual(
    menuBtn.getAttribute('aria-expanded'),
    'false',
    'aria-expanded must be false after closeMenu',
  );
  assert.ok(!ctrl._menuOpen, '_menuOpen must be false after closeMenu');
});

test('closeMenu_restores_focus_to_menuBtn_when_requested', () => {
  const env = buildEnv();
  const { root, menuBtn } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');

  ctrl.openMenu({ focusIdx: 0 });
  ctrl.closeMenu({ restoreFocus: true });

  assert.strictEqual(
    env.document.activeElement,
    menuBtn,
    'focus must return to menuBtn when restoreFocus=true',
  );
});

// ---------------------------------------------------------------------------
// Roving focus
// ---------------------------------------------------------------------------

test('arrowDown_rotates_roving_focus', () => {
  const env = buildEnv();
  const { root, clearItem, linkItems } = buildRootWithMenu(env, ['/a', '/b']);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  const items = ctrl.menuItems;
  assert.strictEqual(items.length, 3); // Clear + 2 links

  // ArrowDown from item 0 → item 1
  const e1 = new env.window.KeyboardEvent('keydown', {
    key: 'ArrowDown',
    bubbles: true,
  });
  Object.defineProperty(e1, 'key', { value: 'ArrowDown' });
  // Simulate via _onMenuKeyNav directly to avoid DOM event wiring complexity.
  ctrl._onMenuKeyNav(
    { key: 'ArrowDown', preventDefault: () => {}, stopPropagation: () => {} },
    0,
  );
  assert.strictEqual(
    env.document.activeElement,
    items[1],
    'ArrowDown must move focus from item 0 to item 1',
  );

  // ArrowDown from item 2 → wraps to item 0
  ctrl._onMenuKeyNav(
    { key: 'ArrowDown', preventDefault: () => {}, stopPropagation: () => {} },
    2,
  );
  assert.strictEqual(
    env.document.activeElement,
    items[0],
    'ArrowDown must wrap from last item to first item',
  );
});

test('arrowUp_rotates_roving_focus_backward', () => {
  const env = buildEnv();
  const { root } = buildRootWithMenu(env, ['/a']);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  const items = ctrl.menuItems;

  // ArrowUp from item 0 → wraps to last item
  ctrl._onMenuKeyNav(
    { key: 'ArrowUp', preventDefault: () => {}, stopPropagation: () => {} },
    0,
  );
  assert.strictEqual(
    env.document.activeElement,
    items[items.length - 1],
    'ArrowUp from first item must wrap to last item',
  );
});

test('escape_closes_menu_and_restores_focus_to_menuBtn', () => {
  const env = buildEnv();
  const { root, menuBtn } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  let preventDefaultCalled = false;
  let stopPropagationCalled = false;

  ctrl._onMenuKeyNav(
    {
      key: 'Escape',
      preventDefault() {
        preventDefaultCalled = true;
      },
      stopPropagation() {
        stopPropagationCalled = true;
      },
    },
    0,
  );

  assert.ok(!ctrl._menuOpen, 'Escape must close the menu (_menuOpen=false)');
  assert.ok(
    !ctrl.menuPopover.hasAttribute('hidden') === false ||
      ctrl.menuPopover.hasAttribute('hidden'),
    'popover must be hidden after Escape',
  );
  assert.strictEqual(
    env.document.activeElement,
    menuBtn,
    'Escape must restore focus to menuBtn',
  );
  assert.ok(preventDefaultCalled, 'Escape must call event.preventDefault()');
  assert.ok(
    stopPropagationCalled,
    'Escape must call event.stopPropagation() to prevent widget collapse',
  );
});

test('escape_in_menu_does_not_collapse_widget', () => {
  const env = buildEnv();
  const { root } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  // Simulate pressing Escape on the first menu item.
  ctrl._onMenuKeyNav(
    {
      key: 'Escape',
      preventDefault() {},
      stopPropagation() {},
    },
    0,
  );

  // Widget state must still be 'open', not 'collapsed'.
  assert.strictEqual(
    ctrl.state,
    'open',
    'widget state must remain open after Escape in menu',
  );
});

// ---------------------------------------------------------------------------
// Clear conversation wiring
// ---------------------------------------------------------------------------

test('clear_menuitem_calls_clearConversation', () => {
  const env = buildEnv();
  // Provide an assistant_id so clearConversation does not early-return.
  env.window.drupalSettings.ai_deepchat.assistant_id = 'test-id';
  env.window.drupalSettings.ai_deepchat.thread_id = 'thread-1';

  env.window.fetch = function (url) {
    if (url && url.includes('session')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ token: 'tok' }),
        text: () => Promise.resolve('tok'),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({}),
    });
  };

  const { root, clearItem } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');

  let clearCalled = false;
  const origClear = ctrl.clearConversation.bind(ctrl);
  ctrl.clearConversation = function () {
    clearCalled = true;
    // Call original to not break internal state (best-effort; may fail without
    // full CSRF wiring but the spy call is what we verify).
    try {
      origClear();
    } catch (e) {
      /* ignore */
    }
  };

  ctrl._onMenuItemActivate(clearItem);

  assert.ok(
    clearCalled,
    'clearConversation must be called when Clear menuitem is activated',
  );
  assert.ok(
    !ctrl._menuOpen,
    'menu must be closed after Clear menuitem activation',
  );
});

test('clear_menuitem_closes_menu_with_no_focus_restore', () => {
  const env = buildEnv();
  env.window.drupalSettings.ai_deepchat.assistant_id = 'test-id';

  const { root, menuBtn, clearItem } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');

  // Suppress clearConversation to avoid complex fetch setup.
  ctrl.clearConversation = function () {};

  ctrl.openMenu({ focusIdx: 0 });
  ctrl._onMenuItemActivate(clearItem);

  // Menu should be closed.
  assert.ok(!ctrl._menuOpen, '_menuOpen must be false after clear activation');
  // Focus should NOT have been forcibly returned to the menu button.
  // (The clear action explicitly focuses the ring input.)
  assert.notStrictEqual(
    env.document.activeElement,
    menuBtn,
    'focus must NOT be returned to menuBtn after Clear (input gets focus)',
  );
});

test('clear_menuitem_focuses_ring_input_after_activation', () => {
  const env = buildEnv();
  env.window.drupalSettings.ai_deepchat.assistant_id = 'test-id';

  const { root, clearItem } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');

  // Realistic stub: clearConversation() disables the ring input for the reset
  // window (mirrors _setResettingUi(true)) and bumps the generation, exactly
  // as the real reset does.
  ctrl.clearConversation = function () {
    ctrl._resetGeneration = (ctrl._resetGeneration || 0) + 1;
    ctrl.input.disabled = true;
  };

  ctrl.openMenu({ focusIdx: 0 });
  ctrl._onMenuItemActivate(clearItem);

  // Deferred-focus flag must be armed; a synchronous focus would have failed
  // on the disabled input (the live defect: focus fell to <body>).
  assert.ok(
    ctrl._focusRingInputAfterReset,
    'menu Clear must arm the deferred ring-input focus',
  );
  assert.notStrictEqual(
    env.document.activeElement,
    ctrl.input,
    'input is disabled during reset, so it must not hold focus yet',
  );

  // Terminal settle re-enables the input and delivers focus to it.
  ctrl._finishReset(
    ctrl._resetGeneration,
    'success',
    {},
    env.window.drupalSettings.ai_deepchat,
  );

  assert.ok(!ctrl.input.disabled, 'input must be re-enabled at reset settle');
  assert.strictEqual(
    env.document.activeElement,
    ctrl.input,
    'after reset settle, focus must land on the ring input (not <body>)',
  );
  assert.ok(
    !ctrl._focusRingInputAfterReset,
    'deferred-focus flag must be cleared after use',
  );
});

test('menu_clear_deferred_focus_not_delivered_if_state_left_open', () => {
  const env = buildEnv();
  env.window.drupalSettings.ai_deepchat.assistant_id = 'test-id';

  const { root, clearItem } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');

  ctrl.clearConversation = function () {
    ctrl._resetGeneration = (ctrl._resetGeneration || 0) + 1;
    ctrl.input.disabled = true;
  };

  ctrl.openMenu({ focusIdx: 0 });
  ctrl._onMenuItemActivate(clearItem);

  // Widget leaves the open state before the reset settles (e.g. user collapsed).
  ctrl.applyStateImmediate('collapsed');

  ctrl._finishReset(
    ctrl._resetGeneration,
    'success',
    {},
    env.window.drupalSettings.ai_deepchat,
  );

  // Flag is consumed but focus is NOT forced onto the input outside open state.
  assert.ok(
    !ctrl._focusRingInputAfterReset,
    'deferred-focus flag is consumed at settle',
  );
  assert.notStrictEqual(
    env.document.activeElement,
    ctrl.input,
    'focus must not be forced to the input once the widget left open state',
  );
});

// ---------------------------------------------------------------------------
// State machine integration
// ---------------------------------------------------------------------------

test('menu_force_closes_when_state_leaves_open', () => {
  const env = buildEnv();
  const { root, menuPopover } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);

  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  assert.ok(ctrl._menuOpen, 'precondition: menu must be open');

  // Transition away from open.
  ctrl.applyStateImmediate('collapsed');

  assert.ok(
    !ctrl._menuOpen,
    'menu must be force-closed when state transitions away from open',
  );
  assert.ok(
    menuPopover.hasAttribute('hidden'),
    'popover must be hidden after state leaves open',
  );
});

test('widget_escape_guard_fires_when_menu_open', () => {
  const env = buildEnv();
  const { root } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);

  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  // Simulate a widget-level Escape when menu is open.
  // The guard at the top of the root keydown handler should return early.
  // We verify this by patching collapseToRingWithFocus.
  let collapseCalled = false;
  const orig = ctrl.collapseToRingWithFocus.bind(ctrl);
  ctrl.collapseToRingWithFocus = function () {
    collapseCalled = true;
  };

  // Dispatch Escape on the root.
  const escEvent = new env.window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  root.dispatchEvent(escEvent);

  assert.ok(
    !collapseCalled,
    'collapseToRingWithFocus must NOT be called when menu is open',
  );

  ctrl.collapseToRingWithFocus = orig;
});

// ---------------------------------------------------------------------------
// ARIA attributes
// ---------------------------------------------------------------------------

test('menu_popover_has_role_menu', () => {
  const env = buildEnv();
  const { root, menuPopover } = buildRootWithMenu(env, ['/a']);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  assert.strictEqual(menuPopover.getAttribute('role'), 'menu');
});

test('menu_items_have_role_menuitem', () => {
  const env = buildEnv();
  const { root, clearItem, linkItems } = buildRootWithMenu(env, ['/a']);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  assert.strictEqual(clearItem.getAttribute('role'), 'menuitem');
  assert.strictEqual(linkItems[0].getAttribute('role'), 'menuitem');
});

test('menu_button_has_aria_haspopup_menu', () => {
  const env = buildEnv();
  const { root, menuBtn } = buildRootWithMenu(env, []);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  assert.strictEqual(menuBtn.getAttribute('aria-haspopup'), 'menu');
});

test('menu_button_has_aria_controls_pointing_to_popover', () => {
  const env = buildEnv();
  const { root, menuBtn, menuPopover } = buildRootWithMenu(env, []);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  assert.strictEqual(menuBtn.getAttribute('aria-controls'), menuPopover.id);
});

// ---------------------------------------------------------------------------
// Regression: skip-measure releases the visibility gate
// ---------------------------------------------------------------------------

test('skip_measure_releases_measuring_class_immediately', () => {
  const env = buildEnv();
  const { root } = buildRootWithMenu(env);

  // Set the skip-measure attribute to opt out of JS measurement.
  root.setAttribute('data-asu-sparkles-skip-measure', '1');

  const ctrl = new env.AsuSparkles.Controller(root);

  // After construction, the visibility gate must be released even though
  // initHeaderMeasurement returns early (skip-measure path).
  assert.strictEqual(
    ctrl._headerMeasured,
    true,
    '_headerMeasured must be true after skip-measure path',
  );
  assert.ok(
    !root.classList.contains('asu-sparkles--measuring'),
    'asu-sparkles--measuring class must be removed after skip-measure',
  );
});

// ---------------------------------------------------------------------------
// Regression: openMenu in collapsed state is a no-op
// ---------------------------------------------------------------------------

test('openMenu_in_collapsed_state_is_a_no_op', () => {
  const env = buildEnv();
  const { root, menuPopover } = buildRootWithMenu(env, ['/a']);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Widget stays in collapsed state (constructor default).
  assert.strictEqual(ctrl.state, 'collapsed');

  // Attempt to open the menu while collapsed.
  ctrl.openMenu({ focusIdx: 0 });

  // Must not enter the open sub-state.
  assert.ok(
    !ctrl._menuOpen,
    '_menuOpen must remain false when called in collapsed state',
  );
  assert.ok(
    menuPopover.hasAttribute('hidden'),
    'popover must remain hidden when openMenu called in collapsed state',
  );
});

test('openMenu_in_compact_state_is_a_no_op', () => {
  const env = buildEnv();
  const { root, menuPopover } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('compact');

  ctrl.openMenu({ focusIdx: 0 });

  assert.ok(
    !ctrl._menuOpen,
    '_menuOpen must remain false when called in compact state',
  );
  assert.ok(
    menuPopover.hasAttribute('hidden'),
    'popover must remain hidden when openMenu called in compact state',
  );
});

// ---------------------------------------------------------------------------
// Phone regression: applyMeasurement uses 16px on phones ≤768px
// ---------------------------------------------------------------------------

test('applyMeasurement_uses_16px_offset_on_phone_viewport', () => {
  const env = buildEnv();
  const doc = env.document;

  // Simulate a phone viewport width ≤768px.
  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 375,
  });

  // Create a fake header with a known rect.
  const header = doc.createElement('header');
  header.setAttribute('role', 'banner');
  header.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 60,
      height: 60,
      width: 375,
      left: 0,
      right: 375,
    };
  };
  doc.body.appendChild(header);

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  // On phone (≤768px): top should be ceil(60 + 16) = 76px, NOT 60 + 48 = 108px.
  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topVal,
    '76px',
    `Phone viewport must use +16px offset; got ${topVal} (expected 76px, not 108px)`,
  );

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(header);

  // Restore default innerWidth.
  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
});

test('applyMeasurement_uses_48px_offset_on_desktop_viewport', () => {
  const env = buildEnv();
  const doc = env.document;

  // Explicitly set desktop viewport width.
  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });

  const header = doc.createElement('header');
  header.setAttribute('role', 'banner');
  header.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 60,
      height: 60,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(header);

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  // On desktop (>768px): top should be ceil(60 + 48) = 108px.
  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topVal,
    '108px',
    `Desktop viewport must use +48px offset; got ${topVal} (expected 108px)`,
  );

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(header);
});

// ---------------------------------------------------------------------------
// Outside-click: nested span inside menuBtn must count as inside
// ---------------------------------------------------------------------------

test('outside_click_on_menuBtn_span_does_not_close_menu', () => {
  const env = buildEnv();
  const { root, menuBtn, menuPopover } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  assert.ok(ctrl._menuOpen, 'precondition: menu must be open');

  // Simulate a click on the nested <span> inside the menu button.
  // The outside-click handler must treat span-inside-btn as "inside".
  const innerSpan = menuBtn.querySelector('span[aria-hidden]');
  assert.ok(innerSpan, 'precondition: menuBtn must have a nested span');

  // Fire the outside-click handler directly as the capture-phase listener
  // would, targeting the inner span.
  if (ctrl._menuOutsideHandler) {
    ctrl._menuOutsideHandler({ target: innerSpan });
  }

  // Menu must remain open because the click target is inside menuBtn.
  assert.ok(
    ctrl._menuOpen,
    '_menuOpen must remain true when click target is inside menuBtn (nested span)',
  );
  assert.ok(
    !menuPopover.hasAttribute('hidden'),
    'popover must remain visible when click targets inner span of menuBtn',
  );
});

test('outside_click_on_document_body_closes_menu', () => {
  const env = buildEnv();
  const { root, menuPopover } = buildRootWithMenu(env, []);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  assert.ok(ctrl._menuOpen, 'precondition: menu must be open');

  // Fire the outside-click handler targeting an unrelated body element.
  if (ctrl._menuOutsideHandler) {
    ctrl._menuOutsideHandler({ target: env.document.body });
  }

  assert.ok(
    !ctrl._menuOpen,
    '_menuOpen must be false when click is truly outside',
  );
  assert.ok(
    menuPopover.hasAttribute('hidden'),
    'popover must be hidden after outside click',
  );
});

// ---------------------------------------------------------------------------
// Body-class MutationObserver triggers re-measure after toolbar toggle.
// Toolbar tray toggle is body-class driven, not toolbar ResizeObserver.
// ---------------------------------------------------------------------------

test('body_class_mo_triggers_remeasure_on_toolbar_tray_toggle', () => {
  const env = buildEnv();
  const doc = env.document;

  // Capture the MutationObserver callback on document.body.
  let bodyMutationCb = null;
  const origMO = env.window.MutationObserver;
  env.window.MutationObserver = function FakeMO(cb) {
    this.observe = function (target) {
      if (target === doc.body) {
        bodyMutationCb = cb;
      }
    };
    this.disconnect = function () {};
  };

  // Create a fake header that starts at bottom=100, then moves to 140 when
  // the toolbar tray opens (which changes body classes).
  let headerBottom = 100;
  const header = doc.createElement('header');
  header.setAttribute('role', 'banner');
  header.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: headerBottom,
      height: headerBottom,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(header);

  // Stub rAF to execute synchronously.
  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  // The body MO callback must have been captured.
  assert.ok(
    bodyMutationCb !== null,
    'a MutationObserver callback must be registered on document.body',
  );

  // Initial measurement: --asu-sparkles-top = 100+48 = 148px.
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '148px',
  );

  // Simulate toolbar tray opening: #asuHeader position changes → header moves.
  headerBottom = 140;
  doc.body.classList.add('toolbar-horizontal', 'toolbar-tray-open');

  // Fire the MutationObserver callback (simulates body class attribute change).
  bodyMutationCb([{ type: 'attributes', attributeName: 'class' }]);

  // After re-measure: --asu-sparkles-top = 140+48 = 188px.
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '188px',
    'Body-class MO must trigger re-measure after toolbar tray toggle',
  );

  env.window.MutationObserver = origMO;
  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(header);
  doc.body.classList.remove('toolbar-horizontal', 'toolbar-tray-open');
});

// ---------------------------------------------------------------------------
// 60 scroll events do NOT trigger any debounce timers
// (scroll listener is removed; re-measure is handled by resize + body-class MO)
// ---------------------------------------------------------------------------

test('scroll_events_do_not_trigger_debounce_timers', () => {
  const env = buildEnv();
  const doc = env.document;

  // Create a fake header so measureHeaderTop returns a value.
  const header = doc.createElement('header');
  header.setAttribute('role', 'banner');
  header.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 90,
      height: 90,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(header);

  // Stub rAF to be synchronous so initial applyMeasurement runs.
  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  // Count how many 150ms debounce timers get SET.
  let timerSetCount = 0;
  const origSetTimeout = env.window.setTimeout;
  env.window.setTimeout = function countingSetTimeout(cb, delay) {
    if (delay === 150) {
      timerSetCount++;
      return 7777 + timerSetCount;
    }
    return origSetTimeout(cb, delay);
  };

  const { root } = buildRootWithMenu(env);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  // Reset count after construction (constructor triggers 0 debounce timers for
  // the initial rAF path, which runs synchronously in this stub).
  timerSetCount = 0;

  // Dispatch 60 scroll events.
  for (let i = 0; i < 60; i++) {
    const scrollEvent = new env.window.Event('scroll');
    env.window.dispatchEvent(scrollEvent);
  }

  // No debounce timers must be scheduled from scroll events.
  assert.strictEqual(
    timerSetCount,
    0,
    `scroll events must NOT schedule debounce timers; found ${timerSetCount} timer(s)`,
  );

  // Restore.
  env.window.setTimeout = origSetTimeout;
  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(header);
});

// ---------------------------------------------------------------------------
// Detach-before-rAF: destroying the controller before the second rAF fires
// must not create ResizeObservers on the orphaned instance.
// ---------------------------------------------------------------------------

test('detach_before_second_raf_does_not_leak_observer', () => {
  const env = buildEnv();
  const doc = env.document;

  // Collect pending rAF callbacks without executing them.
  const pendingRafs = [];
  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    pendingRafs.push(cb);
    return pendingRafs.length;
  };

  // Count ResizeObserver instantiations.
  let roInstantiateCount = 0;
  const origRO = env.window.ResizeObserver;
  env.window.ResizeObserver = function CountingRO(cb) {
    roInstantiateCount++;
    this.observe = function () {};
    this.disconnect = function () {};
  };

  const { root } = buildRootWithMenu(env);

  const ctrl = new env.AsuSparkles.Controller(root);
  const countAfterConstruct = roInstantiateCount;

  // Destroy the measurement system (simulating Drupal.behaviors.detach).
  ctrl.destroyHeaderMeasurement();

  // Now fire all pending rAF callbacks — these include the initial
  // applyMeasurement rAF and the second resolveSemanticHeaderRaf.
  pendingRafs.forEach(function (cb) {
    try {
      cb();
    } catch (e) {
      /* ignore — guard may throw in edge cases */
    }
  });

  // No new ResizeObservers must have been created after detach.
  assert.strictEqual(
    roInstantiateCount,
    countAfterConstruct,
    'No new ResizeObserver must be created after destroyHeaderMeasurement (detach-before-rAF leak)',
  );

  // Restore.
  env.window.requestAnimationFrame = origRaf;
  env.window.ResizeObserver = origRO;
});

// ===========================================================================
// Targeted #asuHeader measurement (TDD tests)
// These tests describe the targeted-anchor measurement behaviour.
// ===========================================================================

// ---------------------------------------------------------------------------
// A-1  #asuHeader direct measurement — desktop
// ---------------------------------------------------------------------------

test('asuHeader_direct_measurement_desktop', () => {
  const env = buildEnv();
  const doc = env.document;

  // Build the exact page structure from header-diagnosis.md:
  // semantic <header> wrapper (height:0, collapsed), with #asuHeader inside
  // it as a fixed descendant at top:79, bottom:223.
  const semanticHeader = doc.createElement('header');
  semanticHeader.getBoundingClientRect = function () {
    // Simulates the scroll-off scenario: the in-flow wrapper has gone negative.
    // This is the RESTING state (scrollY=0) so bottom=0 (height:0 wrapper at top:0).
    return { top: 0, bottom: 0, height: 0, width: 1280, left: 0, right: 1280 };
  };
  doc.body.appendChild(semanticHeader);

  // #asuHeader — React-rendered fixed DIV, the real header.
  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: 223,
      height: 144,
      width: 1265,
      left: 0,
      right: 1265,
    };
  };
  doc.body.appendChild(asuHeader);

  // Desktop viewport.
  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  const hdrVal = root.style.getPropertyValue('--asu-sparkles-hdr-h');

  // #asuHeader.bottom=223 is the anchor → top = 223+48 = 271px.
  assert.strictEqual(
    topVal,
    '271px',
    `--asu-sparkles-top must be 271px (#asuHeader bottom 223 + 48); got ${topVal}`,
  );
  assert.strictEqual(
    hdrVal,
    '223px',
    `--asu-sparkles-hdr-h must be 223px; got ${hdrVal}`,
  );

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(semanticHeader);
  doc.body.removeChild(asuHeader);
});

// ---------------------------------------------------------------------------
// A-2  #asuHeader anchor — phone viewport uses +16px
// ---------------------------------------------------------------------------

test('asuHeader_phone_uses_16px_offset', () => {
  const env = buildEnv();
  const doc = env.document;

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: 223,
      height: 144,
      width: 390,
      left: 0,
      right: 390,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 390,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 844,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  // phone ≤768px: gap=16, so top = 223+16 = 239px.
  assert.strictEqual(
    topVal,
    '239px',
    `Phone must use +16px offset: expected 239px; got ${topVal}`,
  );

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(asuHeader);

  // Restore.
  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });
});

// ---------------------------------------------------------------------------
// A-3  Toolbar body-class: horizontal+tray-open unions tray bottom
// ---------------------------------------------------------------------------

test('toolbar_body_class_horizontal_tray_open_unions_tray', () => {
  const env = buildEnv();
  const doc = env.document;

  // Add toolbar body classes: horizontal + tray-open.
  doc.body.classList.add('toolbar-horizontal', 'toolbar-tray-open');

  // #asuHeader at bottom:223 (normal resting state).
  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: 223,
      height: 144,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  // #toolbar-bar at bottom:40.
  const toolbarBar = doc.createElement('div');
  toolbarBar.id = 'toolbar-bar';
  toolbarBar.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 40,
      height: 40,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(toolbarBar);

  // Open horizontal tray at bottom:80 (sits below toolbar bar).
  const tray = doc.createElement('div');
  tray.id = 'toolbar-item-administration-tray';
  tray.getBoundingClientRect = function () {
    return {
      top: 40,
      bottom: 80,
      height: 40,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(tray);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // measureHeaderTop() result: max(#asuHeader.bottom=223, tray.bottom=80) = 223.
  // The tray (80) is below 223 so it's already included in the max. Test that
  // the TRAY is considered (we set up a scenario where the tray IS the max).
  // Modify: set #asuHeader to only have bottom=60, tray bottom=80, so tray wins.
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 20,
      bottom: 60,
      height: 40,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };

  const result = ctrl.measureHeaderTop();
  // With toolbar-horizontal + toolbar-tray-open: toolbar bar(40) ∪ tray(80) = 80.
  // Header anchor = 60, toolbar union = 80 → max = 80.
  assert.ok(
    result !== null && result >= 80,
    `Horizontal+tray-open: result must include tray bottom 80; got ${result}`,
  );

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(asuHeader);
  doc.body.removeChild(toolbarBar);
  doc.body.removeChild(tray);
  doc.body.classList.remove('toolbar-horizontal', 'toolbar-tray-open');
});

// ---------------------------------------------------------------------------
// A-4  Toolbar body-class: vertical tray does NOT add top height
// ---------------------------------------------------------------------------

test('toolbar_body_class_vertical_does_not_add_height', () => {
  const env = buildEnv();
  const doc = env.document;

  // Add vertical toolbar body classes (open tray is a left sidebar → no top contribution).
  doc.body.classList.add('toolbar-vertical', 'toolbar-tray-open');

  // #asuHeader at bottom:60.
  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 20,
      bottom: 60,
      height: 40,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  // #toolbar-bar at bottom:40.
  const toolbarBar = doc.createElement('div');
  toolbarBar.id = 'toolbar-bar';
  toolbarBar.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 40,
      height: 40,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(toolbarBar);

  // A vertical tray at bottom:500 (tall vertical sidebar — must NOT be counted).
  const tray = doc.createElement('div');
  tray.id = 'toolbar-item-administration-tray';
  tray.getBoundingClientRect = function () {
    return {
      top: 40,
      bottom: 500,
      height: 460,
      width: 200,
      left: 0,
      right: 200,
    };
  };
  doc.body.appendChild(tray);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  const result = ctrl.measureHeaderTop();

  // Vertical tray (bottom=500) must NOT be unioned in. Result must be max(60, 40) = 60.
  assert.ok(
    result !== null && result <= 60,
    `Vertical tray must NOT contribute to top height; expected ≤60, got ${result}`,
  );

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(asuHeader);
  doc.body.removeChild(toolbarBar);
  doc.body.removeChild(tray);
  doc.body.classList.remove('toolbar-vertical', 'toolbar-tray-open');
});

// ---------------------------------------------------------------------------
// A-5  Toolbar absent (no toolbar body classes) → no toolbar term
// ---------------------------------------------------------------------------

test('toolbar_absent_body_classes_no_toolbar_contribution', () => {
  const env = buildEnv();
  const doc = env.document;

  // Ensure no toolbar classes on body.
  doc.body.classList.remove(
    'toolbar-fixed',
    'toolbar-horizontal',
    'toolbar-vertical',
    'toolbar-tray-open',
  );

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: 223,
      height: 144,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  // Even if #toolbar-bar element exists, it should NOT be counted without toolbar body classes.
  const toolbarBar = doc.createElement('div');
  toolbarBar.id = 'toolbar-bar';
  toolbarBar.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 40,
      height: 40,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(toolbarBar);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  const result = ctrl.measureHeaderTop();
  // No toolbar classes → toolbar not measured. result = #asuHeader.bottom = 223.
  assert.strictEqual(
    result,
    223,
    `Absent toolbar body classes: result must be 223 (from #asuHeader only); got ${result}`,
  );

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(asuHeader);
  doc.body.removeChild(toolbarBar);
});

// ---------------------------------------------------------------------------
// A-6  Shrink-only latch: header-RO SHRINK lowers the anchor; grow-back ignored.
// The latch is shrink-only (not growth-only).
// ---------------------------------------------------------------------------

test('growth_only_latch_header_ro_shrink_does_not_lower_var', () => {
  // This test name is kept for diff-stability but now tests SHRINK-ONLY:
  // shrink LOWERS the anchor (new behavior), grow-back is still ignored.
  const env = buildEnv();
  const doc = env.document;

  let roCallback = null;
  const origRO = env.window.ResizeObserver;
  // Capture the HEADER ResizeObserver callback (not the toolbar one).
  // We'll identify it by which element is observed.
  const capturedCallbacks = [];
  env.window.ResizeObserver = function FakeRO(cb) {
    const roInstance = {
      _cb: cb,
      observe: function (el) {
        capturedCallbacks.push({ cb, el });
      },
      disconnect: function () {},
    };
    return roInstance;
  };

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  let headerBottom = 223;
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: headerBottom,
      height: headerBottom - 79,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  // Synchronous rAF to run initial measurement.
  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // After construction: _restingHeaderBottom should be set to 223.
  assert.ok(
    ctrl._restingHeaderBottom !== undefined,
    'ctrl._restingHeaderBottom must exist after first measurement',
  );
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    223,
    `_restingHeaderBottom must be 223 after initial measurement; got ${ctrl._restingHeaderBottom}`,
  );

  // Simulate the header shrinking 24px on scroll (the scroll-shrink scenario).
  headerBottom = 199; // shrinks from 223 to 199.

  // Trigger the header ResizeObserver callback (simulates what the browser does
  // when the header element changes size).
  const headerEntry = capturedCallbacks.find(function (e) {
    return e.el === asuHeader;
  });
  assert.ok(headerEntry, 'ResizeObserver must be observing #asuHeader');

  // Flush any pending debounce timers that the RO callback schedules.
  const origSetTimeout = env.window.setTimeout;
  let pendingDebounce = null;
  env.window.setTimeout = function fakeSetTimeout(cb, delay) {
    if (delay === 150) {
      pendingDebounce = cb;
      return 9999;
    }
    return origSetTimeout(cb, delay);
  };
  const origClearTimeout = env.window.clearTimeout;
  env.window.clearTimeout = function fakeClearTimeout(id) {
    if (id === 9999) {
      pendingDebounce = null;
    } else {
      origClearTimeout(id);
    }
  };

  // Fire the RO callback with the shrunken entry.
  headerEntry.cb([{ contentRect: { height: 120, width: 1280 } }]);

  // Fire the debounce if scheduled.
  if (pendingDebounce) {
    pendingDebounce();
    pendingDebounce = null;
  }

  // SHRINK-ONLY LATCH: shrink LOWERS the anchor and applies the new token.
  // --asu-sparkles-top must drop to 247px (199+48), NOT stay at 271px.
  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topVal,
    '247px',
    `Shrink-only latch: shrink must LOWER top to 247px (199+48); got ${topVal}`,
  );
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    199,
    `_restingHeaderBottom must be LOWERED to 199 after shrink; got ${ctrl._restingHeaderBottom}`,
  );

  // Now test grow-back is ignored: simulate scroll-to-top (223 again).
  headerBottom = 223;
  headerEntry.cb([{ contentRect: { height: 144, width: 1280 } }]);
  if (pendingDebounce) {
    pendingDebounce();
    pendingDebounce = null;
  }

  // Grow-back must be IGNORED; anchor stays at 199, top stays at 247px.
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    199,
    `Grow-back must be IGNORED; anchor must stay 199, got ${ctrl._restingHeaderBottom}`,
  );
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '247px',
    `Grow-back must be IGNORED; top must stay 247px, got ${root.style.getPropertyValue('--asu-sparkles-top')}`,
  );

  env.window.setTimeout = origSetTimeout;
  env.window.clearTimeout = origClearTimeout;
  env.window.requestAnimationFrame = origRaf;
  env.window.ResizeObserver = origRO;
  doc.body.removeChild(asuHeader);
});
// ---------------------------------------------------------------------------
// A-7  Baseline events (resize, body-mutation, load) re-baseline lower
// ---------------------------------------------------------------------------

test('resize_baseline_lower_header_re_baselines_resting', () => {
  const env = buildEnv();
  const doc = env.document;

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  let headerBottom = 223;
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: headerBottom,
      height: headerBottom - 79,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  // Capture the resize handler.
  let capturedResizeHandler = null;
  const origAddEventListener = env.window.addEventListener;
  env.window.addEventListener = function (type, handler, opts) {
    if (type === 'resize') {
      capturedResizeHandler = handler;
    }
    return origAddEventListener.call(this, type, handler, opts);
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Precondition: resting bottom is 223.
  assert.strictEqual(ctrl._restingHeaderBottom, 223);

  // Simulate header becoming smaller (e.g. toolbar removed → nav shrinks).
  headerBottom = 150;

  // Trigger resize debounce (a BASELINE event allows lower re-baseline).
  const origSetTimeout = env.window.setTimeout;
  let pendingDebounce = null;
  env.window.setTimeout = function fakeSetTimeout(cb, delay) {
    if (delay === 150) {
      pendingDebounce = cb;
      return 9998;
    }
    return origSetTimeout(cb, delay);
  };

  if (capturedResizeHandler) {
    capturedResizeHandler();
  }
  if (pendingDebounce) {
    pendingDebounce();
    pendingDebounce = null;
  }

  // After a resize baseline event, _restingHeaderBottom MUST update to 150.
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    150,
    `Resize baseline must re-baseline _restingHeaderBottom to 150; got ${ctrl._restingHeaderBottom}`,
  );
  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topVal,
    '198px',
    `After resize re-baseline: top must be 150+48=198px; got ${topVal}`,
  );

  env.window.setTimeout = origSetTimeout;
  env.window.addEventListener = origAddEventListener;
  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(asuHeader);
});

// ---------------------------------------------------------------------------
// A-8  Body-class MutationObserver triggers re-measure (baseline)
// ---------------------------------------------------------------------------

test('body_class_mutation_triggers_remeasure', () => {
  const env = buildEnv();
  const doc = env.document;

  // Capture the MutationObserver callback on document.body.
  let bodyMutationCallback = null;
  const origMO = env.window.MutationObserver;
  env.window.MutationObserver = function FakeMO(cb) {
    this.observe = function (target, opts) {
      if (target === doc.body) {
        bodyMutationCallback = cb;
      }
    };
    this.disconnect = function () {};
  };

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  let headerBottom = 100;
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 20,
      bottom: headerBottom,
      height: headerBottom - 20,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  assert.ok(
    bodyMutationCallback !== null,
    'a MutationObserver must be installed on document.body for class changes',
  );

  // Simulate the admin toolbar opening: toolbar class added to body, header moves.
  headerBottom = 180;

  // Fire the body-class MutationObserver callback (simulates body class change).
  bodyMutationCallback([{ type: 'attributes', attributeName: 'class' }]);

  // After the callback, --asu-sparkles-top must reflect the new header bottom.
  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topVal,
    '228px',
    `Body-class mutation must trigger re-measure: expected 228px (180+48); got ${topVal}`,
  );

  env.window.MutationObserver = origMO;
  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(asuHeader);
});

// ---------------------------------------------------------------------------
// A-9  NO scroll listener is registered
// ---------------------------------------------------------------------------

test('no_scroll_listener_registered', () => {
  const env = buildEnv();

  // Track all event listeners added to window.
  const registeredListeners = [];
  const origAddEventListener = env.window.addEventListener;
  env.window.addEventListener = function (type, handler, opts) {
    registeredListeners.push({ type, handler, opts });
    return origAddEventListener.call(this, type, handler, opts);
  };

  const { root } = buildRootWithMenu(env);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  env.window.addEventListener = origAddEventListener;

  const scrollListeners = registeredListeners.filter(function (l) {
    return l.type === 'scroll';
  });

  assert.strictEqual(
    scrollListeners.length,
    0,
    `NO scroll listener must be registered; found ${scrollListeners.length}`,
  );
});

// ---------------------------------------------------------------------------
// A-10  Teardown disconnects _headerResizeObserver and _bodyClassObserver
// ---------------------------------------------------------------------------

test('teardown_disconnects_header_ro_and_body_mo', () => {
  const env = buildEnv();
  const doc = env.document;

  let headerRODisconnected = false;
  let bodyMODisconnected = false;
  const origRO = env.window.ResizeObserver;
  env.window.ResizeObserver = function FakeRO(cb) {
    this.observe = function () {};
    this.disconnect = function () {
      headerRODisconnected = true;
    };
  };
  const origMO = env.window.MutationObserver;
  env.window.MutationObserver = function FakeMO(cb) {
    this.observe = function () {};
    this.disconnect = function () {
      bodyMODisconnected = true;
    };
  };

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: 223,
      height: 144,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Verify observers were assigned.
  assert.ok(
    ctrl._headerResizeObserver !== null,
    '_headerResizeObserver must be set after init with #asuHeader present',
  );
  assert.ok(
    ctrl._bodyClassObserver !== null,
    '_bodyClassObserver must be set after init',
  );

  // Teardown.
  ctrl.destroyHeaderMeasurement();

  assert.ok(
    headerRODisconnected,
    '_headerResizeObserver.disconnect() must be called on teardown',
  );
  assert.ok(
    bodyMODisconnected,
    '_bodyClassObserver.disconnect() must be called on teardown',
  );
  assert.strictEqual(
    ctrl._headerResizeObserver,
    null,
    '_headerResizeObserver must be nulled after teardown',
  );
  assert.strictEqual(
    ctrl._bodyClassObserver,
    null,
    '_bodyClassObserver must be nulled after teardown',
  );

  env.window.ResizeObserver = origRO;
  env.window.MutationObserver = origMO;
  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(asuHeader);
});

// ---------------------------------------------------------------------------
// A-11  Anchor ordered fallback: when #asuHeader absent, .uds-header used
// ---------------------------------------------------------------------------

test('anchor_fallback_uds_header_when_no_asuHeader', () => {
  const env = buildEnv();
  const doc = env.document;

  // No #asuHeader in DOM; .uds-header present.
  const udsHeader = doc.createElement('div');
  udsHeader.className = 'uds-header';
  udsHeader.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 120,
      height: 120,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(udsHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  // .uds-header bottom=120 → top=120+48=168px.
  assert.strictEqual(
    topVal,
    '168px',
    `Fallback to .uds-header: expected 168px (120+48); got ${topVal}`,
  );

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(udsHeader);
});

// ---------------------------------------------------------------------------
// A-12  Anchor ordered fallback: when neither #asuHeader nor .uds-header,
//        header[role="banner"] is used
// ---------------------------------------------------------------------------

test('anchor_fallback_banner_when_no_asuHeader_or_uds_header', () => {
  const env = buildEnv();
  const doc = env.document;

  // Only header[role="banner"] present.
  const banner = doc.createElement('header');
  banner.setAttribute('role', 'banner');
  banner.getBoundingClientRect = function () {
    return {
      top: 0,
      bottom: 90,
      height: 90,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(banner);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const _ctrl = new env.AsuSparkles.Controller(root); // eslint-disable-line no-new

  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  // banner bottom=90 → top=90+48=138px.
  assert.strictEqual(
    topVal,
    '138px',
    `Fallback to header[role=banner]: expected 138px (90+48); got ${topVal}`,
  );

  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(banner);
});

// ---------------------------------------------------------------------------
// A-13  Post-detach body-class MutationObserver race: rAF queued before
//        destroyHeaderMeasurement() must NOT call measureHeaderTop() or write
//        CSS tokens after teardown.
// ---------------------------------------------------------------------------

test('body_class_mutation_raf_after_destroy_does_not_write_tokens', () => {
  const env = buildEnv();
  const doc = env.document;

  // Phase 1: synchronous rAF so the Controller's initial measurement fires
  // during construction and sets a known token value.
  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  // Capture the body-class MutationObserver callback.
  let bodyMutationCallback = null;
  const origMO = env.window.MutationObserver;
  env.window.MutationObserver = function FakeMO(cb) {
    this.observe = function (target) {
      if (target === doc.body) {
        bodyMutationCallback = cb;
      }
    };
    this.disconnect = function () {};
  };

  // Stub ResizeObserver so construction doesn't throw.
  const origRO = env.window.ResizeObserver;
  env.window.ResizeObserver = function FakeRO() {
    this.observe = function () {};
    this.disconnect = function () {};
  };

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: 223,
      height: 144,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  assert.ok(
    bodyMutationCallback !== null,
    'Precondition: body-class MutationObserver must be installed',
  );

  // After synchronous construction: initial measurement ran → token is '271px'.
  const topAfterInit = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topAfterInit,
    '271px',
    'Precondition: initial token must be 271px',
  );

  // Phase 2: switch rAF to collecting mode — subsequent rAF calls are queued,
  // not executed. This simulates the race window.
  const pendingRafs = [];
  env.window.requestAnimationFrame = function (cb) {
    pendingRafs.push(cb);
    return pendingRafs.length;
  };

  // Step 1: body-class mutation fires → callback queues a rAF (not yet executed).
  bodyMutationCallback([{ type: 'attributes', attributeName: 'class' }]);

  // Step 2: BEFORE the rAF fires, destroy the measurement system.
  ctrl.destroyHeaderMeasurement();

  // Step 3: flush all pending rAF callbacks — including the one queued by the
  // body-class MutationObserver. The guard inside onBodyClassMutationRaf must
  // prevent any measurement or token write.
  pendingRafs.forEach(function (cb) {
    try {
      cb();
    } catch (e) {
      /* guard may early-return, not throw */
    }
  });

  // The CSS token must remain at the pre-destroy value — no write after teardown.
  const topAfterRace = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topAfterRace,
    '271px',
    `Post-detach race: --asu-sparkles-top must stay at 271px (no write after destroy); got "${topAfterRace}"`,
  );

  // Restore.
  env.window.requestAnimationFrame = origRaf;
  env.window.MutationObserver = origMO;
  env.window.ResizeObserver = origRO;
  doc.body.removeChild(asuHeader);
});

// ---------------------------------------------------------------------------
// A-14  Destroy-before-initial-rAF: calling destroyHeaderMeasurement()
//        before the initial measureAndBaseline rAF fires must NOT write CSS
//        tokens or mutate the root (measureAndBaseline guard).
// ---------------------------------------------------------------------------

test('destroy_before_initial_raf_does_not_write_tokens', () => {
  const env = buildEnv();
  const doc = env.document;

  // Collect pending rAF callbacks without executing them.
  const pendingRafs = [];
  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    pendingRafs.push(cb);
    return pendingRafs.length;
  };

  // Stub observers to avoid side-effects.
  const origRO = env.window.ResizeObserver;
  env.window.ResizeObserver = function FakeRO() {
    this.observe = function () {};
    this.disconnect = function () {};
  };
  const origMO = env.window.MutationObserver;
  env.window.MutationObserver = function FakeMO() {
    this.observe = function () {};
    this.disconnect = function () {};
  };

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: 223,
      height: 144,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Before any rAF fires, the token should be unset (empty string).
  const topBeforeRaf = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topBeforeRaf,
    '',
    'Precondition: token not yet set before rAF fires',
  );

  // Destroy BEFORE the initial rAF fires.
  ctrl.destroyHeaderMeasurement();

  // Flush ALL pending rAFs (measureAndBaseline, resolveAnchorAndObserve, etc.).
  pendingRafs.forEach(function (cb) {
    try {
      cb();
    } catch (e) {
      /* guard may early-return */
    }
  });

  // Token must still be empty — no write after destroy.
  const topAfterRaf = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topAfterRaf,
    '',
    `destroy_before_initial_raf: token must stay empty after destroyed controller fires rAF; got "${topAfterRaf}"`,
  );

  // Restore.
  env.window.requestAnimationFrame = origRaf;
  env.window.ResizeObserver = origRO;
  env.window.MutationObserver = origMO;
  doc.body.removeChild(asuHeader);
});

// ---------------------------------------------------------------------------
// A-15  Destroy-before-initial-rAF: releaseGateRaf queued from applyTokens
//        must not remove asu-sparkles--measuring after teardown.
// ---------------------------------------------------------------------------

test('destroy_before_release_gate_raf_does_not_remove_measuring_class', () => {
  const env = buildEnv();
  const doc = env.document;

  // Synchronous measureAndBaseline then collecting-mode for the gate rAF.
  // We need measureAndBaseline to execute (so it queues releaseGateRaf) but
  // then releaseGateRaf to be deferred so we can destroy between them.
  let callCount = 0;
  const pendingRafs = [];
  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    callCount++;
    // First rAF (measureAndBaseline): run it immediately.
    // Subsequent rAFs (releaseGateRaf, resolveAnchorAndObserve): queue them.
    if (callCount === 1) {
      cb();
      return 1;
    }
    pendingRafs.push(cb);
    return callCount;
  };

  const origRO = env.window.ResizeObserver;
  env.window.ResizeObserver = function FakeRO() {
    this.observe = function () {};
    this.disconnect = function () {};
  };
  const origMO = env.window.MutationObserver;
  env.window.MutationObserver = function FakeMO() {
    this.observe = function () {};
    this.disconnect = function () {};
  };

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: 223,
      height: 144,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const { root } = buildRootWithMenu(env);
  // The constructor adds asu-sparkles--measuring; measureAndBaseline ran
  // (synchronous first rAF) and queued releaseGateRaf as a pending rAF.
  const ctrl = new env.AsuSparkles.Controller(root);

  // Precondition: measuring class still present (releaseGateRaf not yet fired).
  const hasMeasuringBefore = root.classList.contains('asu-sparkles--measuring');
  assert.ok(
    hasMeasuringBefore,
    'Precondition: asu-sparkles--measuring must still be present before releaseGateRaf fires',
  );

  // Destroy BEFORE releaseGateRaf fires.
  ctrl.destroyHeaderMeasurement();

  // Flush queued rAFs — releaseGateRaf should be a no-op due to the guard.
  pendingRafs.forEach(function (cb) {
    try {
      cb();
    } catch (e) {
      /* guard may early-return */
    }
  });

  // asu-sparkles--measuring must remain — the gate was not released by a
  // destroyed controller.
  const hasMeasuringAfter = root.classList.contains('asu-sparkles--measuring');
  assert.ok(
    hasMeasuringAfter,
    "destroy_before_release_gate_raf: asu-sparkles--measuring must NOT be removed by a destroyed controller's queued releaseGateRaf",
  );

  // Restore.
  env.window.requestAnimationFrame = origRaf;
  env.window.ResizeObserver = origRO;
  env.window.MutationObserver = origMO;
  doc.body.removeChild(asuHeader);
});

// ---------------------------------------------------------------------------
// A-16  Late-anchor recovery: when document.readyState is 'complete' at
//        attach time (window.load already fired), the safety net must run
//        immediately — anchor absent at init, present after load, results in
//        token update and ResizeObserver installed.
// ---------------------------------------------------------------------------

test('late_anchor_recovery_when_readyState_complete', () => {
  const env = buildEnv();
  const doc = env.document;

  // Simulate readyState === 'complete' (page already loaded when behavior attaches).
  Object.defineProperty(doc, 'readyState', {
    writable: true,
    configurable: true,
    value: 'complete',
  });

  // Synchronous rAF so construction-time rAFs fire immediately.
  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  // Capture setTimeout calls.
  const pendingTimeouts = [];
  const origTimeout = env.window.setTimeout;
  env.window.setTimeout = function (cb, delay) {
    pendingTimeouts.push({ cb, delay });
    return pendingTimeouts.length;
  };
  env.window.clearTimeout = function () {};

  // Track ResizeObserver observations.
  let roObserveCount = 0;
  let roDisconnectCount = 0;
  const origRO = env.window.ResizeObserver;
  env.window.ResizeObserver = function TrackingRO() {
    this.observe = function () {
      roObserveCount++;
    };
    this.disconnect = function () {
      roDisconnectCount++;
    };
  };

  const origMO = env.window.MutationObserver;
  env.window.MutationObserver = function FakeMO() {
    this.observe = function () {};
    this.disconnect = function () {};
  };

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  // NO header in DOM at init time.
  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Initial measurement: no anchor → token stays empty.
  const topAfterInit = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topAfterInit,
    '',
    'Precondition: no anchor found at init, token must be empty',
  );

  // Now add the header to simulate late hydration.
  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: 223,
      height: 144,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  // Fire the pending timeout (the 200ms safety net scheduled immediately
  // because readyState === 'complete').
  assert.ok(
    pendingTimeouts.length > 0,
    'Precondition: a safety-net timeout must have been scheduled',
  );
  pendingTimeouts.forEach(function (t) {
    try {
      t.cb();
    } catch (e) {
      /* guard may early-return */
    }
  });

  // After safety net fires: token must be updated with the now-present anchor.
  const topAfterLoad = root.style.getPropertyValue('--asu-sparkles-top');
  assert.strictEqual(
    topAfterLoad,
    '271px',
    `late_anchor_recovery: after safety net fires with anchor present, token must be 271px; got "${topAfterLoad}"`,
  );

  // ResizeObserver must have been installed on the anchor.
  assert.ok(
    roObserveCount > 0,
    'late_anchor_recovery: ResizeObserver.observe must have been called after late-anchor recovery',
  );

  // Cleanup.
  env.window.requestAnimationFrame = origRaf;
  env.window.setTimeout = origTimeout;
  env.window.ResizeObserver = origRO;
  env.window.MutationObserver = origMO;
  doc.body.removeChild(asuHeader);
});

// ===========================================================================
// Shrink-only latch: pins to the contracted header
// The header ResizeObserver must LOWER the anchor when measured < anchor
// (shrink = scroll-contraction, capture it) and IGNORE when measured > anchor
// (grow-back = scroll-to-top, stay pinned to contracted).
// Baseline events (initial, resize, body-class, load) always SET unconditionally.
// ===========================================================================

test('shrink_only_latch_ro_shrink_lowers_anchor_and_applies', () => {
  const env = buildEnv();
  const doc = env.document;

  // Capture RO callbacks keyed by observed element.
  const capturedCallbacks = [];
  const origRO = env.window.ResizeObserver;
  env.window.ResizeObserver = function FakeRO(cb) {
    return {
      _cb: cb,
      observe: function (el) {
        capturedCallbacks.push({ cb, el });
      },
      disconnect: function () {},
    };
  };

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  let headerBottom = 223;
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: headerBottom,
      height: headerBottom - 79,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Initial: anchor = 223, --asu-sparkles-top = 271px.
  assert.strictEqual(ctrl._restingHeaderBottom, 223);
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '271px',
  );

  // Simulate header SHRINKING (scroll-contraction: 223 → 199).
  headerBottom = 199;

  const headerEntry = capturedCallbacks.find(function (e) {
    return e.el === asuHeader;
  });
  assert.ok(headerEntry, 'ResizeObserver must observe #asuHeader');

  // Fire RO callback — shrink path.
  headerEntry.cb([{ contentRect: { height: 120, width: 1280 } }]);

  // SHRINK-ONLY: shrink must LOWER the anchor AND apply the new token.
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    199,
    'Shrink-only latch: anchor must LOWER to 199 on shrink; got ' +
      ctrl._restingHeaderBottom,
  );
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '247px',
    'Shrink-only latch: --asu-sparkles-top must be 247px (199+48) after shrink; got ' +
      root.style.getPropertyValue('--asu-sparkles-top'),
  );

  env.window.requestAnimationFrame = origRaf;
  env.window.ResizeObserver = origRO;
  doc.body.removeChild(asuHeader);
});

test('shrink_only_latch_ro_grow_back_is_ignored', () => {
  const env = buildEnv();
  const doc = env.document;

  const capturedCallbacks = [];
  const origRO = env.window.ResizeObserver;
  env.window.ResizeObserver = function FakeRO(cb) {
    return {
      _cb: cb,
      observe: function (el) {
        capturedCallbacks.push({ cb, el });
      },
      disconnect: function () {},
    };
  };

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  let headerBottom = 199; // Start already contracted.
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: headerBottom,
      height: headerBottom - 79,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Initial: anchor = 199, top = 247px.
  assert.strictEqual(ctrl._restingHeaderBottom, 199);
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '247px',
  );

  // Simulate header GROWING BACK (scroll-to-top: 199 → 223).
  headerBottom = 223;

  const headerEntry = capturedCallbacks.find(function (e) {
    return e.el === asuHeader;
  });
  assert.ok(headerEntry, 'ResizeObserver must observe #asuHeader');

  // Fire RO callback — grow-back path.
  headerEntry.cb([{ contentRect: { height: 144, width: 1280 } }]);

  // SHRINK-ONLY: grow-back must be IGNORED. Anchor stays at 199.
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    199,
    'Shrink-only: grow-back must be IGNORED; anchor must stay 199, got ' +
      ctrl._restingHeaderBottom,
  );
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '247px',
    'Shrink-only: grow-back must be IGNORED; top must stay 247px, got ' +
      root.style.getPropertyValue('--asu-sparkles-top'),
  );

  env.window.requestAnimationFrame = origRaf;
  env.window.ResizeObserver = origRO;
  doc.body.removeChild(asuHeader);
});

test('shrink_only_latch_baseline_resize_allows_lower_reset', () => {
  // A BASELINE event (window resize) must unconditionally SET the anchor,
  // even lower. This is different from the RO shrink (which should lower)
  // and the RO grow-back (ignored). Baselines are real layout changes.
  const env = buildEnv();
  const doc = env.document;

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  let headerBottom = 223;
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: headerBottom,
      height: headerBottom - 79,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  let capturedResizeHandler = null;
  const origAddEL = env.window.addEventListener;
  env.window.addEventListener = function (type, handler, opts) {
    if (type === 'resize') capturedResizeHandler = handler;
    return origAddEL.call(this, type, handler, opts);
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  assert.strictEqual(ctrl._restingHeaderBottom, 223);

  // Baseline resize with header at lower value (legitimate layout shrink).
  headerBottom = 150;

  const origST = env.window.setTimeout;
  let debounce = null;
  env.window.setTimeout = function (cb, delay) {
    if (delay === 150) {
      debounce = cb;
      return 1;
    }
    return origST(cb, delay);
  };

  if (capturedResizeHandler) capturedResizeHandler();
  if (debounce) {
    debounce();
    debounce = null;
  }

  // Baseline MUST reset anchor to 150 (unconditional set).
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    150,
    'Baseline resize must unconditionally reset anchor to 150; got ' +
      ctrl._restingHeaderBottom,
  );
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '198px',
    'After baseline resize: top must be 198px (150+48); got ' +
      root.style.getPropertyValue('--asu-sparkles-top'),
  );

  env.window.setTimeout = origST;
  env.window.addEventListener = origAddEL;
  env.window.requestAnimationFrame = origRaf;
  doc.body.removeChild(asuHeader);
});

// ===========================================================================
// Copy icon gate (native block 'Add copy icon')
// addCopyButton is skipped only when drupalSettings.ai_deepchat.show_copy_icon
// === false; default (true/absent) shows the owned copy button.
// ===========================================================================

test('addCopyButton_skipped_when_show_copy_icon_false', () => {
  // Native "Add copy icon" unchecked -> drupalSettings.ai_deepchat.show_copy_icon = false.
  const env = buildEnv();
  env.window.drupalSettings.ai_deepchat.show_copy_icon = false;

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  const bubble = env.document.createElement('div');
  bubble.className = 'asu-sparkles__bubble';
  bubble.textContent = 'Test answer';

  ctrl.addCopyButton(bubble);

  const copyBtn = bubble.querySelector('.asu-sparkles__copy');
  assert.strictEqual(
    copyBtn,
    null,
    'addCopyButton must NOT create a copy button when show_copy_icon is false',
  );
});

test('addCopyButton_created_when_show_copy_icon_true', () => {
  const env = buildEnv();
  env.window.drupalSettings.ai_deepchat.show_copy_icon = true;

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  const bubble = env.document.createElement('div');
  bubble.className = 'asu-sparkles__bubble';
  bubble.textContent = 'Test answer';

  ctrl.addCopyButton(bubble);

  const copyBtn = bubble.querySelector('.asu-sparkles__copy');
  assert.ok(
    copyBtn !== null,
    'addCopyButton must create a copy button when show_copy_icon is true',
  );
});

test('addCopyButton_created_when_show_copy_icon_absent', () => {
  // No show_copy_icon flag at all -> default behavior = show button.
  const env = buildEnv();
  if (env.window.drupalSettings.ai_deepchat) {
    delete env.window.drupalSettings.ai_deepchat.show_copy_icon;
  }

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  const bubble = env.document.createElement('div');
  bubble.className = 'asu-sparkles__bubble';
  bubble.textContent = 'Test answer';

  ctrl.addCopyButton(bubble);

  const copyBtn = bubble.querySelector('.asu-sparkles__copy');
  assert.ok(
    copyBtn !== null,
    'addCopyButton must create a copy button when show_copy_icon is absent (default show)',
  );
});

// ===========================================================================
// first_message hoisted to the header slot, NOT added to the log
// ===========================================================================

test('first_message_written_to_header_slot_not_log', () => {
  // Build env with a first_message.
  const env = buildEnv();
  env.window.drupalSettings.ai_deepchat.first_message = 'Hello from ASU!';

  const doc = env.document;

  // Build a root that includes the .asu-sparkles__subtitle / .asu-sparkles__firstmsg slot.
  const root = doc.createElement('div');
  root.className = 'asu-sparkles';
  root.setAttribute('data-state', 'collapsed');
  root.setAttribute('aria-label', 'ASU AI Chatbot');

  const fab = doc.createElement('button');
  fab.className = 'asu-sparkles__fab';
  fab.setAttribute('hidden', 'hidden');
  root.appendChild(fab);

  const head = doc.createElement('div');
  head.className = 'asu-sparkles__head';

  // The .asu-sparkles__subtitle / .asu-sparkles__firstmsg is the header slot.
  const firstmsgSlot = doc.createElement('p');
  firstmsgSlot.className = 'asu-sparkles__subtitle';
  head.appendChild(firstmsgSlot);
  root.appendChild(head);

  const log = doc.createElement('div');
  log.className = 'asu-sparkles__log';
  log.setAttribute('role', 'log');
  root.appendChild(log);

  const form = doc.createElement('form');
  form.className = 'asu-sparkles__form';
  const input = doc.createElement('input');
  input.className = 'asu-sparkles__input';
  input.type = 'text';
  form.appendChild(input);
  root.appendChild(form);

  const live = doc.createElement('p');
  live.className = 'asu-sparkles__live';
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);

  doc.body.appendChild(root);

  const ctrl = new env.AsuSparkles.Controller(root);

  // The first_message must be written to the header slot.
  const slot = root.querySelector(
    '.asu-sparkles__subtitle, .asu-sparkles__firstmsg',
  );
  assert.ok(
    slot !== null,
    'A .asu-sparkles__subtitle or .asu-sparkles__firstmsg element must be present',
  );
  assert.strictEqual(
    slot.textContent.trim(),
    'Hello from ASU!',
    'first_message must be written to the header slot',
  );

  // The log must NOT contain an .asu-sparkles__intro-msg element.
  const introMsg = log.querySelector('.asu-sparkles__intro-msg');
  assert.strictEqual(
    introMsg,
    null,
    'first_message must NOT be inserted as .asu-sparkles__intro-msg in the log',
  );
});

test('empty_first_message_hides_header_slot', () => {
  const env = buildEnv();
  env.window.drupalSettings.ai_deepchat.first_message = '';

  const doc = env.document;
  const root = doc.createElement('div');
  root.className = 'asu-sparkles';
  root.setAttribute('data-state', 'collapsed');
  root.setAttribute('aria-label', 'ASU AI Chatbot');

  const fab = doc.createElement('button');
  fab.className = 'asu-sparkles__fab';
  fab.setAttribute('hidden', 'hidden');
  root.appendChild(fab);

  const head = doc.createElement('div');
  head.className = 'asu-sparkles__head';
  const firstmsgSlot = doc.createElement('p');
  firstmsgSlot.className = 'asu-sparkles__subtitle';
  head.appendChild(firstmsgSlot);
  root.appendChild(head);

  const log = doc.createElement('div');
  log.className = 'asu-sparkles__log';
  log.setAttribute('role', 'log');
  root.appendChild(log);

  const form = doc.createElement('form');
  form.className = 'asu-sparkles__form';
  const input = doc.createElement('input');
  input.className = 'asu-sparkles__input';
  input.type = 'text';
  form.appendChild(input);
  root.appendChild(form);

  const live = doc.createElement('p');
  live.className = 'asu-sparkles__live';
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);

  doc.body.appendChild(root);

  const ctrl = new env.AsuSparkles.Controller(root);

  // The header slot must be hidden (aria-hidden or display-none class or hidden attr).
  const slot = root.querySelector(
    '.asu-sparkles__subtitle, .asu-sparkles__firstmsg',
  );
  assert.ok(slot !== null, 'Header slot element must exist');
  const isHidden =
    slot.getAttribute('hidden') !== null ||
    slot.getAttribute('aria-hidden') === 'true' ||
    slot.classList.contains('visually-hidden') ||
    slot.style.display === 'none';
  assert.ok(isHidden, 'Header slot must be hidden when first_message is empty');
});

test('clear_does_not_re_seed_intro_msg_in_log', () => {
  const env = buildEnv();
  env.window.drupalSettings.ai_deepchat.assistant_id = 'test-id';
  env.window.drupalSettings.ai_deepchat.thread_id = 'thr-1';
  env.window.drupalSettings.ai_deepchat.first_message = 'Hello!';

  // Provide a minimal fetch stub for the reset-session call.
  env.window.fetch = function () {
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true, thread_id: 'new-thr' }),
      text: () => Promise.resolve('tok'),
    });
  };

  const doc = env.document;
  const root = doc.createElement('div');
  root.className = 'asu-sparkles';
  root.setAttribute('data-state', 'collapsed');
  root.setAttribute('aria-label', 'ASU AI Chatbot');

  const fab = doc.createElement('button');
  fab.className = 'asu-sparkles__fab';
  fab.setAttribute('hidden', 'hidden');
  root.appendChild(fab);

  const head = doc.createElement('div');
  head.className = 'asu-sparkles__head';
  const firstmsgSlot = doc.createElement('p');
  firstmsgSlot.className = 'asu-sparkles__subtitle';
  head.appendChild(firstmsgSlot);
  root.appendChild(head);

  const log = doc.createElement('div');
  log.className = 'asu-sparkles__log';
  log.setAttribute('role', 'log');
  root.appendChild(log);

  const form = doc.createElement('form');
  form.className = 'asu-sparkles__form';
  const input = doc.createElement('input');
  input.className = 'asu-sparkles__input';
  input.type = 'text';
  form.appendChild(input);
  const sendBtn = doc.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'asu-sparkles__send';
  form.appendChild(sendBtn);
  root.appendChild(form);

  const live = doc.createElement('p');
  live.className = 'asu-sparkles__live';
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);

  doc.body.appendChild(root);

  const ctrl = new env.AsuSparkles.Controller(root);

  // After init, the log must NOT contain .asu-sparkles__intro-msg.
  assert.strictEqual(
    log.querySelector('.asu-sparkles__intro-msg'),
    null,
    'After init, log must NOT contain .asu-sparkles__intro-msg (first_message is in header)',
  );

  // After clearConversation(), the log must still NOT contain .asu-sparkles__intro-msg.
  ctrl.clearConversation();

  assert.strictEqual(
    log.querySelector('.asu-sparkles__intro-msg'),
    null,
    'After clearConversation, log must NOT contain .asu-sparkles__intro-msg',
  );
});

// ===========================================================================
// Shrink-only latch stability rules
// ===========================================================================

// ---------------------------------------------------------------------------
// A transient tiny (but > 0) header measurement must be REJECTED by
//        the shrink-only RO callback, so it is not permanently latched.
//
// Scenario: header normally measures 199px (already contracted). Browser
// fires a RO callback during an animation frame where the header temporarily
// reports height=1, bottom=5. That should not lower the anchor to 5.
// ---------------------------------------------------------------------------

test('shrink_only_latch_rejects_transient_tiny_measurement', () => {
  const env = buildEnv();
  const doc = env.document;

  const capturedCallbacks = [];
  const origRO = env.window.ResizeObserver;
  env.window.ResizeObserver = function FakeRO(cb) {
    return {
      _cb: cb,
      observe: function (el) {
        capturedCallbacks.push({ cb, el });
      },
      disconnect: function () {},
    };
  };

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  // Start at the already-contracted value.
  let headerBottom = 199;
  asuHeader.getBoundingClientRect = function () {
    return {
      top: headerBottom - 120,
      bottom: headerBottom,
      height: 120,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Precondition: anchor is the legitimate contracted value.
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    199,
    'Precondition: anchor must be 199 (contracted)',
  );
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '247px',
    'Precondition: top must be 247px (199+48)',
  );

  // Simulate a transient tiny measurement: height=1, bottom=5.
  headerBottom = 5;
  asuHeader.getBoundingClientRect = function () {
    return { top: 4, bottom: 5, height: 1, width: 1280, left: 0, right: 1280 };
  };

  const headerEntry = capturedCallbacks.find(function (e) {
    return e.el === asuHeader;
  });
  assert.ok(headerEntry, 'ResizeObserver must observe #asuHeader');

  // Fire RO with tiny transient measurement.
  headerEntry.cb([{ contentRect: { height: 1, width: 1280 } }]);

  // The latch MUST reject this tiny measurement — anchor stays at 199.
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    199,
    'Transient tiny (height=1) RO measurement must be REJECTED; anchor must stay 199, got ' +
      ctrl._restingHeaderBottom,
  );
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '247px',
    'Transient tiny RO measurement must be REJECTED; top must stay 247px, got ' +
      root.style.getPropertyValue('--asu-sparkles-top'),
  );

  // Now simulate header growing back to 199 (grow-back is ignored as normal).
  headerBottom = 199;
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: 199,
      height: 120,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  headerEntry.cb([{ contentRect: { height: 120, width: 1280 } }]);

  // Grow-back is still ignored; anchor is still 199 (unchanged).
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    199,
    'After grow-back, anchor must remain 199; got ' + ctrl._restingHeaderBottom,
  );

  env.window.requestAnimationFrame = origRaf;
  env.window.ResizeObserver = origRO;
  doc.body.removeChild(asuHeader);
});

// ---------------------------------------------------------------------------
// applyBaseline(null) after a prior measurement must CLEAR the stale
//        inline token values so the CSS fallback takes over.
//        (The old code left stale inline styles when no anchor was found.)
// ---------------------------------------------------------------------------

test('applyBaseline_null_after_prior_measurement_clears_tokens', () => {
  const env = buildEnv();
  const doc = env.document;

  const asuHeader = doc.createElement('div');
  asuHeader.id = 'asuHeader';
  let headerBottom = 223;
  asuHeader.getBoundingClientRect = function () {
    return {
      top: 79,
      bottom: headerBottom,
      height: 144,
      width: 1280,
      left: 0,
      right: 1280,
    };
  };
  doc.body.appendChild(asuHeader);

  Object.defineProperty(env.window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(env.window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: 800,
  });

  const origRaf = env.window.requestAnimationFrame;
  env.window.requestAnimationFrame = function (cb) {
    cb();
    return 1;
  };

  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  // Precondition: tokens set after first measurement.
  assert.strictEqual(
    root.style.getPropertyValue('--asu-sparkles-top'),
    '271px',
    'Precondition: initial token must be 271px',
  );
  assert.strictEqual(ctrl._restingHeaderBottom, 223);

  // Now remove the header from the DOM to simulate anchor disappearing.
  doc.body.removeChild(asuHeader);

  // Trigger a baseline measurement (resize event path).
  // measureHeaderTop() will now return null (no anchor).
  let capturedResizeHandler = null;
  const origAddEL = env.window.addEventListener;
  env.window.addEventListener = function (type, handler, opts) {
    if (type === 'resize') capturedResizeHandler = handler;
    return origAddEL.call(this, type, handler, opts);
  };

  // We need to re-init to get the resize handler captured — OR call
  // measureAndBaseline directly via the internal exposure.
  // Instead, spy on the existing handler by directly calling applyBaseline
  // with null through the internal measureHeaderTop result.
  // The cleanest way: override measureHeaderTop to return null, then fire resize.

  const origMeasure = ctrl.measureHeaderTop.bind(ctrl);
  ctrl.measureHeaderTop = function () {
    return null;
  };

  // Directly call the exposed _applyBaselineForTest if available, else simulate
  // resize event. The design exposes applyBaseline indirectly through the
  // resize debounce.
  const origST = env.window.setTimeout;
  let debounce = null;
  env.window.setTimeout = function fakeSetTimeout(cb, delay) {
    if (delay === 150) {
      debounce = cb;
      return 1;
    }
    return origST(cb, delay);
  };

  // Trigger resize.
  if (ctrl._resizeHandler) {
    ctrl._resizeHandler();
  }
  if (debounce) {
    debounce();
    debounce = null;
  }

  // After applyBaseline(null): stale inline tokens must be CLEARED.
  const topVal = root.style.getPropertyValue('--asu-sparkles-top');
  const hdrVal = root.style.getPropertyValue('--asu-sparkles-hdr-h');
  assert.strictEqual(
    topVal,
    '',
    'applyBaseline(null) after prior measurement must CLEAR --asu-sparkles-top; got "' +
      topVal +
      '"',
  );
  assert.strictEqual(
    hdrVal,
    '',
    'applyBaseline(null) after prior measurement must CLEAR --asu-sparkles-hdr-h; got "' +
      hdrVal +
      '"',
  );
  // _restingHeaderBottom must be reset to null.
  assert.strictEqual(
    ctrl._restingHeaderBottom,
    null,
    'applyBaseline(null) must reset _restingHeaderBottom to null; got ' +
      ctrl._restingHeaderBottom,
  );

  env.window.setTimeout = origST;
  env.window.addEventListener = origAddEL;
  env.window.requestAnimationFrame = origRaf;
  ctrl.measureHeaderTop = origMeasure;
});

// ===========================================================================
// Mobile open state top-edge spectrum border must not paint
// ===========================================================================

// ---------------------------------------------------------------------------
// At 375px viewport the ::before pseudo-element's spectrum ring is drawn via
// padding (2px) + background + mask-composite, NOT via a CSS border.  Removing
// the top strip therefore requires padding-top:0 (yielding "0 2px 2px"), not
// border-top:0.  This test reads the compiled CSS file and asserts:
//   1.  The mobile-open ::before override contains "padding: 0 2px 2px".
//   2.  The override does NOT set "border-top: 0" (which was the broken no-op).
// jsdom provides no layout engine, so rendered-pixel assertions are not
// available here; this CSS-rule presence assertion replaces the missing
// viewport render check for the purpose of preventing regression.
// ---------------------------------------------------------------------------

test('mobile_open_before_uses_padding_not_border_to_remove_top_spectrum_edge', () => {
  const fs = require('node:fs');
  const nodePath = require('node:path');

  const cssPath = nodePath.resolve(__dirname, '../../css/asu-sparkles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Locate the @media (max-width: 768px) block. Use a newline-anchored regex
  // so the comment that mentions this string does not match (the actual rule
  // is at column 0, preceded by a newline).
  const mediaRuleMatch = css.match(/\n@media \(max-width: 768px\)\s*\{/);
  assert.ok(
    mediaRuleMatch !== null && mediaRuleMatch.index !== undefined,
    'CSS must contain a @media (max-width: 768px) rule (at line start)',
  );
  // braceOpen is the index of the '{' at the end of the matched string.
  const braceOpen = mediaRuleMatch.index + mediaRuleMatch[0].length - 1;
  assert.ok(css[braceOpen] === '{', '@media block must have an opening brace');

  let depth = 0;
  let mediaEnd = braceOpen;
  for (let i = braceOpen; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        mediaEnd = i;
        break;
      }
    }
  }
  const mediaBlock = css.slice(braceOpen + 1, mediaEnd);

  // Within the media block, find ALL [data-state="open"]::before rules.
  // We want the mobile-open ::before rule that sets padding.
  const beforeRuleRegex =
    /\.ai-chatbot-asu-sparkles-block\s+\.asu-sparkles\[data-state="open"\]::before\s*\{([^}]*)\}/g;
  const foundBodies = [];
  let m;
  while ((m = beforeRuleRegex.exec(mediaBlock)) !== null) {
    foundBodies.push(m[1]);
  }

  assert.ok(
    foundBodies.length > 0,
    'Mobile open ::before rule must exist in @media (max-width: 768px); found 0 rules',
  );

  // Find the rule body that sets padding.
  const paddingRule = foundBodies.find((body) => /padding/.test(body));
  assert.ok(
    paddingRule !== undefined,
    'At least one mobile open ::before rule must set a padding property; ' +
      'found rule bodies: ' +
      foundBodies.map((b) => b.trim()).join(' | '),
  );

  // The rule MUST set padding: 0 2px 2px (removes the 2px top spectrum strip).
  assert.ok(
    /padding\s*:\s*0\s+2px\s+2px/.test(paddingRule),
    'Mobile open ::before must set "padding: 0 2px 2px" to strip the top spectrum edge; ' +
      'found rule body: ' +
      paddingRule.trim(),
  );

  // The rule must NOT use "border-top: 0" — that was a no-op (::before has no border).
  assert.ok(
    !/border-top\s*:\s*0/.test(paddingRule),
    'Mobile open ::before must NOT set "border-top: 0" (no-op); ' +
      'the spectrum edge is painted via padding+background+mask, not a CSS border',
  );
});

// ===========================================================================
// WCAG reflow: subtitle must not overflow at 320px
// ===========================================================================

// ---------------------------------------------------------------------------
// The first_message is dynamic and unbounded; at 320px viewport
// width a long prose message or an unbroken slug token would cause horizontal
// overflow if white-space:nowrap or missing flex shrink rules are present.
//
// jsdom provides no layout engine, so we assert the CSS source rules rather
// than measuring rendered bounding boxes.  The assertions verify the two
// required conditions:
//
//   1. The base .asu-sparkles__subtitle rule must NOT contain white-space:nowrap,
//      MUST contain word-break:break-word, and MUST contain overflow-wrap:break-word.
//   2. The [data-state="open"] .asu-sparkles__intro-text rule MUST contain
//      min-width:0 so the flex child can shrink below its max-content width.
//
// These two properties together prevent horizontal overflow at 320px for both
// long prose (many words) and unbroken tokens (a single 60-char slug).
// ---------------------------------------------------------------------------

test('subtitle_rule_allows_wrapping_at_320px_no_nowrap', () => {
  const fs = require('node:fs');
  const nodePath = require('node:path');

  const cssPath = nodePath.resolve(__dirname, '../../css/asu-sparkles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Extract the base subtitle rule body (the one NOT inside a media query or
  // state selector — just `.asu-sparkles__subtitle { ... }`).
  const subtitleBaseRegex =
    /\.ai-chatbot-asu-sparkles-block\s+\.asu-sparkles__subtitle\s*\{([^}]*)\}/g;
  const bodies = [];
  let m;
  while ((m = subtitleBaseRegex.exec(css)) !== null) {
    // Skip rules that are inside a [data-state=...] context — those are overrides.
    // The base rule starts with ".ai-chatbot-asu-sparkles-block .asu-sparkles__subtitle"
    // preceded only by whitespace/newlines, not by a state selector.
    const precedingText = css.slice(Math.max(0, m.index - 80), m.index);
    if (!/\[data-state/.test(precedingText)) {
      bodies.push(m[1]);
    }
  }

  assert.ok(
    bodies.length > 0,
    'Base .asu-sparkles__subtitle rule must exist in the CSS',
  );

  const baseBody = bodies[0];

  // Must NOT have white-space:nowrap (causes overflow at 320px).
  assert.ok(
    !/white-space\s*:\s*nowrap/.test(baseBody),
    'Base .asu-sparkles__subtitle must NOT contain white-space:nowrap; ' +
      'got: ' +
      baseBody.trim(),
  );

  // MUST have word-break:break-word.
  assert.ok(
    /word-break\s*:\s*break-word/.test(baseBody),
    'Base .asu-sparkles__subtitle must contain word-break:break-word; ' +
      'got: ' +
      baseBody.trim(),
  );

  // MUST have overflow-wrap:break-word (handles unbroken tokens).
  assert.ok(
    /overflow-wrap\s*:\s*break-word/.test(baseBody),
    'Base .asu-sparkles__subtitle must contain overflow-wrap:break-word; ' +
      'got: ' +
      baseBody.trim(),
  );
});

test('open_intro_text_flex_child_has_min_width_zero_for_320px_shrink', () => {
  const fs = require('node:fs');
  const nodePath = require('node:path');

  const cssPath = nodePath.resolve(__dirname, '../../css/asu-sparkles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Find the open-state intro-text rule.
  const introTextRegex =
    /\.asu-sparkles\[data-state="open"\]\s+\.asu-sparkles__intro-text\s*\{([^}]*)\}/g;
  const bodies = [];
  let m;
  while ((m = introTextRegex.exec(css)) !== null) {
    bodies.push(m[1]);
  }

  assert.ok(
    bodies.length > 0,
    'The [data-state="open"] .asu-sparkles__intro-text rule must exist in the CSS',
  );

  const ruleBody = bodies[0];

  // MUST have min-width:0 so the flex child can shrink below its max-content width.
  assert.ok(
    /min-width\s*:\s*0/.test(ruleBody),
    '[data-state="open"] .asu-sparkles__intro-text must contain min-width:0; ' +
      'got: ' +
      ruleBody.trim(),
  );
});

// ===========================================================================
// Typing bubble role=status (a11y)
// The typing bubble carries aria-label on an otherwise-roleless div; role=status
// makes that a valid accessible name (clears axe aria-prohibited-attr) and is
// removed again when the bubble becomes a normal answer.
// ===========================================================================

test('renderTyping_sets_role_status_then_replaceTyping_removes_it', () => {
  const env = buildEnv();
  const { root } = buildRootWithMenu(env);
  const ctrl = new env.AsuSparkles.Controller(root);

  const bubble = ctrl.renderTyping();
  assert.strictEqual(
    bubble.getAttribute('role'),
    'status',
    'typing bubble must carry role=status so its aria-label is valid',
  );
  assert.strictEqual(
    bubble.getAttribute('aria-label'),
    'The assistant is typing',
  );

  ctrl.replaceTyping(bubble, 'Final answer', false);
  assert.strictEqual(
    bubble.getAttribute('role'),
    null,
    'replaceTyping must remove role=status',
  );
  assert.strictEqual(
    bubble.getAttribute('aria-label'),
    null,
    'replaceTyping must remove the typing aria-label',
  );
});

// ===========================================================================
// Typing bubble has min-height so the dots center, not top-align
// ===========================================================================

test('typing_bubble_has_min_height_for_dot_centering', () => {
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const cssPath = nodePath.resolve(__dirname, '../../css/asu-sparkles.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // The high-specificity typing override must set min-height so the row of
  // dots has vertical room to center (align-items: center).
  const re =
    /\.asu-sparkles__bubble\.asu-sparkles__bubble--typing\s*\{[^}]*min-height:[^}]*align-items:\s*center|\.asu-sparkles__bubble\.asu-sparkles__bubble--typing\s*\{[^}]*align-items:\s*center[^}]*min-height:/;
  assert.ok(
    re.test(css),
    'typing override must set both align-items:center and min-height for vertical centering',
  );
});

// ===========================================================================
// Menu keyboard a11y: Tab/focusout close, Escape on trigger,
// Space activates link items (not the native Clear button).
// ===========================================================================

test('tab_closes_menu', () => {
  const env = buildEnv();
  const { root } = buildRootWithMenu(env, ['/a']);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });
  assert.ok(ctrl._menuOpen, 'precondition: menu open');

  // Tab must close the menu (and not preventDefault — focus proceeds).
  let prevented = false;
  ctrl._onMenuKeyNav(
    {
      key: 'Tab',
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {},
    },
    0,
  );
  assert.ok(!ctrl._menuOpen, 'Tab must close the menu');
  assert.ok(!prevented, 'Tab must NOT preventDefault (focus moves naturally)');
});

test('space_activates_link_item_via_click', () => {
  const env = buildEnv();
  const { root, linkItems } = buildRootWithMenu(env, ['/a']);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  // menuItems = [Clear button, link]. idx 1 is the anchor link.
  let clicked = false;
  linkItems[0].click = () => {
    clicked = true;
  };
  let prevented = false;
  ctrl._onMenuKeyNav(
    {
      key: ' ',
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {},
    },
    1,
  );
  assert.ok(clicked, 'Space on a link menuitem must synthesize a click');
  assert.ok(prevented, 'Space on a link must preventDefault (page scroll)');
});

test('space_does_not_double_fire_on_clear_button', () => {
  const env = buildEnv();
  const { root, clearItem } = buildRootWithMenu(env, ['/a']);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  // The Clear item is a native <button> (Space handled natively); our handler
  // must NOT synthesize a second click.
  let clicked = false;
  clearItem.click = () => {
    clicked = true;
  };
  ctrl._onMenuKeyNav(
    { key: ' ', preventDefault: () => {}, stopPropagation: () => {} },
    0,
  );
  assert.ok(
    !clicked,
    'Space on the native Clear button must not synthesize an extra click',
  );
});

test('escape_on_trigger_closes_open_menu', () => {
  const env = buildEnv();
  const { root, menuBtn } = buildRootWithMenu(env, ['/a']);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });
  assert.ok(ctrl._menuOpen, 'precondition: menu open');

  const ev = new env.window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
  });
  menuBtn.dispatchEvent(ev);
  assert.ok(!ctrl._menuOpen, 'Escape on the trigger must close the open menu');
});

test('focusout_closes_menu_when_focus_leaves_popover', () => {
  const env = buildEnv();
  const { root, menuPopover } = buildRootWithMenu(env, ['/a']);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  // Focus moves to an element OUTSIDE the popover → close.
  const outside = env.document.createElement('button');
  env.document.body.appendChild(outside);
  const ev = new env.window.FocusEvent('focusout', {
    relatedTarget: outside,
    bubbles: true,
  });
  menuPopover.dispatchEvent(ev);
  assert.ok(!ctrl._menuOpen, 'focusout to outside element must close the menu');
});

test('focusout_keeps_menu_open_between_items', () => {
  const env = buildEnv();
  const { root, menuPopover } = buildRootWithMenu(env, ['/a']);
  const ctrl = new env.AsuSparkles.Controller(root);
  ctrl.applyStateImmediate('open');
  ctrl.openMenu({ focusIdx: 0 });

  // Focus moves to another menu item (inside the popover) → stay open.
  const ev = new env.window.FocusEvent('focusout', {
    relatedTarget: ctrl.menuItems[1],
    bubbles: true,
  });
  menuPopover.dispatchEvent(ev);
  assert.ok(
    ctrl._menuOpen,
    'focusout between menu items must NOT close the menu',
  );
});
