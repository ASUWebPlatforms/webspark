/**
 * @file
 * Behaviour for the "ASU sparkles" AI chatbot placement.
 *
 * Drives a small state machine on the widget root (data-state =
 * collapsed | open | compact), persists the state to
 * localStorage, and wires the collapsed "ring" input, preset-question
 * chips and header controls. The conversation itself (talking to the
 * ai_chatbot /api/deepchat endpoint) is layered on in a later step via
 * Controller.sendToBackend(); scroll compaction and the data layer are
 * layered on top of the same controller.
 *
 * Controller.setState is a motion dispatcher (MORPH / CROSSFADE / INSTANT
 * paths). Backend, data-layer, scroll-compaction, CSRF, SSE, and
 * clearConversation code is unchanged.
 */
(function (Drupal, drupalSettings, once) {
  /* global DOMPurify */
  const STORAGE_KEY = 'Drupal.asuSparkles.state';

  // Hard cap on the should_continue agent loop (max follow-up POSTs
  // per user turn). A turn can render up to CONTINUATION_LIMIT+1 server HTML
  // strings before the cap trips and surfaces an error bubble.
  const CONTINUATION_LIMIT = 10;

  // -------------------------------------------------------------------------
  // sanitizeHtml + fallback scrubber (XSS hardening).
  //
  // Allowlist mirrors contrib DeepChatApi::$allowedTags verbatim (21 tags).
  // 'span'/'div' intentionally omitted — CommonMark output uses only block-
  // level tags; the owned copy <button> is built via createElement AFTER
  // sanitize sets innerHTML, so the sanitizer never sees it.
  // -------------------------------------------------------------------------
  const ALLOWED_TAGS = [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'del',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    'strong',
    'ul',
  ];

  // Mirror server attr set (DeepChatApi::$allowedAttr): href, src, alt, title.
  // DOMPurify defaults still strip `on*` and unsafe URI schemes.
  const ALLOWED_ATTR = ['href', 'src', 'alt', 'title'];

  /**
   * Fallback HTML scrubber — used only when DOMPurify is absent.
   *
   * Uses an inert DOMParser document to parse, then walks the tree
   * depth-first and either keeps allowlisted elements (stripping bad attrs)
   * or replaces disallowed elements with their text content.
   *
   * @param {string} html
   *   The raw HTML string to scrub.
   * @return {string}
   *   Scrubbed HTML safe to assign to innerHTML.
   */
  function fallbackSanitize(html) {
    const doc = document.implementation.createHTMLDocument('sanitize');
    const { body } = doc;
    body.innerHTML = String(html);
    const allowTags = new Set(
      ALLOWED_TAGS.map(function (t) {
        return t.toUpperCase();
      }),
    );
    const allowAttrs = new Set(ALLOWED_ATTR);
    // Normalize URL attr values before scheme testing so that
    // tab/newline/control-char-obfuscated schemes (e.g. "java\tscript:") are
    // rejected. Strip ALL ASCII whitespace and control chars (\x00-\x1F),
    // then lowercase before the denylist check. No decoding — just normalize.
    function normalizeUrl(val) {
      return String(val)
        .replace(/[\x00-\x1F\s\uFFFD]/g, '') // eslint-disable-line no-control-regex
        .toLowerCase();
    }
    // eslint-disable-next-line no-script-url
    const UNSAFE_SCHEMES = ['javascript:', 'vbscript:', 'data:'];
    // Walk depth-first; collect nodes first so mutations don't confuse walker.
    const walker = doc.createTreeWalker(
      body,
      /* NodeFilter.SHOW_ELEMENT = */ 1,
      null,
      false,
    );
    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    // Process in reverse so parent replacements don't invalidate child refs.
    nodes
      .slice()
      .reverse()
      .forEach(function (el) {
        if (!allowTags.has(el.nodeName)) {
          if (el.parentNode) {
            const text = doc.createTextNode(el.textContent || '');
            el.parentNode.replaceChild(text, el);
          }
          return;
        }
        // Attribute scrub.
        Array.prototype.slice.call(el.attributes).forEach(function (attr) {
          const name = attr.name.toLowerCase();
          if (name.indexOf('on') === 0 || !allowAttrs.has(name)) {
            el.removeAttribute(attr.name);
            return;
          }
          if (
            (name === 'href' || name === 'src' || name === 'xlink:href') &&
            UNSAFE_SCHEMES.some(function (s) {
              return normalizeUrl(attr.value).startsWith(s);
            })
          ) {
            el.removeAttribute(attr.name);
          }
        });
      });
    return body.innerHTML;
  }

  // -------------------------------------------------------------------------
  // Entry-state persistence control.
  //
  // When TRUE, the widget restores the persisted state on page load
  // (pre-entry-persistence behavior). When FALSE, every page load starts in
  // 'collapsed' and lets the scroll-compaction handler silently derive
  // 'compact' if the page is already scrolled past the trigger.
  //
  // The human may change their mind — this is intentionally a one-line
  // flip. Flipping to TRUE requires no other code change: readState()
  // will begin honoring the stored value, and writeState() has been
  // writing to localStorage all along for exactly this reason.
  // -------------------------------------------------------------------------
  const PERSIST_ENTRY_STATE = false;

  // Single-source the phone breakpoint so JS matches the CSS
  // @media (max-width: 768px) rule in css/asu-sparkles.css. The header gap is
  // 48px on desktop and 16px on phone. Keep these in sync with the stylesheet.
  const PHONE_MAX_WIDTH_PX = 768;
  const HEADER_GAP_DESKTOP_PX = 48;
  const HEADER_GAP_PHONE_PX = 16;

  /**
   * Reads the persisted widget state.
   *
   * When PERSIST_ENTRY_STATE is FALSE (default), always returns
   * 'collapsed' so the widget enters the ring on every load. The
   * scroll-compaction handler may silently derive 'compact' afterward.
   *
   * @return {string}
   *   One of collapsed|open|compact.
   */
  function readState() {
    if (!PERSIST_ENTRY_STATE) {
      return 'collapsed';
    }
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // 'closed' is folded into 'compact'; coerce any legacy value.
      if (stored === 'closed') {
        return 'compact';
      }
      return stored || 'collapsed';
    } catch (e) {
      return 'collapsed';
    }
  }

  /**
   * Persists the widget state.
   *
   * @param {string} state
   *   The state to store.
   */
  function writeState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, state);
    } catch (e) {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }

  /**
   * Pushes an ASU Enterprise data-layer event.
   *
   * Follows the ASU web data-layer standard: a guarded push to the global
   * dataLayer (created by GTM; guarded here only so a missing container does
   * not throw) with the eight standard keys, all lowercase and trimmed.
   *
   * @param {object} data
   *   Overrides for the standard keys (event, action, name, type, region,
   *   section, text, component).
   */
  function pushDataLayer(data) {
    try {
      window.dataLayer = window.dataLayer || [];
      const payload = {
        event: '',
        action: '',
        name: '',
        type: '',
        region: 'main content',
        section: '',
        text: '',
        component: '',
      };
      Object.keys(data).forEach(function (key) {
        payload[key] =
          typeof data[key] === 'string'
            ? data[key].toLowerCase().trim()
            : data[key];
      });
      window.dataLayer.push(payload);
    } catch (e) {
      // Never let analytics break the widget.
    }
  }

  /**
   * Reads a Server-Sent Events response body into a normalized result.
   *
   * The ai_chatbot streaming endpoint emits `data: {html, overwrite}` lines;
   * overwrite chunks replace the running HTML, others are appended.
   *
   * @param {Response} response
   *   The fetch Response with a readable SSE body.
   *
   * @return {Promise<object>}
   *   Resolves with { html }.
   */
  function readSseStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let html = '';

    function processEvent(block) {
      block.split('\n').forEach(function (line) {
        if (line.indexOf('data:') !== 0) {
          return;
        }
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          return;
        }
        try {
          const data = JSON.parse(payload);
          if (typeof data.html === 'string') {
            html = data.overwrite ? data.html : html + data.html;
          }
        } catch (e) {
          // Ignore malformed chunks.
        }
      });
    }

    function pump() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (buffer.trim()) {
            processEvent(buffer);
          }
          return { html };
        }
        buffer += decoder.decode(result.value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          processEvent(buffer.slice(0, index));
          buffer = buffer.slice(index + 2);
        }
        return pump();
      });
    }

    return pump();
  }

  /**
   * Controls a single ASU sparkles widget instance.
   *
   * @param {HTMLElement} root
   *   The widget root (.asu-sparkles).
   */
  function Controller(root) {
    this.root = root;
    this.form = root.querySelector('.asu-sparkles__form');
    this.input = root.querySelector('.asu-sparkles__input');
    this.log = root.querySelector('.asu-sparkles__log');
    this.live = root.querySelector('.asu-sparkles__live');
    this.closeBtn = root.querySelector('.asu-sparkles__close');
    this.clearBtn = root.querySelector('.asu-sparkles__clear');
    this.sendBtn = root.querySelector('.asu-sparkles__send');
    this.fab = root.querySelector('.asu-sparkles__fab');
    // Ellipsis menu elements.
    this.menuBtn = root.querySelector('.asu-sparkles__menu');
    this.menuPopover = root.querySelector('.asu-sparkles__menu-popover');
    this.menuItems = Array.prototype.slice.call(
      root.querySelectorAll(
        '.asu-sparkles__menu-popover .asu-sparkles__menu-item',
      ),
    );
    // Chips live inside the log; scope the lookup to the log.
    this.chips = Array.prototype.slice.call(
      root.querySelectorAll('.asu-sparkles__log .asu-sparkles__chip'),
    );
    this.section = (
      root.getAttribute('data-datalayer-section') || 'welcome'
    ).toLowerCase();
    this.sendTypedText = root.getAttribute('data-send-typed-text') === '1';
    this.state = 'collapsed';
    // Internal timers for the motion orchestration.
    this._fadeTimer = null;
    this._reflowTimer = null;
    // Pending target of the in-flight crossfade, or null when none is queued.
    // Invariant: _pendingState is null iff _fadeTimer is null.
    this._pendingState = null;
    // Callback queued to run after the next applyStateImmediate() commit.
    // Used to deliver keyboard focus once a crossfade has unhidden its target.
    this._focusAfterCommit = null;
    // One-shot guard: set to TRUE immediately before a programmatic
    // input.focus() triggered by the close path (collapsed focus-back).
    // The input 'focus' listener checks this and suppresses the auto-open
    // so keyboard close-at-top does not immediately reopen the widget.
    this._suppressInputOpen = false;
    // Monotonic counter incremented on every clearConversation() call and on
    // every new submitQuery() so a delayed reset-session response that arrives
    // after the user has started a new conversation cannot erase it.
    this._resetGeneration = 0;
    // Set TRUE by clearConversation() after the UI has been deterministically
    // rebuilt. Causes seedFirstMessage() to skip replaying the page-baked
    // drupalSettings.ai_deepchat.messages history, because the server session
    // was reset and those messages are stale. Reset to FALSE on the next
    // submitQuery() so a new conversation can be seeded normally if the page
    // is reloaded (or if the page-load messages are valid for a fresh init).
    this._historyCleared = false;
    // Header-measurement resize listener + debounce handle, stored
    // for teardown in Drupal.behaviors.detach / destroyHeaderMeasurement().
    this._resizeHandler = null;
    this._resizeDebounce = null;
    // Reset-gate flag + AbortControllers for teardown/abort.
    // resetting: true while a reset-session roundtrip is in flight.
    this.resetting = false;
    // AbortController for the active submit's postMessage chain.
    this._abortController = null;
    // AbortController for the active reset-session fetch.
    this._resetAbortController = null;
    // Timeout handle + timed-out generation tag.
    this._resetTimer = null;
    this._resetTimedOutGen = null;
    // Once-per-generation settle tracker.
    // _resetSettledGen holds the generation number that has already been
    // terminally settled by _finishReset(), so a second settle call for the
    // same generation (e.g. late success body after timeout) is a no-op.
    this._resetSettledGen = null;
    // Armed by a ellipsis-menu Clear so _finishReset() re-focuses the ring
    // input once the reset re-enables it (synchronous focus fails while the
    // input is disabled during the reset window).
    this._focusRingInputAfterReset = false;
    // Teardown flag: set TRUE before aborting in detach so
    // the resulting AbortError stays SILENT (widget is being torn down).
    this._detaching = false;
    // Open-height teardown handles (stored by initOpenHeightTracking).
    this._logObserver = null;
    this._rootObserver = null;
    this._transitionEndHandler = null;
    this._openHeightResizeHandler = null;
    // Header ResizeObserver on the resolved anchor element.
    // The old _toolbarResizeObserver and _scrollHandler are removed; toolbar is
    // now detected via body classes and the body-class MutationObserver.
    this._headerResizeObserver = null;
    this._bodyClassObserver = null;
    // Pinned/shrink-only latch. Stores the resting header
    // bottom after the last baseline event (initial, resize, body-mutation, load).
    // The header ResizeObserver is shrink-only: grow-back events are ignored so
    // the widget stays pinned to the contracted (smallest observed) header bottom.
    this._restingHeaderBottom = null;
    // Visibility gate: widget is hidden until first measurement.
    this._headerMeasured = false;
    // Teardown guard: set true in destroyHeaderMeasurement so that
    // queued rAF and window.load callbacks do not create new ResizeObservers
    // on an already-detached controller (prevents observer leak after detach).
    this._measurementDestroyed = false;
    // Add the visibility gate class immediately before first layout so the
    // widget is hidden during the measurement race (no visible jump).
    root.classList.add('asu-sparkles--measuring');
    // Ellipsis menu sub-state.
    this._menuOpen = false;
    this._menuFocusIdx = 0;
    this._menuOutsideHandler = null;
    this.init();
  }

  Controller.prototype.init = function () {
    const self = this;

    if (this.form) {
      this.form.addEventListener('submit', function (event) {
        event.preventDefault();
        self.submitQuery(self.input ? self.input.value : '', 'typed');
      });
    }

    // Focusing the ring input expands the widget.
    // _suppressInputOpen: one-shot guard set by the close handler immediately
    // before the programmatic post-close input.focus() call so that the
    // auto-open does NOT fire for that synthetic focus. A real user focus
    // or click clears the flag and opens normally. The flag is also
    // defensively cleared on pointer/keydown so it can never get stuck.
    if (this.input) {
      this.input.addEventListener('focus', function () {
        if (self._suppressInputOpen) {
          self._suppressInputOpen = false;
          return;
        }
        if (self.state === 'collapsed' || self.state === 'compact') {
          self.setState('open');
        }
      });
      // Defensive: clear on any user interaction so the flag can't get stuck.
      this.input.addEventListener('pointerdown', function () {
        self._suppressInputOpen = false;
      });
      this.input.addEventListener('keydown', function () {
        self._suppressInputOpen = false;
      });
    }

    this.chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        // Defence-in-depth guard.
        // _setResettingUi(true) already sets chip.disabled, but a synthetic
        // or keyboard-driven click can still fire on a disabled <button> in
        // some browsers. Guard explicitly so no analytics/populate/submit can
        // fire during reset even via programmatic dispatch.
        if (self.resetting) {
          return;
        }
        const text =
          chip.getAttribute('data-question-text') || chip.textContent;
        const label = (chip.textContent || '').trim();
        if (!self.input) {
          return;
        }
        // Populate the input and give it focus so the user can edit before
        // submitting; do NOT call submitQuery here. The data-layer click
        // event still fires on populate (populate IS the interaction).
        self.input.value = text;
        // Fire the preset data-layer event on populate.
        self.onSubmit(text, 'preset', label);
        // Make sure the panel is open so the populated input is visible.
        if (self.state === 'collapsed' || self.state === 'compact') {
          self.setState('open');
        }
        self.input.focus();
        // Place caret at end of the populated text so the user can keep typing.
        const end = self.input.value.length;
        try {
          self.input.setSelectionRange(end, end);
        } catch (e) {
          // Some input types don't support setSelectionRange — guard
          // defensively. The populate + focus still works.
        }
      });
    });

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', function () {
        self.collapseToRingWithFocus();
      });
    }

    if (this.fab) {
      this.fab.addEventListener('click', function () {
        self.setState('open');
        if (self.input) {
          self.input.focus();
        }
      });
    }

    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', function () {
        self.clearConversation();
      });
    }

    // Ellipsis menu trigger and item bindings.
    if (this.menuBtn) {
      this.menuBtn.addEventListener('click', function onMenuBtnClick(e) {
        e.stopPropagation();
        if (self._menuOpen) {
          self.closeMenu({ restoreFocus: true });
        } else {
          self.openMenu({ focusIdx: 0 });
        }
      });
      this.menuBtn.addEventListener('keydown', function onMenuBtnKeydown(e) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          self.openMenu({ focusIdx: 0 });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          self.openMenu({ focusIdx: self.menuItems.length - 1 });
        } else if (e.key === 'Escape' && self._menuOpen) {
          // When focus is on the trigger while the menu is open
          // (e.g. Shift+Tab back to it), Escape must close the popover. The
          // root-level Escape handler defers to this when _menuOpen is true.
          e.preventDefault();
          self.closeMenu({ restoreFocus: true });
        }
      });
    }
    self.menuItems.forEach(function bindMenuItemEvents(item, idx) {
      item.addEventListener('click', function onMenuItemClick() {
        self._onMenuItemActivate(item);
      });
      item.addEventListener('keydown', function onMenuItemKeydown(e) {
        self._onMenuKeyNav(e, idx);
      });
    });

    // Escape collapses an expanded widget back to the ring or FAB.
    // Routes through collapseToRingWithFocus() — the same shared helper
    // used by the close button — so the _suppressInputOpen guard fires
    // for both paths and Escape never triggers an auto-reopen.
    // Ellipsis menu guard: when the ellipsis menu is open, Escape is handled
    // by the menu's own handler (closeMenu); it must NOT also collapse the
    // widget panel on the same keypress.
    this.root.addEventListener('keydown', function (event) {
      if (
        event.key === 'Escape' &&
        (self.state === 'open' || self.state === 'compact')
      ) {
        // Defer to menu's Escape handler when menu is open.
        if (self._menuOpen) {
          return;
        }
        event.preventDefault();
        self.collapseToRingWithFocus();
      }
    });

    // Expose chat disclosure state via fab aria-controls.
    // Give the conversation log a stable id so aria-controls can reference it.
    // Drupal.Html.getUniqueId is always present when Drupal.behaviors run, but
    // guard defensively in case the file is exercised outside Drupal context.
    if (this.log && !this.log.id) {
      this.log.id =
        Drupal.Html && Drupal.Html.getUniqueId
          ? Drupal.Html.getUniqueId('asu-sparkles-log')
          : 'asu-sparkles-log';
    }
    // Point the FAB's aria-controls at the log so AT announces the relationship.
    if (this.fab && this.log) {
      this.fab.setAttribute('aria-controls', this.log.id);
    }

    // Restore the persisted state without replaying the transition.
    this.setState(readState(), { restore: true });

    // Seed the opener / replay history now that state is applied.
    this.seedFirstMessage();

    window.addEventListener(
      'load',
      function () {
        document.documentElement.classList.remove('asu-sparkles-restoring');
      },
      { once: true },
    );

    this.initScrollCompaction();
    // Motion lifecycle: keep --asu-sparkles-open-h current while open.
    this.initOpenHeightTracking();
    // Measure the real page header height and set --asu-sparkles-top
    // so the widget clears the header in ring, open, and compact states.
    this.initHeaderMeasurement();

    // Re-measure the open height after web fonts load so a late
    // font-metric change (FOIT→FOUT swap) does not leave the panel undersized.
    // Guard: only when open, not under reduced-motion-instant restore.
    if (typeof document.fonts !== 'undefined' && document.fonts.ready) {
      const self2 = this;
      document.fonts.ready.then(function () {
        if (self2.state === 'open' && !self2.reducedMotion()) {
          self2.fitOpen();
        }
      });
    }
  };

  /**
   * Compacts the idle widget when the page scrolls past a configured element.
   *
   * The trigger is a CSS selector stored on the widget root
   * (data-scroll-trigger). Only the idle "collapsed" state auto-compacts (and
   * restores), so an open conversation is never disrupted.
   * These transitions are silent: they are not persisted and emit no
   * data-layer event.
   */
  Controller.prototype.initScrollCompaction = function () {
    const selector = this.root.getAttribute('data-scroll-trigger');
    if (!selector || !('IntersectionObserver' in window)) {
      return;
    }

    let target;
    try {
      target = document.querySelector(selector);
    } catch (e) {
      // Invalid selector; disable compaction.
      return;
    }
    if (!target) {
      return;
    }

    const self = this;
    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          const scrolledPast =
            !entry.isIntersecting && entry.boundingClientRect.top < 0;
          if (scrolledPast && self.state === 'collapsed') {
            self.setState('compact', { silent: true });
          } else if (entry.isIntersecting && self.state === 'compact') {
            self.setState('collapsed', { silent: true });
          }
        });
      },
      { threshold: 0 },
    );

    observer.observe(target);
  };

  /**
   * Returns TRUE when the OS has requested reduced motion.
   *
   * @return {boolean}
   */
  Controller.prototype.reducedMotion = function () {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  };

  /**
   * Returns TRUE when the configured scroll-compaction trigger is above the
   * viewport (fully scrolled past). Matches the IntersectionObserver
   * convention used by initScrollCompaction. When no trigger is configured
   * or the selector resolves to nothing, returns FALSE.
   *
   * @return {boolean}
   */
  Controller.prototype.isScrolledPastTrigger = function () {
    const selector = this.root.getAttribute('data-scroll-trigger');
    if (!selector) {
      return false;
    }
    let target;
    try {
      target = document.querySelector(selector);
    } catch (e) {
      return false;
    }
    if (!target) {
      return false;
    }
    const rect = target.getBoundingClientRect();
    // "Past" = the trigger is fully above the viewport.
    return rect.bottom <= 0;
  };

  /**
   * Collapses the widget back to the ring (or FAB when scrolled past the
   * trigger) and moves keyboard focus to the appropriate idle control,
   * WITHOUT triggering the input's auto-open listener.
   *
   * This is the single, shared helper for every "collapse and hand focus
   * back" path — the × close button AND the Escape key — so no trigger
   * can miss the _suppressInputOpen guard. DRY invariant: any future
   * collapse-to-ring trigger MUST call this method rather than inline the
   * pattern, to guarantee the guard fires.
   *
   * Behaviour:
   *   - Scrolled past the trigger → 'compact': focus goes to the FAB.
   *   - Not scrolled (or no trigger configured) → 'collapsed': focus goes
   *     to the ring input. _suppressInputOpen is set TRUE immediately
   *     before that programmatic focus so the input's 'focus' listener
   *     treats it as synthetic and does not reopen the panel.
   *
   * Keyboard contract: collapse and hand focus back.
   */
  Controller.prototype.collapseToRingWithFocus = function () {
    const self = this;
    const target = this.isScrolledPastTrigger() ? 'compact' : 'collapsed';

    // Queue post-commit focus BEFORE setState so the callback is
    // present when applyStateImmediate runs (immediately for the
    // INSTANT/reduced-motion path, or inside the 120ms crossfade
    // callback for the CROSSFADE path). This guarantees the FAB or
    // ring input is focusable (hidden attribute removed) when focus
    // is delivered — regardless of whether the motion is animated or
    // instant.
    if (target === 'compact' && this.fab) {
      this._focusAfterCommit = function () {
        self.fab.focus();
      };
    } else if (this.input) {
      this._focusAfterCommit = function () {
        // Suppress the auto-open triggered by this programmatic focus.
        // The input's 'focus' listener checks _suppressInputOpen and
        // returns early, so keyboard collapse-at-top lands on 'collapsed'
        // (ring visible, focus on input) without reopening the panel.
        self._suppressInputOpen = true;
        self.input.focus();
      };
    }

    this.setState(target);
  };

  /**
   * Applies the state attribute and hidden flags synchronously, without any
   * motion. Called at the end of every motion path (INSTANT, MORPH, CROSSFADE).
   *
   * @param {string} state
   *   One of collapsed|open|compact.
   */
  Controller.prototype.applyStateImmediate = function (state) {
    this.state = state;
    this.root.setAttribute('data-state', state);

    // Proactively clear the measured open-height on every
    // exit from 'open', so no exit path (INSTANT, MORPH, CROSSFADE)
    // leaves a stale inline --asu-sparkles-open-h that could contaminate
    // the collapsed ring's or compact fab's measured geometry. The async
    // rootObserver clear still runs as a secondary defence.
    if (state !== 'open') {
      this.root.style.removeProperty('--asu-sparkles-open-h');
    }

    const expanded = state === 'open';
    this.toggleHidden(this.closeBtn, !expanded);
    this.toggleHidden(this.clearBtn, !expanded);
    // The 48px fab circle is the compact-ONLY idle-small visual.
    // 'closed' state is removed; fab shows only in 'compact'.
    this.toggleHidden(this.fab, state !== 'compact');
    if (this.fab) {
      this.fab.setAttribute('aria-expanded', 'false');
    }
    // Ellipsis menu button is only visible in open state.
    this.toggleHidden(this.menuBtn, !expanded);
    // Force-close the menu popover whenever leaving open state.
    if (state !== 'open' && this._menuOpen) {
      this.closeMenu({ restoreFocus: false });
    }

    // Deliver any pending post-commit focus now that the target element is
    // visible (hidden attribute removed above). This covers both the
    // CROSSFADE path (focus was deferred from the close handler) and the
    // INSTANT / reduced-motion path (synchronous commit — focus lands
    // immediately after the state is applied).
    if (this._focusAfterCommit) {
      const focusFn = this._focusAfterCommit;
      this._focusAfterCommit = null;
      focusFn();
    }
  };

  /**
   * Pure measurement helper — calculates the open panel height from DOM
   * measurements. Extracted so unit tests can verify the arithmetic without
   * a real layout engine.
   *
   * The chips container lives INSIDE .asu-sparkles__log (chips-first invariant),
   * so log.scrollHeight already includes chips height.
   * Adding chipsH on top was a double-count that produced a spurious empty
   * gap below the input in the empty-state. Single source of truth:
   * h = head.offsetHeight + log.scrollHeight + form.offsetHeight.
   *
   * @param {{ offsetHeight: number }} head
   *   The header element.
   * @param {{ scrollHeight: number }} log
   *   The conversation log element.
   * @param {{ offsetHeight: number }} form
   *   The form element.
   * @return {number}
   *   The computed open panel height in pixels (unrounded).
   */
  function fitOpenMeasure(head, log, form) {
    return head.offsetHeight + log.scrollHeight + form.offsetHeight;
  }

  /**
   * Measures the open panel's natural content height and sets
   * --asu-sparkles-open-h so the CSS height transition eases to it.
   * Desktop-only (phones use a CSS max-height clamp).
   */
  Controller.prototype.fitOpen = function () {
    if (this.state !== 'open' || window.innerWidth <= PHONE_MAX_WIDTH_PX) {
      return;
    }
    const head = this.root.querySelector('.asu-sparkles__head');
    const { form } = this;
    const { log } = this;
    if (!head || !form || !log) {
      return;
    }
    // Chips live inside the log (chips-first invariant); log.scrollHeight
    // already includes them. Removed separate chipsH add to fix empty-state
    // double-count gap. Single source of truth for log content height.
    const h = fitOpenMeasure(head, log, form);
    this.root.style.setProperty('--asu-sparkles-open-h', `${Math.ceil(h)}px`);
  };

  /**
   * Wires up the observers and listeners that keep --asu-sparkles-open-h
   * current while the panel is open, so new messages and viewport resizes
   * ease the height change along with the content.
   */
  Controller.prototype.initOpenHeightTracking = function () {
    if (!this.log || !('MutationObserver' in window)) {
      return;
    }
    const self = this;

    // Re-measure when new messages are appended.
    this._logObserver = new MutationObserver(function () {
      window.requestAnimationFrame(function () {
        self.fitOpen();
      });
    });
    this._logObserver.observe(this.log, { childList: true, subtree: true });

    // Clear --asu-sparkles-open-h when leaving the open state.
    this._rootObserver = new MutationObserver(function () {
      if (self.state !== 'open') {
        self.root.style.removeProperty('--asu-sparkles-open-h');
      } else {
        window.requestAnimationFrame(function () {
          self.fitOpen();
        });
      }
    });
    this._rootObserver.observe(this.root, {
      attributes: true,
      attributeFilter: ['data-state'],
    });

    // Re-measure after the unroll's width/height transition completes.
    // Store named handler so it can be removed in destroyOpenHeightTracking.
    this._transitionEndHandler = function (event) {
      if (
        event.target === self.root &&
        (event.propertyName === 'width' || event.propertyName === 'height')
      ) {
        self.fitOpen();
      }
    };
    this.root.addEventListener('transitionend', this._transitionEndHandler);

    // Re-measure on resize while open.
    // Store named handler so it can be removed in destroyOpenHeightTracking.
    this._openHeightResizeHandler = function () {
      window.requestAnimationFrame(function () {
        self.fitOpen();
      });
    };
    window.addEventListener('resize', this._openHeightResizeHandler);
  };

  /**
   * Tears down all open-height observers and listeners.
   *
   * Idempotent teardown for the four handles stored by
   * initOpenHeightTracking(). Called from Drupal.behaviors.detach on unload
   * to prevent listener accumulation across BigPipe/AJAX re-attaches.
   */
  Controller.prototype.destroyOpenHeightTracking = function () {
    if (this._logObserver) {
      this._logObserver.disconnect();
      this._logObserver = null;
    }
    if (this._rootObserver) {
      this._rootObserver.disconnect();
      this._rootObserver = null;
    }
    if (this._transitionEndHandler && this.root) {
      this.root.removeEventListener(
        'transitionend',
        this._transitionEndHandler,
      );
      this._transitionEndHandler = null;
    }
    if (this._openHeightResizeHandler) {
      window.removeEventListener('resize', this._openHeightResizeHandler);
      this._openHeightResizeHandler = null;
    }
  };

  /**
   * Measures the page's top header stack and returns the bottom edge of the
   * header anchor element (targeted measurement).
   *
   * Strategy (targeted-anchor approach — replaces the previous pass-B heuristic):
   *
   *   ANCHOR: Try an ordered selector list to find the first element that is
   *   not excluded and has a valid visible bounding rect:
   *     1. #asuHeader  (ASU React brand header — fixed, top:79px, scroll-reliable)
   *     2. .uds-header
   *     3. header[role="banner"]
   *     4. #header
   *   Pick the FIRST anchor with rect.height > 0, rect.bottom > 0, and
   *   rect.bottom <= halfViewport. A fixed element's bottom is scroll-reliable
   *   — measure it directly, do NOT infer from an in-flow ancestor.
   *
   *   ADMIN TOOLBAR (via body classes — user requirement):
   *   Detect toolbar presence from document.body.classList:
   *     toolbarPresent = toolbar-fixed | toolbar-horizontal | toolbar-vertical
   *   If present: measure #toolbar-bar bottom. Additionally, if
   *   toolbar-horizontal AND toolbar-tray-open: also union the open tray bottom
   *   (#toolbar-item-administration-tray, fallback .toolbar-tray-open).
   *   A VERTICAL tray is a left sidebar — it adds NO top height.
   *   Union toolbar bottom into headerBottom via Math.max.
   *
   * Exclusions (shared):
   *   - The widget root and any element inside .ai-chatbot-asu-sparkles-block.
   *   - Elements with display:none (checked via isBaseExcluded).
   *
   * Guard: effective bottoms exceeding 50% of the viewport height are treated
   * as full-height overlays and skipped.
   *
   * Returns null when no valid candidate is found (CSS token fallback applies).
   *
   * NOTE: The page-wide `document.querySelectorAll('*')` + getComputedStyle
   * heuristic scan (pass B) has been removed. It was the root cause of the
   * scroll-triggered jump: at scrollY=0 the semantic <header> wrapper correctly
   * unioned #asuHeader (bottom=223) through it; at scrollY>0 the wrapper
   * scrolled off (bottom<0) so its threshold went negative, excluding #asuHeader
   * (top=79 > threshold=-1014). Pass B's rect.top<=4 guard then excluded #asuHeader
   * (top=79>4), leaving only toolbar-bar (40) → top collapsed to 88px (183px jump).
   *
   * @return {number|null}
   *   The effective header bottom in pixels, or null when not determinable.
   */
  Controller.prototype.measureHeaderTop = function () {
    const self = this;
    const halfViewport = window.innerHeight * 0.5;

    /**
     * Returns TRUE when the element is the widget or inside the sparkles
     * block, or has display:none.
     *
     * @param {Element} el
     *   The element to check.
     * @return {boolean}
     *   TRUE when excluded.
     */
    function isBaseExcluded(el) {
      if (el === self.root) {
        return true;
      }
      if (el.closest && el.closest('.ai-chatbot-asu-sparkles-block')) {
        return true;
      }
      let style;
      try {
        style = window.getComputedStyle(el);
      } catch (e) {
        return true;
      }
      return style.display === 'none';
    }

    // --- ANCHOR: ordered selector list -------------------------------------
    // Try each in order; pick the first valid fixed/absolute/positioned header.
    // A fixed element's bottom is scroll-reliable — measure directly.
    const ANCHOR_SELECTORS = [
      '#asuHeader',
      '.uds-header',
      'header[role="banner"]',
      '#header',
    ];

    let headerBottom = 0;
    let found = false;

    for (let i = 0; i < ANCHOR_SELECTORS.length; i++) {
      let el = null;
      try {
        el = document.querySelector(ANCHOR_SELECTORS[i]);
      } catch (e) {
        // Skip invalid selectors.
      }
      if (el && !isBaseExcluded(el)) {
        const rect = el.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > 0 && rect.bottom <= halfViewport) {
          headerBottom = rect.bottom;
          found = true;
          break;
        }
      }
    }

    // --- ADMIN TOOLBAR via body classes ------------------------------------
    // Detect toolbar presence from document.body.classList (body-class strategy
    // is scroll-reliable and catches tray toggles that move #asuHeader's position
    // but do not change its size, so a size-only ResizeObserver would miss them).
    const cl = document.body.classList;
    const toolbarPresent =
      cl.contains('toolbar-fixed') ||
      cl.contains('toolbar-horizontal') ||
      cl.contains('toolbar-vertical');

    if (toolbarPresent) {
      // Measure #toolbar-bar bottom.
      const toolbarBar = document.querySelector('#toolbar-bar');
      if (toolbarBar && !isBaseExcluded(toolbarBar)) {
        const tbRect = toolbarBar.getBoundingClientRect();
        if (
          tbRect.height > 0 &&
          tbRect.bottom > 0 &&
          tbRect.bottom <= halfViewport
        ) {
          headerBottom = Math.max(headerBottom, tbRect.bottom);
          found = true;
        }
      }

      // Only union the HORIZONTAL open tray (vertical = left sidebar, no top height).
      if (
        cl.contains('toolbar-horizontal') &&
        cl.contains('toolbar-tray-open')
      ) {
        const trayEl =
          document.querySelector('#toolbar-item-administration-tray') ||
          document.querySelector('.toolbar-tray-open');
        if (trayEl && !isBaseExcluded(trayEl)) {
          const trayRect = trayEl.getBoundingClientRect();
          if (
            trayRect.height > 0 &&
            trayRect.bottom > 0 &&
            trayRect.bottom <= halfViewport
          ) {
            headerBottom = Math.max(headerBottom, trayRect.bottom);
            found = true;
          }
        }
      }
    }

    return found ? headerBottom : null;
  };

  /**
   * Resolves the anchor header element for targeted measurement.
   *
   * Returns the first element from the ordered selector list that passes the
   * validity checks (not excluded, height > 0, bottom > 0, bottom <= halfViewport).
   * Returns null when no valid anchor is found.
   *
   * Used by initHeaderMeasurement() to attach the shrink-only ResizeObserver.
   * @return {Element|null}
   *   The anchor element, or null when no valid candidate is found.
   */
  Controller.prototype._resolveAnchorEl = function _resolveAnchorEl() {
    const self = this;
    const halfViewport = window.innerHeight * 0.5;

    /**
     * Returns TRUE when the element is excluded from anchor consideration.
     *
     * @param {Element} el
     *   The element to check.
     * @return {boolean}
     *   TRUE when excluded.
     */
    function isExcluded(el) {
      if (el === self.root) {
        return true;
      }
      if (el.closest && el.closest('.ai-chatbot-asu-sparkles-block')) {
        return true;
      }
      try {
        return window.getComputedStyle(el).display === 'none';
      } catch (e) {
        return true;
      }
    }

    const ANCHOR_SELECTORS = [
      '#asuHeader',
      '.uds-header',
      'header[role="banner"]',
      '#header',
    ];
    for (let i = 0; i < ANCHOR_SELECTORS.length; i++) {
      let el = null;
      try {
        el = document.querySelector(ANCHOR_SELECTORS[i]);
      } catch (e) {
        // Skip invalid selector.
      }
      if (el && !isExcluded(el)) {
        const rect = el.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > 0 && rect.bottom <= halfViewport) {
          return el;
        }
      }
    }
    return null;
  };

  /**
   * Sets --asu-sparkles-top and --asu-sparkles-hdr-h on the widget root
   * based on a live targeted header measurement, then recomputes
   * on resize (debounced), body-class MutationObserver, and a shrink-only
   * ResizeObserver on the resolved anchor header element.
   *
   * Override precedence:
   *   • If the widget root carries data-asu-sparkles-skip-measure="1", skip
   *     entirely so the theme's CSS token values are used as-is.
   *   • Otherwise JS sets both tokens as inline style on the widget root
   *     (highest cascade; beats any :root { } stylesheet rule).
   *
   * Trigger strategy (no scroll listener):
   *   - Initial measurement via rAF (baseline).
   *   - window 'resize' debounced 150ms (baseline).
   *   - ResizeObserver on the resolved anchor header element (SHRINK-ONLY latch):
   *     if measured > _restingHeaderBottom → raise + apply; else IGNORE. This
   *     prevents the scroll-triggered jump caused by the header's 24px shrink.
   *   - MutationObserver on document.body { attributes, attributeFilter:['class'] }
   *     → re-measure baseline, coalesced via rAF. Catches admin-toolbar tray
   *     toggles (which move #asuHeader's POSITION, not its size, so a size
   *     observer alone would miss them).
   *   - window.load + 200ms safety net.
   *
   * PINNED / SHRINK-ONLY LATCH: self._restingHeaderBottom is the last baseline.
   *   'baseline' events (initial, resize, body-class mutation, load) set
   *   self._restingHeaderBottom = measured (allow up OR down — real layout change).
   *   The header ResizeObserver callback is SHRINK-ONLY: if measured <
   *   self._restingHeaderBottom → lower it + apply (capture scroll contraction);
   *   else IGNORE (grow-back = scroll-to-top; widget stays pinned to contracted).
   *
   * The handler and debounce timer are stored on the instance
   * (_resizeHandler, _resizeDebounce) so they can be removed/cleared in the
   * teardown path (Drupal.behaviors.detach / destroyHeaderMeasurement).
   */
  Controller.prototype.initHeaderMeasurement =
    function initHeaderMeasurement() {
      if (this.root.getAttribute('data-asu-sparkles-skip-measure') === '1') {
        // The constructor added .asu-sparkles--measuring before calling init().
        // We must release the gate here so the widget does not stay invisible
        // forever when the theme opts out of JS measurement.
        if (!this._headerMeasured) {
          this._headerMeasured = true;
          this.root.classList.remove('asu-sparkles--measuring');
        }
        return;
      }
      // Once-guard — if a listener is already attached, tear it down
      // before registering a new one. Prevents duplicate listeners on re-attach.
      if (this._resizeHandler) {
        window.clearTimeout(this._resizeDebounce);
        this._resizeDebounce = null;
        window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
      }
      if (this._headerResizeObserver) {
        this._headerResizeObserver.disconnect();
        this._headerResizeObserver = null;
      }
      if (this._bodyClassObserver) {
        this._bodyClassObserver.disconnect();
        this._bodyClassObserver = null;
      }

      const self = this;

      /**
       * Applies the CSS tokens from a given bottom value and releases the
       * visibility gate on the first call.
       *
       * @param {number} headerBottomVal
       *   The measured header bottom in pixels.
       */
      function applyTokens(headerBottomVal) {
        // Desktop (>768px) uses +48px; phone (≤768px) keeps +16px
        // so the CSS phone-override clamp is not bypassed by the inline variable.
        const gap =
          window.innerWidth > PHONE_MAX_WIDTH_PX
            ? HEADER_GAP_DESKTOP_PX
            : HEADER_GAP_PHONE_PX;
        const topPx = `${Math.ceil(headerBottomVal + gap)}px`;
        const hdrPx = `${Math.ceil(headerBottomVal)}px`;
        self.root.style.setProperty('--asu-sparkles-top', topPx);
        self.root.style.setProperty('--asu-sparkles-hdr-h', hdrPx);
        // Remove the visibility gate after the first reliable
        // measurement. Use rAF so the class removal happens in a frame AFTER
        // the CSS custom properties are committed, preventing any flash.
        if (!self._headerMeasured) {
          if (
            typeof window.matchMedia !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ) {
            // Under reduced-motion, skip the rAF and remove synchronously.
            self._headerMeasured = true;
            self.root.classList.remove('asu-sparkles--measuring');
          } else {
            window.requestAnimationFrame(function releaseGateRaf() {
              // Guard: controller may have been destroyed while this rAF was
              // queued (e.g. destroy-before-initial-rAF race). Skip the class
              // removal so a detached root is not mutated.
              if (self._measurementDestroyed) {
                return;
              }
              self._headerMeasured = true;
              self.root.classList.remove('asu-sparkles--measuring');
            });
          }
        }
      }

      /**
       * Applies a measurement to the CSS tokens and updates _restingHeaderBottom.
       * Called by all BASELINE triggers (initial, resize, body-class mutation, load).
       *
       * @param {number|null} headerBottomVal
       *   The measured header bottom, or null when no anchor found.
       */
      function applyBaseline(headerBottomVal) {
        if (headerBottomVal === null) {
          // No anchor found — release visibility gate and CLEAR any stale inline
          // token values so the CSS fallback takes over (previously these
          // were left in place, pinning the widget at a stale position).
          if (!self._headerMeasured) {
            self._headerMeasured = true;
            self.root.classList.remove('asu-sparkles--measuring');
          }
          if (self._restingHeaderBottom !== null) {
            self.root.style.removeProperty('--asu-sparkles-top');
            self.root.style.removeProperty('--asu-sparkles-hdr-h');
            self._restingHeaderBottom = null;
          }
          return;
        }
        // Update the resting baseline (baseline events allow up OR down).
        self._restingHeaderBottom = headerBottomVal;
        applyTokens(headerBottomVal);
      }

      /**
       * Full measure-and-baseline call. Used by initial + resize + load triggers.
       * Guards against _measurementDestroyed so a queued rAF or setTimeout
       * callback does not write tokens after the controller is detached.
       */
      const measureAndBaseline = function measureAndBaseline() {
        if (self._measurementDestroyed) {
          return;
        }
        applyBaseline(self.measureHeaderTop());
      };

      // Store the debounced resize handler on the instance for teardown.
      this._resizeHandler = function debounceResize() {
        window.clearTimeout(self._resizeDebounce);
        self._resizeDebounce = window.setTimeout(measureAndBaseline, 150);
      };

      // Initial measurement — defer one frame so layout is stable.
      window.requestAnimationFrame(measureAndBaseline);

      // Minimum credible header bottom in pixels. The shrink-only RO callbacks
      // reject measurements below this floor to guard against transient tiny
      // values (e.g. height=1 during animations) permanently lowering the latch.
      // A real contracted ASU header is never shorter than this value.
      const MIN_HEADER_BOTTOM_PX = 32;

      // Safety net: force-release the gate on window.load + 200ms so a
      // pathological measurement failure cannot leave the widget hidden.
      // Also handles the case where Drupal.behaviors.attach fires after
      // window.load has already fired (document.readyState === 'complete').
      //
      // runLoadSafetyNet is idempotent (guarded by _measurementDestroyed):
      // it re-measures, releases the gate, and installs the ResizeObserver
      // on the late-resolved anchor if not already set.
      function runLoadSafetyNet() {
        window.setTimeout(function onLoadSafetyTimeout() {
          // Guard: if the controller was detached before load+200ms fires,
          // skip all observer creation to prevent an observer leak.
          if (self._measurementDestroyed) {
            return;
          }
          if (!self._headerMeasured) {
            self._headerMeasured = true;
            self.root.classList.remove('asu-sparkles--measuring');
          }
          // Also re-measure in case the load event revealed new layout.
          measureAndBaseline();
          // Re-resolve the anchor header element at load time and attach
          // ResizeObserver if not yet done (late-anchor recovery).
          if (!self._headerResizeObserver && 'ResizeObserver' in window) {
            const anchorEl = self._resolveAnchorEl();
            if (anchorEl) {
              self._headerResizeObserver = new ResizeObserver(
                function onHeaderResizeLoad() {
                  // SHRINK-ONLY with floor guard: lower the anchor when the
                  // header contracts (scroll-contraction) and the measured value
                  // is at or above the credible floor (reject transient
                  // tiny values that would permanently lower the latch).
                  const measured = self.measureHeaderTop();
                  if (
                    measured !== null &&
                    measured >= MIN_HEADER_BOTTOM_PX &&
                    self._restingHeaderBottom !== null &&
                    measured < self._restingHeaderBottom
                  ) {
                    // Header shrank (scroll-contraction): lower anchor + apply.
                    self._restingHeaderBottom = measured;
                    applyTokens(measured);
                  }
                  // Grow-back (measured >= _restingHeaderBottom): silently ignored.
                  // Widget stays pinned at the contracted value.
                  // Tiny transient (measured < MIN_HEADER_BOTTOM_PX): also ignored.
                },
              );
              self._headerResizeObserver.observe(anchorEl);
            }
          }
        }, 200);
      }

      if (document.readyState === 'complete') {
        // window.load already fired — run the safety net immediately rather
        // than waiting for an event that will never come.
        runLoadSafetyNet();
      } else {
        window.addEventListener(
          'load',
          function onLoadSafetyNet() {
            runLoadSafetyNet();
          },
          { once: true },
        );
      }

      // Re-measure on resize (debounced 150 ms, baseline).
      window.addEventListener('resize', this._resizeHandler);

      // MutationObserver on document.body { attributes, class } so
      // admin-toolbar tray toggles (which move #asuHeader's POSITION, not size)
      // trigger a baseline re-measure. Coalesced via rAF to batch rapid mutations.
      if ('MutationObserver' in window) {
        let _bodyMoPending = false;
        this._bodyClassObserver = new MutationObserver(
          function onBodyClassMutation() {
            // Guard: skip if the controller was already destroyed, or if a
            // rAF is already pending for this batch.
            if (self._measurementDestroyed || _bodyMoPending) {
              return;
            }
            _bodyMoPending = true;
            window.requestAnimationFrame(function onBodyClassMutationRaf() {
              // Guard: the controller may have been destroyed while this rAF
              // was queued (post-detach race). Skip the measurement entirely.
              if (self._measurementDestroyed) {
                _bodyMoPending = false;
                return;
              }
              _bodyMoPending = false;
              measureAndBaseline();
            });
          },
        );
        this._bodyClassObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ['class'],
        });
      }

      // ResizeObserver on the resolved anchor header element.
      // SHRINK-ONLY: if measured < _restingHeaderBottom AND above MIN_HEADER_BOTTOM_PX
      // → lower anchor + apply (capture scroll-contraction).
      // Grow-back (measured >= _restingHeaderBottom) → IGNORE (stay pinned).
      // Transient-tiny (measured < MIN_HEADER_BOTTOM_PX) → IGNORE.
      window.requestAnimationFrame(function resolveAnchorAndObserve() {
        // Guard: if the controller was detached/destroyed before this rAF fires,
        // do not create a ResizeObserver on an orphaned instance.
        if (self._measurementDestroyed) {
          return;
        }
        if ('ResizeObserver' in window) {
          const anchorEl = self._resolveAnchorEl();
          if (anchorEl) {
            self._headerResizeObserver = new ResizeObserver(
              function onHeaderResizeShrinkOnly() {
                const measured = self.measureHeaderTop();
                if (
                  measured !== null &&
                  measured >= MIN_HEADER_BOTTOM_PX &&
                  self._restingHeaderBottom !== null &&
                  measured < self._restingHeaderBottom
                ) {
                  // Header shrank (scroll-contraction) and passes floor check:
                  // lower anchor + apply.
                  self._restingHeaderBottom = measured;
                  applyTokens(measured);
                }
                // Grow-back (measured >= _restingHeaderBottom): silently ignored.
                // Widget stays pinned at the contracted value, no >48px widening.
                // Tiny transient (measured < MIN_HEADER_BOTTOM_PX): also ignored.
              },
            );
            self._headerResizeObserver.observe(anchorEl);
          }
        }
      });
    };

  /**
   * Tears down the header-measurement resize listener, ResizeObserver,
   * body-class MutationObserver, and pending debounce timer. Called from
   * Drupal.behaviors.detach so the listeners are removed when the widget
   * element is removed from the document.
   *
   * Removes the resize listener, _headerResizeObserver, and
   * _bodyClassObserver. The old _scrollHandler and _toolbarResizeObserver
   * are no longer used and are not referenced here.
   */
  Controller.prototype.destroyHeaderMeasurement =
    function destroyHeaderMeasurement() {
      // Set the teardown guard before clearing handles so any queued rAF or
      // window.load callback that fires after detach sees this flag and skips
      // creating new observers on the orphaned controller.
      this._measurementDestroyed = true;
      if (this._resizeHandler) {
        window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
      }
      if (this._headerResizeObserver) {
        this._headerResizeObserver.disconnect();
        this._headerResizeObserver = null;
      }
      if (this._bodyClassObserver) {
        this._bodyClassObserver.disconnect();
        this._bodyClassObserver = null;
      }
      if (this._resizeDebounce) {
        window.clearTimeout(this._resizeDebounce);
        this._resizeDebounce = null;
      }
    };

  // ---------------------------------------------------------------------------
  // Ellipsis menu methods.
  // ---------------------------------------------------------------------------

  /**
   * Opens the ellipsis menu popover and moves focus to a menuitem.
   *
   * @param {object} [opts]
   *   Options. opts.focusIdx = index of the menuitem to focus (default 0).
   */
  Controller.prototype.openMenu = function openMenu(opts) {
    if (!this.menuBtn || !this.menuPopover || !this.menuItems.length) {
      return;
    }
    // Invariant: the menu sub-state is only valid inside the open state.
    // Guard against programmatic calls from collapsed/compact contexts (e.g.
    // a queued event that fires after a state transition).
    if (this.state !== 'open') {
      return;
    }
    opts = opts || {};
    const focusIdx = opts.focusIdx !== undefined ? opts.focusIdx : 0;
    const self = this;

    this._menuOpen = true;
    this.menuPopover.removeAttribute('hidden');
    this.menuBtn.setAttribute('aria-expanded', 'true');

    // Set roving tabindex: only the focused item is in the tab order.
    this.menuItems.forEach(function setTabIndexMinusOne(item) {
      item.setAttribute('tabindex', '-1');
    });
    const target = this.menuItems[focusIdx] || this.menuItems[0];
    if (target) {
      this._menuFocusIdx = this.menuItems.indexOf(target);
      target.setAttribute('tabindex', '0');
      target.focus();
    }

    // One-shot capture-phase outside-click close.
    // Uses menuBtn.contains() so clicking the nested <span aria-hidden> also
    // counts as "inside" the trigger button (defence-in-depth).
    self._menuOutsideHandler = function outsideClickClose(e) {
      if (
        !self.menuPopover.contains(e.target) &&
        !self.menuBtn.contains(e.target)
      ) {
        self.closeMenu({ restoreFocus: false });
      }
    };
    document.addEventListener('click', self._menuOutsideHandler, true);

    // Close when focus leaves the menu (Tab, Shift+Tab to the
    // trigger, or programmatic), unless it moves between menu items. Pairs
    // with the Tab case in _onMenuKeyNav.
    self._menuFocusoutHandler = function menuFocusout(e) {
      if (e.relatedTarget && self.menuPopover.contains(e.relatedTarget)) {
        return;
      }
      self.closeMenu({ restoreFocus: false });
    };
    self.menuPopover.addEventListener('focusout', self._menuFocusoutHandler);
  };

  /**
   * Closes the ellipsis menu popover.
   *
   * @param {object} [opts]
   *   Options. opts.restoreFocus = whether to return focus to the menu button.
   */
  Controller.prototype.closeMenu = function closeMenu(opts) {
    if (!this.menuPopover) {
      return;
    }
    opts = opts || {};

    this._menuOpen = false;
    this.menuPopover.setAttribute('hidden', 'hidden');
    if (this.menuBtn) {
      this.menuBtn.setAttribute('aria-expanded', 'false');
    }
    // Reset all roving tabindexes.
    this.menuItems.forEach(function resetTabIndex(item) {
      item.setAttribute('tabindex', '-1');
    });

    // Remove outside-click listener.
    if (this._menuOutsideHandler) {
      document.removeEventListener('click', this._menuOutsideHandler, true);
      this._menuOutsideHandler = null;
    }

    // Remove focusout listener (before any restoreFocus move, so re-focusing
    // the trigger cannot re-trigger it).
    if (this._menuFocusoutHandler) {
      this.menuPopover.removeEventListener(
        'focusout',
        this._menuFocusoutHandler,
      );
      this._menuFocusoutHandler = null;
    }

    if (opts.restoreFocus && this.menuBtn) {
      this.menuBtn.focus();
    }
  };

  /**
   * Handles keyboard navigation inside the menu popover (roving focus).
   *
   * @param {KeyboardEvent} event
   *   The keydown event.
   * @param {number} idx
   *   The index of the currently focused menuitem.
   */
  Controller.prototype._onMenuKeyNav = function onMenuKeyNav(event, idx) {
    const len = this.menuItems.length;
    if (!len) {
      return;
    }
    let nextIdx;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        nextIdx = (idx + 1) % len;
        break;
      case 'ArrowUp':
        event.preventDefault();
        nextIdx = (idx - 1 + len) % len;
        break;
      case 'Home':
        event.preventDefault();
        nextIdx = 0;
        break;
      case 'End':
        event.preventDefault();
        nextIdx = len - 1;
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation(); // Prevent widget-level Escape from firing.
        this.closeMenu({ restoreFocus: true });
        return;
      case 'Tab':
        // Tabbing (or Shift+Tab) out of the menu closes it. Do NOT
        // preventDefault — let the browser move focus to the next element.
        this.closeMenu({ restoreFocus: false });
        return;
      case ' ':
      case 'Spacebar':
        // Native <button> items (Clear) activate on Space already.
        // Anchor menuitems do not, so synthesise a click to match the ARIA
        // menu pattern (Enter already works natively on anchors).
        if (this.menuItems[idx] && this.menuItems[idx].tagName === 'A') {
          event.preventDefault();
          this.menuItems[idx].click();
        }
        return;
      default:
        return;
    }
    this.menuItems[idx].setAttribute('tabindex', '-1');
    this.menuItems[nextIdx].setAttribute('tabindex', '0');
    this._menuFocusIdx = nextIdx;
    this.menuItems[nextIdx].focus();
  };

  /**
   * Handles activation (click) of a menu item.
   *
   * @param {HTMLElement} item
   *   The activated menuitem element.
   */
  Controller.prototype._onMenuItemActivate = function onMenuItemActivate(item) {
    if (item.getAttribute('data-action') === 'clear') {
      // Close the menu first (restoreFocus:false — clear will hand focus to
      // the ring input, not the menu button). clearConversation is called
      // AFTER closing so the popover is gone before any DOM rebuild.
      this.closeMenu({ restoreFocus: false });
      // clearConversation() calls _setResettingUi(true), which DISABLES the
      // ring input for the whole reset window. A synchronous input.focus()
      // here therefore fails (focus falls to <body>). Instead, request a
      // deferred focus: _finishReset() re-enables the input at terminal settle
      // and honours this flag so keyboard users are not stranded.
      this._focusRingInputAfterReset = true;
      this.clearConversation();
    } else {
      // Anchor link: let browser handle navigation; close the popover.
      this.closeMenu({ restoreFocus: false });
    }
  };

  /**
   * Transitions the widget to a new state, orchestrating the correct motion.
   *
   * Three paths:
   *   - INSTANT: options.restore OR prefers-reduced-motion. Applies state
   *     synchronously; no transition classes.
   *   - MORPH (desktop only): collapsed<->open. Adds .asu-sparkles--reflow
   *     for ~420ms to hide the inner shell while width/height/border-radius
   *     and --asu-sparkles-gapw transition in CSS. Measures and sets
   *     --asu-sparkles-open-h for the height ease; fitOpen() runs on log
   *     mutations and transitionend to keep it current.
   *   - CROSSFADE: everything else (to/from compact, open→collapsed at mobile,
   *     etc.). .asu-sparkles--fading fades the root to 0 over 120ms,
   *     the state swaps, root fades back to 1 over 200ms; the 48px fab's
   *     chatpop keyframe plays via CSS when data-state lands on compact.
   *
   * @param {string} state
   *   One of collapsed|open|compact.
   * @param {object} [options]
   *   Options. options.restore = applied without animation/persistence.
   *   options.silent = applied without data-layer events (scroll compaction).
   */
  Controller.prototype.setState = function (state, options) {
    options = options || {};
    const self = this;

    // Fold any legacy 'closed' intent into 'compact'.
    // The 'closed' state is removed from the state machine; any code that
    // still calls setState('closed') (persisted localStorage, old event
    // handlers) is safely redirected to the compact 48px fab.
    if (state === 'closed') {
      state = 'compact';
    }

    // -----------------------------------------------------------------------
    // STEP 1 — Cancel any in-flight crossfade BEFORE all guards.
    //
    // Race invariant: no stale _fadeTimer may survive a setState call.
    //
    // Why this must be first: this.state is the COMMITTED state (updated only
    // when the crossfade callback fires).  While a collapsed→compact fade is
    // pending, this.state is still 'collapsed'.  A scroll-back that requests
    // 'collapsed' would otherwise hit the no-op guard below (requested ===
    // this.state === 'collapsed') and return without clearing _fadeTimer, so
    // the obsolete compact timer would fire 120 ms later and wrongly settle to
    // compact.  The same class of bug hits a pending crossfade followed by a
    // restore/reduced-motion instant request: the instant path would apply the
    // new state immediately, but the queued timer would later overwrite it.
    //
    // Clearing here means: whatever path follows (no-op, instant, morph, or a
    // new crossfade) always starts from a clean timer/class state.
    // -----------------------------------------------------------------------
    if (this._fadeTimer !== null) {
      window.clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
      this._pendingState = null;
      this.root.classList.remove('asu-sparkles--fading');
    }

    // -----------------------------------------------------------------------
    // STEP 2 — Determine the effective current state for the no-op guard.
    //
    // _pendingState (cleared above when a fade was in flight) was the state
    // the cancelled fade was heading to.  Since we just cleared it, the
    // effective committed state is always this.state at this point.
    // The no-op guard therefore compares the requested state against
    // this.state — after any pending fade has been cancelled.
    // -----------------------------------------------------------------------
    const previous = this.state;

    // Short-circuit no-ops: requested state equals the committed state AND
    // there is no in-flight crossfade heading elsewhere (already cancelled
    // above, so this check is always against the settled committed state).
    if (previous === state) {
      if (!options.restore && !options.silent) {
        writeState(state);
      }
      return;
    }

    const instant = options.restore || this.reducedMotion();
    const isMorph =
      !instant &&
      window.innerWidth > PHONE_MAX_WIDTH_PX &&
      ((previous === 'collapsed' && state === 'open') ||
        (previous === 'open' && state === 'collapsed'));
    const isCrossfade = !instant && !isMorph;

    const persist = function () {
      if (!options.restore && !options.silent) {
        writeState(state);
        self.onStateChange(previous, state);
      }
    };

    // ----- INSTANT path (restore or reduced-motion) -----
    // In-flight fade already cancelled in STEP 1; apply the new state now.
    if (instant) {
      this.applyStateImmediate(state);
      persist();
      return;
    }

    // ----- MORPH path (collapsed <-> open on desktop) -----
    if (isMorph) {
      // Capture the current height so the CSS height transition starts
      // from the current ring, not from auto.
      if (state === 'open') {
        const h0 = this.root.getBoundingClientRect().height;
        this.root.style.setProperty(
          '--asu-sparkles-open-h',
          `${Math.ceil(h0)}px`,
        );
      }

      this.root.classList.add('asu-sparkles--reflow');
      this.applyStateImmediate(state);

      // Measure the natural content height at the final 384px width.
      if (state === 'open') {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            self.fitOpen();
          });
        });
      } else {
        // collapsed: clear the inline height so CSS 280px wins.
        this.root.style.removeProperty('--asu-sparkles-open-h');
      }

      window.clearTimeout(this._reflowTimer);
      this._reflowTimer = window.setTimeout(function () {
        self.root.classList.remove('asu-sparkles--reflow');
        self._reflowTimer = null;
      }, 420);

      persist();
      return;
    }

    // ----- CROSSFADE path (to/from compact, open at mobile, all widths) -----
    // _fadeTimer is null here (cleared in STEP 1 if it was set).
    // Track the target so a subsequent setState call can compare against
    // the pending target rather than the still-uncommitted this.state.
    if (isCrossfade) {
      // Capture any focus callback queued by the caller (e.g. the close
      // handler) into the closure so it fires after applyStateImmediate()
      // has unhidden the target element. Immediately clear the instance
      // property so a later, unrelated setState call cannot pick it up.
      const crossfadeFocusCb = this._focusAfterCommit || null;
      this._focusAfterCommit = null;

      this._pendingState = state;
      this.root.classList.add('asu-sparkles--fading');
      this._fadeTimer = window.setTimeout(function () {
        self._pendingState = null;
        // Deliver the captured focus callback through applyStateImmediate
        // so it fires after the target element is unhidden.
        if (crossfadeFocusCb) {
          self._focusAfterCommit = crossfadeFocusCb;
        }
        self.applyStateImmediate(state);
        window.requestAnimationFrame(function () {
          self.root.classList.remove('asu-sparkles--fading');
          self._fadeTimer = null;
        });
      }, 120);

      persist();
    }
  };

  /**
   * Emits ASU data-layer modal open/close events on user state changes.
   *
   * Opening (entering "open") is a modal open; leaving "open" for any
   * collapsed/compact state is a modal close. Scroll compaction is silent
   * and never reaches this hook.
   *
   * @param {string} previous
   *   The previous state.
   * @param {string} next
   *   The new state.
   */
  Controller.prototype.onStateChange = function (previous, next) {
    if (next === 'open' && previous !== 'open') {
      pushDataLayer({
        event: 'modal',
        action: 'open',
        name: 'onclick',
        type: 'click',
        section: this.section,
        text: 'open the asu chat',
        component: 'button',
      });
    } else if (previous === 'open' && next !== 'open') {
      pushDataLayer({
        event: 'modal',
        action: 'close',
        name: 'onclick',
        type: 'click',
        section: this.section,
        text: 'close the asu chat',
        component: 'button',
      });
    }
  };

  /**
   * Toggles the hidden attribute on an optional element.
   *
   * @param {HTMLElement|null} element
   *   The element.
   * @param {boolean} hidden
   *   Whether it should be hidden.
   */
  Controller.prototype.toggleHidden = function (element, hidden) {
    if (!element) {
      return;
    }
    if (hidden) {
      element.setAttribute('hidden', 'hidden');
    } else {
      element.removeAttribute('hidden');
    }
  };

  /**
   * Handles a submitted query from the input or a preset chip.
   *
   * @param {string} text
   *   The query text to send to the assistant.
   * @param {string} source
   *   "typed" or "preset".
   * @param {string} [label]
   *   For preset chips, the visible label (used by the data layer).
   */
  Controller.prototype.submitQuery = function (text, source, label) {
    text = (text || '').trim();
    if (!text || this.busy || this.resetting) {
      // Announce while resetting so assistive tech users know why
      // the submission was ignored.
      if (this.resetting) {
        this.announce(Drupal.t('Please wait — resetting the conversation.'));
      }
      return;
    }

    // Advance the generation counter so any in-flight clearConversation()
    // response that arrives after this submission is treated as stale and
    // discarded — a late reset cannot erase the new message.
    this._resetGeneration = (this._resetGeneration || 0) + 1;

    // A new submit means the user is starting a fresh turn; the page-baked
    // history is no longer "cleared" so future seedFirstMessage() calls (if
    // any) can replay history normally on a fresh page load. In practice
    // _historyCleared is only consulted by seedFirstMessage() which is only
    // called from init() and clearConversation() — not from submit — but
    // resetting it here keeps the invariant clean.
    this._historyCleared = false;

    if (this.state !== 'open') {
      this.setState('open');
    }

    this.renderMessage('user', text);
    if (this.input) {
      this.input.value = '';
      this.input.focus();
    }

    this.onSubmit(text, source, label);
    this.sendToBackend(text);
  };

  /**
   * Emits an ASU data-layer "search" event for each submitted query.
   *
   * Preset chips report the visible label; typed queries report the query
   * text only when the block opts in (PII toggle), otherwise "redacted".
   *
   * @param {string} text
   *   The query text.
   * @param {string} source
   *   "typed" or "preset".
   * @param {string} [label]
   *   The preset chip label, if any.
   */
  Controller.prototype.onSubmit = function (text, source, label) {
    if (source === 'preset') {
      pushDataLayer({
        event: 'search',
        action: 'click',
        name: 'onclick',
        type: 'preset question',
        section: this.section,
        text: label || text,
        component: 'button',
      });
      return;
    }

    pushDataLayer({
      event: 'search',
      action: 'type',
      name: 'onenter',
      type: 'typed query',
      section: this.section,
      text: this.sendTypedText ? text : 'redacted',
      component: 'search bar',
    });
  };

  /**
   * Sends a message to the assistant backend.
   *
   * Talks directly to the ai_chatbot /api/deepchat endpoint, reusing the
   * assistant_id / thread_id that DeepChatFormBlock attaches to
   * drupalSettings.ai_deepchat. Renders a typing indicator, then the
   * sanitized HTML answer. Handles the agent "should_continue" loop and
   * both the non-streamed (JSON) and streamed (SSE) response shapes.
   *
   * @param {string} text
   *   The query text.
   */
  Controller.prototype.sendToBackend = function (text) {
    const self = this;
    const config = (drupalSettings && drupalSettings.ai_deepchat) || {};

    if (!config.assistant_id) {
      this.renderMessage(
        'assistant',
        Drupal.t('The assistant is not configured yet.'),
      );
      return;
    }

    this.setBusy(true);
    const typing = this.renderTyping();

    // Capture the generation at dispatch time.
    // If clearConversation() fires while this request is in flight,
    // _resetGeneration advances; the response handlers check this guard
    // and silently discard the late response rather than re-appending
    // bubbles to the freshly-rebuilt log.
    const myGen = this._resetGeneration;

    // Allocate a fresh AbortController per submit so clearConversation
    // can abort this specific in-flight chain.
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    // Token + POST + one-shot CSRF retry on 403.
    const self2 = self;
    const postOnce = function () {
      // Pass the submit signal so aborting the submit also
      // cancels an in-flight CSRF session fetch.
      return self2.ensureCsrfToken(config, signal).then(function (token) {
        return self2.postMessage(
          self2.endpointUrl(token),
          config,
          [{ role: 'user', text }],
          signal,
        ); // Pass AbortController signal
      });
    };

    postOnce()
      .catch(function (err) {
        if (err && err.csrfRetry) {
          // Refetch the token once and retry. If the retry ALSO 403s (or any
          // other failure), the outer .catch below handles it — clears the
          // cached token and renders the error bubble. No infinite loop:
          // postOnce throws csrfRetry only when postMessage sees a 403;
          // refreshCsrfToken clears the cache before the retry so a second
          // 403 from postOnce propagates as a plain Error (csrfRetry === false)
          // which falls through to the outer .catch.
          return self2.refreshCsrfToken(config, signal).then(postOnce);
        }
        throw err;
      })
      .then(function (response) {
        // Concurrency guard: discard if
        // clearConversation() fired or a newer submitQuery() started after
        // this request was dispatched. A stale completion must NOT call
        // setBusy(false) — doing so would re-enable controls while the
        // current-generation request is still in flight, allowing concurrent
        // submissions. Only the current-generation request owns busy/UI cleanup.
        if (self._resetGeneration !== myGen) {
          return;
        }
        self.handleResponse(config, response, typing, myGen, 0); // Pass depth=0
      })
      .catch(function (err) {
        // Swallow AbortError quietly (clearConversation aborted us).
        // No error bubble, no setBusy toggle, no token clear.
        if (err && err.name === 'AbortError') {
          return;
        }
        // Retry exhausted (second 403 or any other failure).
        // Clear the cached token so the NEXT user attempt refetches rather
        // than re-using a stale/invalid token.
        Drupal.AsuSparkles.csrfToken = null;
        // Concurrency guard: a stale error (generation mismatch) must
        // NOT call setBusy(false). Doing so would re-enable controls while a
        // newer in-flight request is still running. Only the current-generation
        // request may own busy/UI cleanup. Return immediately without any
        // busy-state mutation when the generation has advanced.
        if (self._resetGeneration !== myGen) {
          return;
        }
        self.replaceTyping(
          typing,
          Drupal.t('Sorry, something went wrong. Please try again.'),
          true,
        );
        self.setBusy(false);
      });
  };

  /**
   * Resolves the base path, always ending in a slash.
   *
   * @return {string}
   *   The base path.
   */
  Controller.prototype.basePath = function () {
    return (
      (drupalSettings && drupalSettings.path && drupalSettings.path.baseUrl) ||
      '/'
    );
  };

  /**
   * Ensures a session-scoped CSRF token for /api/deepchat.
   *
   * Every /api/deepchat POST requires a session-scoped CSRF token obtained
   * via POST /api/deepchat/session, even when the visitor already has an
   * authenticated Drupal session. The prior short-circuit that returned an
   * empty token for authenticated visitors caused HTTP 403. The token is
   * cached on Drupal.AsuSparkles.csrfToken for the page lifetime, and
   * appended on every /api/deepchat POST via endpointUrl().
   *
   * Accepts an optional AbortSignal so aborting a submit (via clearConversation)
   * also cancels an in-flight CSRF session fetch.
   *
   * @param {object} config
   *   The drupalSettings.ai_deepchat config (kept for API-stability).
   * @param {AbortSignal|undefined} [signal]
   *   Optional AbortSignal forwarded to the /api/deepchat/session fetch.
   *
   * @return {Promise<string>}
   *   Resolves with the CSRF token.
   */
  Controller.prototype.ensureCsrfToken = function (config, signal) {
    if (Drupal.AsuSparkles.csrfToken) {
      return Promise.resolve(Drupal.AsuSparkles.csrfToken);
    }
    const fetchOpts = {
      method: 'POST',
      credentials: 'same-origin',
    };
    // Only set signal when provided (avoids setting undefined on older
    // fetch implementations that may not accept it gracefully).
    if (signal) {
      fetchOpts.signal = signal;
    }
    return fetch(`${this.basePath()}api/deepchat/session`, fetchOpts)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('csrf-session-fetch-failed');
        }
        return response.text();
      })
      .then(function (token) {
        Drupal.AsuSparkles.csrfToken = token || '';
        return Drupal.AsuSparkles.csrfToken;
      });
  };

  /**
   * Clears the cached CSRF token and refetches via /api/deepchat/session.
   *
   * Called from the one-shot 403 retry path. If this refetch also fails,
   * the user sees the generic error bubble; no infinite retry.
   *
   * Forwards the optional signal to ensureCsrfToken.
   *
   * @param {object} config
   *   The drupalSettings.ai_deepchat config.
   * @param {AbortSignal|undefined} [signal]
   *   Optional AbortSignal forwarded to the /api/deepchat/session fetch.
   *
   * @return {Promise<string>}
   *   Resolves with the fresh token.
   */
  Controller.prototype.refreshCsrfToken = function (config, signal) {
    Drupal.AsuSparkles.csrfToken = null;
    return this.ensureCsrfToken(config, signal);
  };

  /**
   * Builds the /api/deepchat URL, with the CSRF token when present.
   *
   * @param {string} token
   *   The CSRF token.
   *
   * @return {string}
   *   The endpoint URL.
   */
  Controller.prototype.endpointUrl = function (token) {
    let url = `${this.basePath()}api/deepchat`;
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }
    return url;
  };

  /**
   * POSTs a set of messages to the endpoint and normalizes the response.
   *
   * @param {string} url
   *   The endpoint URL.
   * @param {object} config
   *   The drupalSettings.ai_deepchat config.
   * @param {Array} messages
   *   The messages array ([{role, text}]).
   *
   * @return {Promise<object>}
   *   Resolves with { html, should_continue, error }.
   */
  Controller.prototype.postMessage = function (url, config, messages, signal) {
    const stream = !!config.stream;
    const body = {
      assistant_id: config.assistant_id,
      thread_id: config.thread_id,
      stream: stream ? 1 : 0,
      show_copy_icon: false,
      structured_results: false,
      verbose_mode: false,
      contexts: { current_route: window.location.pathname },
      messages,
    };

    // Pass the AbortController signal so clearConversation() can
    // cancel an in-flight fetch without leaving a dangling network request.
    const fetchOpts = {
      method: 'POST',
      credentials: 'same-origin', // Session cookie must travel.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    if (signal) {
      fetchOpts.signal = signal;
    }

    return fetch(url, fetchOpts).then(function (response) {
      if (response.status === 403) {
        // Signal CSRF retry to the caller.
        const err = new Error('csrf-403');
        err.csrfRetry = true;
        throw err;
      }
      const type = response.headers.get('Content-Type') || '';
      if (type.indexOf('text/event-stream') !== -1 && response.body) {
        return readSseStream(response);
      }
      return response.json().catch(function () {
        return { error: Drupal.t('Unexpected response from the assistant.') };
      });
    });
  };

  /**
   * Handles a normalized response, including the agent continue loop.
   *
   * @param {object} config
   *   The drupalSettings.ai_deepchat config.
   * @param {object} response
   *   The normalized response.
   * @param {HTMLElement} bubble
   *   The typing/answer bubble to populate.
   */
  Controller.prototype.handleResponse = function (
    config,
    response,
    bubble,
    myGen,
    depth,
  ) {
    const self = this;

    // Continuation guard: capture the generation for this
    // invocation. On first call myGen is passed in from sendToBackend (where it
    // was snapshotted at dispatch time). Recursive should_continue calls
    // propagate the same token so the entire continuation chain belongs to one
    // generation and stale chains from prior submits/Clears are discarded.
    const gen = myGen !== undefined ? myGen : self._resetGeneration;

    // Depth counter for the should_continue cap.
    const d = depth || 0;

    if (response && response.error) {
      this.replaceTyping(bubble, response.error, true);
      this.setBusy(false);
      return;
    }

    this.replaceTyping(bubble, (response && response.html) || '', false);

    if (response && response.should_continue) {
      // Hard cap BEFORE issuing the next POST. A turn can render
      // up to CONTINUATION_LIMIT+1 server HTML strings (initial + up to 10
      // follow-ups).
      if (d + 1 > CONTINUATION_LIMIT) {
        this.replaceTyping(
          bubble,
          Drupal.t('The assistant stopped responding. Please try again.'),
          true,
        );
        this.setBusy(false);
        return; // no POST
      }

      // should_continue follow-up also uses one-shot CSRF retry.
      const signal = self._abortController
        ? self._abortController.signal
        : undefined;
      const postOnceContinue = function () {
        // Pass the submit signal so aborting the submit also
        // cancels an in-flight CSRF session fetch.
        return self.ensureCsrfToken(config, signal).then(function (token) {
          return self.postMessage(
            self.endpointUrl(token),
            config,
            [{ role: 'user', text: 'dummy_loading' }],
            signal,
          ); // Pass AbortController signal
        });
      };

      postOnceContinue()
        .catch(function (err) {
          if (err && err.csrfRetry) {
            return self.refreshCsrfToken(config, signal).then(postOnceContinue);
          }
          throw err;
        })
        .then(function (next) {
          // Continuation guard (success path): discard if a Clear
          // or newer submit advanced the generation after this continuation was
          // dispatched. A stale continuation must not render into the rebuilt
          // log or call setBusy(false) for the current-generation request.
          if (self._resetGeneration !== gen) {
            return;
          }
          self.handleResponse(config, next, bubble, gen, d + 1); // Pass d+1
        })
        .catch(function (err) {
          // Swallow AbortError quietly (clearConversation aborted us).
          if (err && err.name === 'AbortError') {
            return;
          }
          // Retry exhausted on should_continue follow-up.
          // Clear cached token (same as sendToBackend final-catch) and
          // surface the generic error bubble so the user is informed.
          // Continuation guard (error path): same stale-generation
          // check — a stale continuation must not call replaceTyping/setBusy and
          // must not clear the token on behalf of the current-generation request.
          if (self._resetGeneration !== gen) {
            return;
          }
          Drupal.AsuSparkles.csrfToken = null;
          self.replaceTyping(
            bubble,
            Drupal.t('Sorry, something went wrong. Please try again.'),
            true,
          );
          self.setBusy(false);
        });
      return;
    }

    this.setBusy(false);
    this.announce(Drupal.t('The assistant replied.'));
  };

  /**
   * Terminal, once-per-generation settle helper for clearConversation().
   *
   * Consolidates all reset settle paths (timeout callback, success .then,
   * failure .catch) into ONE terminal entry point so each generation can
   * settle exactly ONCE, regardless of how many paths race.
   *
   * LOCKED semantics (must not change without a design-doc revision):
   *   1. STALE guard: if gen !== _resetGeneration, a newer Clear owns the
   *      gate; return silently, touch NOTHING.
   *   2. ONCE guard: if _resetSettledGen === gen, already settled this
   *      generation; return silently (no double announce / release).
   *   3. Mark settled: _resetSettledGen = gen.
   *   4. Clear the generation-owned timer.
   *   5. Release the gate: resetting = false, _setResettingUi(false).
   *   6. Announce outcome exactly once per generation.
   *
   * Guards:
   *   A late body that resolves {success:true} after the timeout already
   *   called _finishReset(gen, 'failure') hits the ONCE guard and is a no-op.
   *
   *   A current-generation AbortError that is NOT a stale/detach abort
   *   now calls _finishReset(gen, 'failure') which releases + announces, instead
   *   of silently returning and leaving the gate locked forever.
   *
   * @param {number} gen
   *   The generation this settle belongs to.
   * @param {string} outcome
   *   'success' or 'failure'.
   * @param {object|null} [data]
   *   The response data (only consulted on 'success' to commit thread_id).
   * @param {object} config
   *   drupalSettings.ai_deepchat — passed so thread_id can be committed.
   */
  Controller.prototype._finishReset = function (gen, outcome, data, config) {
    // 1. STALE guard — a newer Clear owns the gate; stay silent.
    if (gen !== this._resetGeneration) {
      return;
    }
    // 2. ONCE guard — already settled this generation; no double announce.
    if (this._resetSettledGen === gen) {
      return;
    }
    // 3. Mark as settled (must happen BEFORE any side effect so re-entrant
    //    calls from microtask-queued continuations hit the ONCE guard).
    this._resetSettledGen = gen;
    // 4. Clear the generation-owned timer.
    clearTimeout(this._resetTimer);
    this._resetTimer = null;
    // 5. Release the gate.
    this.resetting = false;
    this._setResettingUi(false);
    // 5b. If this Clear originated from the ellipsis menu, deliver keyboard
    //     focus to the now-re-enabled ring input (the menuitem that was
    //     focused when Clear fired is gone, so focus would otherwise sit on
    //     <body>). Only when still in the open state.
    if (this._focusRingInputAfterReset) {
      this._focusRingInputAfterReset = false;
      if (this.input && !this.input.disabled && this.state === 'open') {
        this.input.focus();
      }
    }
    // 6. Announce outcome exactly once.
    if (outcome === 'success') {
      // Commit thread_id only when it is a non-empty string.
      if (data && typeof data.thread_id === 'string' && data.thread_id) {
        config.thread_id = data.thread_id;
      }
      this.announce(Drupal.t('Conversation cleared.'));
    } else {
      // Keep old thread_id — do NOT overwrite on failure.
      this.announce(
        Drupal.t('The conversation could not be reset. Please try again.'),
      );
    }
  };

  /**
   * Clears the conversation and resets the server-side session.
   *
   * The UI rebuild is SYNCHRONOUS and DETERMINISTIC. The log is rebuilt to
   * exactly [.asu-sparkles__chips] (messages removed) immediately (before
   * the network call), so the widget is correct regardless of whether the
   * reset-session call succeeds, fails, or arrives late.
   *
   * The first_message lives permanently in the header slot
   * (.asu-sparkles__subtitle), not in the log — it is unaffected by clear.
   *
   * Clear sequence:
   *   1. Increment _resetGeneration so any in-flight chat response (from a
   *      submit made before this Clear) will see a stale generation and discard.
   *   2. Set _historyCleared = true so seedFirstMessage() skips replaying the
   *      page-baked drupalSettings.ai_deepchat.messages (the server session was
   *      reset; those messages are stale and must not be re-rendered).
   *   3. Also clear busy state and remove any typing/loading indicator so the
   *      widget is never left frozen after a mid-conversation Clear.
   *   4. Synchronously remove EVERY child of the log that is NOT the
   *      .asu-sparkles__chips element (removes all .asu-sparkles__msg,
   *      loading/typing nodes, and any stray nodes).
   *      Chips are always kept as the first child (chips-first invariant).
   *   5. Fire the network reset-session call. On success: update thread_id.
   *      The generation guard discards the response if the user started a new
   *      conversation in the meantime. On failure: log is already correct — no
   *      rollback needed.
   *
   * @see the chips-first invariant: .asu-sparkles__chips is always the first child of the log.
   */
  Controller.prototype.clearConversation = function () {
    const self = this;
    const config = (drupalSettings && drupalSettings.ai_deepchat) || {};
    if (!config.assistant_id) {
      return;
    }

    // setBusy(false) fires BEFORE _setResettingUi(true) so
    // the resetting gate wins: _setResettingUi(true) sets input.disabled and
    // sendBtn.disabled to true AFTER setBusy(false) clears them, ensuring
    // both controls stay disabled for the entire reset window.
    this.setBusy(false);

    // Reset-gate ENTRY: set resetting=true FIRST so any submitQuery
    // arriving between now and the reset-session response is blocked.
    this.resetting = true;
    this._setResettingUi(true);

    // Abort any in-flight submit chain (sendToBackend / continuation).
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    // Step 1: Advance the generation so any in-flight chat response discards.
    this._resetGeneration = (this._resetGeneration || 0) + 1;
    const myGeneration = this._resetGeneration;

    // Step 2: Mark history as cleared so seedFirstMessage() skips replay.
    this._historyCleared = true;

    // Synchronously rebuild the log to exactly chips + (nothing yet).
    // Remove EVERY child that is NOT the .asu-sparkles__chips element.
    // This catches all .asu-sparkles__msg, .asu-sparkles__intro-msg, typing
    // indicators, loading placeholders, and any other stray nodes.
    if (this.log) {
      const chips = this.log.querySelector('.asu-sparkles__chips');
      const children = Array.prototype.slice.call(this.log.childNodes);
      children.forEach(function (node) {
        if (node !== chips) {
          self.log.removeChild(node);
        }
      });
    }

    // The first_message is a static header line; it is NOT inserted
    // into the log on clear. The log is rebuilt to exactly [chips] (empty
    // conversation). The header slot is the single source of truth and is
    // untouched by clearConversation.

    // Do NOT announce 'Conversation cleared.' here.
    // The log is rebuilt optimistically, but the announcement must only fire
    // on CONFIRMED success (reset-session returned ok AND not {success:false}).

    // Fire the background network call to reset the server-side session.
    // This is fire-and-forget from the UI perspective — the log is already
    // correct. Only the thread_id update needs the response.
    const url = `${this.basePath()}ajax/chatbot/reset-session/${encodeURIComponent(
      config.assistant_id,
    )}/${encodeURIComponent(config.thread_id)}`;

    // Cancel ANY prior generation's timer BEFORE creating the new AbortController
    // and timer. This ensures Clear B always cancels Clear A's timer; A's timeout
    // callback can never abort B's controller or release B's gate, even if A was
    // already in flight.
    clearTimeout(this._resetTimer);
    this._resetTimer = null;

    // Use its own AbortController so a second Clear aborts the first.
    if (this._resetAbortController) {
      this._resetAbortController.abort();
    }
    this._resetAbortController = new AbortController();
    const resetSignal = this._resetAbortController.signal;

    // Capture the AbortController for THIS generation in the closure so the
    // timeout callback aborts its OWN controller, never self._resetAbortController
    // which may have been replaced by a newer Clear. Timer is generation-owned.
    // Safety timeout for the lightweight reset-session (thread-clear) request
    // ONLY — NOT the chat/generation request (which has no client timeout, so
    // long generative answers are never cut off). This only fires if the
    // reset endpoint hangs, to release the gate rather than lock the widget.
    const RESET_TIMEOUT_MS = 20000;
    const myAbortController = this._resetAbortController;
    this._resetTimer = setTimeout(function () {
      // Mark timed-out gen, abort the captured controller, then call
      // _finishReset to terminally settle this generation as FAILURE.
      // The subsequent AbortError catch + any late body resolve are both
      // no-ops via the ONCE guard (_resetSettledGen === myGeneration).
      self._resetTimedOutGen = myGeneration;
      myAbortController.abort();
      self._finishReset(myGeneration, 'failure', null, config);
    }, RESET_TIMEOUT_MS);
    this._resetTimerGen = myGeneration;

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: resetSignal, // Abort on second Clear
    })
      .then(function (response) {
        // Do NOT clear the timer here.
        // The timer must remain armed until the response BODY is fully parsed.
        // A stalled response.json() must still be timed out.
        if (!response.ok) {
          throw new Error(`reset-http-${response.status}`);
        }
        // Tolerate empty body (e.g. 204 No Content or malformed JSON).
        return response.json().catch(function () {
          return {};
        });
      })
      .then(function (data) {
        // Funnel through _finishReset.
        //   - STALE guard (gen !== _resetGeneration): no-op — a newer Clear owns the gate.
        //   - ONCE guard (_resetSettledGen === gen): no-op — already settled
        //     (e.g. timeout fired before body resolved).
        //   - data.success !== true (empty {}, success:false, …) → failure.
        self._finishReset(
          myGeneration,
          data && data.success === true ? 'success' : 'failure',
          data,
          config,
        );
      })
      .catch(function (err) {
        // Stale guard FIRST: do NOT touch the timer or gate of a newer Clear.
        if (self._resetGeneration !== myGeneration) {
          return;
        }
        // Funnel through _finishReset.
        if (err && err.name === 'AbortError') {
          // Superseded by a newer Clear (stale guard above already caught this,
          // but guard again for clarity) — silent.
          if (self._resetGeneration !== myGeneration) {
            return;
          }
          // Detach teardown abort — widget is being torn down; stay silent.
          if (self._detaching) {
            return;
          }
          // Any other current-gen abort (timeout-initiated OR external direct
          // abort): _finishReset releases + announces. If the timeout
          // path already called _finishReset first, the ONCE guard makes this
          // a no-op.
          self._finishReset(myGeneration, 'failure', null, config);
          return;
        }
        // Network/HTTP failure (thrown by non-ok branch or network error).
        self._finishReset(myGeneration, 'failure', null, config);
      });
  };

  /**
   * Seeds the header slot with the configured first_message, and replays
   * the configured messages history into the log.
   *
   * The first_message is rendered as a STATIC second line in the header
   * (.asu-sparkles__subtitle / .asu-sparkles__firstmsg), NOT as a
   * .asu-sparkles__intro-msg inside the log. The header slot is the
   * single source of truth; it is never inserted into or cleared from the log.
   *
   * - If first_message is non-empty: writes its text into the header slot and
   *   ensures the slot is visible.
   * - If first_message is empty or absent: hides the header slot.
   *
   * History replay (messages[]) continues to append into the log unchanged.
   * clearConversation() does not call seedFirstMessage to re-seed the log
   * intro-msg; the header slot is untouched by clear.
   *
   * Called at init() only (not from clearConversation).
   */
  Controller.prototype.seedFirstMessage = function () {
    const config = (drupalSettings && drupalSettings.ai_deepchat) || {};
    const self = this;

    // Write first_message into the header slot.
    // The slot is .asu-sparkles__subtitle OR .asu-sparkles__firstmsg.
    const firstMsgSlot = this.root
      ? this.root.querySelector(
          '.asu-sparkles__subtitle, .asu-sparkles__firstmsg',
        )
      : null;

    if (firstMsgSlot) {
      const firstMsg =
        typeof config.first_message === 'string'
          ? config.first_message.trim()
          : '';
      if (firstMsg.length) {
        firstMsgSlot.textContent = firstMsg;
        // Ensure visible: remove any hiding attributes the Twig may have set.
        firstMsgSlot.removeAttribute('hidden');
        firstMsgSlot.removeAttribute('aria-hidden');
        firstMsgSlot.style.display = '';
      } else {
        // No first_message: hide the slot so it takes no space.
        firstMsgSlot.setAttribute('hidden', 'hidden');
      }
    }

    // History replay into the log.
    // Guard: only replay when the log exists and hasn't been seeded yet.
    if (!this.log) {
      return;
    }
    // Guard: if the log already has message children (real msgs), skip replay
    // (init() path only calls this once; clearConversation no longer calls it).
    if (this.log.querySelector('.asu-sparkles__msg')) {
      return;
    }

    // Replay history from drupalSettings.ai_deepchat.messages.
    // Skipped when _historyCleared (after a clearConversation reset).
    if (
      !this._historyCleared &&
      Array.isArray(config.messages) &&
      config.messages.length
    ) {
      config.messages.forEach(function (msg) {
        const role = msg && msg.role === 'user' ? 'user' : 'assistant';
        const html = msg && msg.html;
        if (html) {
          // renderMessage() pre-strips contrib .chat-buttons from
          // the raw string before sanitizeHtml, so DOMPurify cannot orphan the
          // <img> by stripping its class. Post-innerHTML strip
          // remains as defence-in-depth. Only assistant entries get the sparkles copy button.
          const bubble = self.renderMessage(role, html, true);
          // Only assistant history entries get the sparkles copy
          // button. User entries render as outline pills and keep no
          // affordance.
          if (role === 'assistant') {
            self.addCopyButton(bubble);
          }
          return;
        }
        // Legacy / safety fallback: plaintext in text or content.
        const text = (msg && (msg.text || msg.content)) || '';
        if (!text) {
          return;
        }
        const bubble2 = self.renderMessage(role, text, role === 'assistant');
        if (role === 'assistant') {
          self.addCopyButton(bubble2);
        }
      });
    }
  };

  /**
   * Renders a typing indicator bubble and returns it.
   *
   * @return {HTMLElement}
   *   The typing bubble element.
   */
  Controller.prototype.renderTyping = function () {
    const bubble = this.renderMessage('assistant', '', true);
    bubble.classList.add('asu-sparkles__bubble--typing');
    // role=status makes the aria-label a valid accessible name on this
    // otherwise-roleless div (clears axe aria-prohibited-attr) and announces
    // the typing state politely. Removed again in replaceTyping().
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-label', Drupal.t('The assistant is typing'));
    bubble.innerHTML = '<span></span><span></span><span></span>';
    return bubble;
  };

  /**
   * Replaces a typing bubble with the final content.
   *
   * @param {HTMLElement} bubble
   *   The bubble element.
   * @param {string} content
   *   Sanitized HTML (from the server) or an error string.
   * @param {boolean} isError
   *   Whether the content is a plain error string.
   */
  Controller.prototype.replaceTyping = function (bubble, content, isError) {
    if (!bubble) {
      return;
    }
    bubble.classList.remove('asu-sparkles__bubble--typing');
    bubble.removeAttribute('aria-label');
    bubble.removeAttribute('role');
    if (isError) {
      bubble.textContent = content;
    } else {
      // Strip contrib buttons from the RAW string BEFORE sanitizeHtml
      // (same reason as renderMessage: DOMPurify would orphan the <img> by
      // stripping its class, leaving an unmatched img that stripContribButtons
      // post-innerHTML can no longer catch). Applied on the live path for
      // symmetry; contrib does not normally bake buttons here, but defends
      // against a future show_copy_icon flag flip.
      const cleanedTyping = this.stripContribButtonsFromString(content);
      bubble.innerHTML = this.sanitizeHtml(cleanedTyping); // Sanitize before innerHTML
      // Post-innerHTML strip for residual contrib nodes.
      this.stripContribButtons(bubble);
      // Attach the sparkles-owned copy button to the finalized
      // assistant answer. Idempotent inside addCopyButton; safe on repeated
      // response events (e.g. continuation loop updates the same bubble).
      this.addCopyButton(bubble);
    }
    if (this.log) {
      this.log.scrollTop = this.log.scrollHeight;
    }
  };

  /**
   * Sets the busy state (disables the input/send while awaiting a reply).
   *
   * @param {boolean} busy
   *   Whether a request is in flight.
   */
  Controller.prototype.setBusy = function (busy) {
    this.busy = busy;
    if (this.input) {
      this.input.disabled = busy;
    }
    if (this.sendBtn) {
      this.sendBtn.disabled = busy;
    }
    this.root.setAttribute('aria-busy', busy ? 'true' : 'false');
  };

  /**
   * Removes every contrib-rendered `<div class="chat-buttons">` subtree
   * (and its nested `img.chat-button.copy`) from the given bubble.
   *
   * Contrib `ai_chatbot/src/Service/MessagesButtons::getRenderedButtons()`
   * appends `<div class="chat-buttons"><img class="chat-button copy" …></div>`
   * to each assistant history message's html when `show_copy_icon` is TRUE.
   * We send `show_copy_icon: false` on live /api/deepchat POSTs, so streamed
   * responses do not have this markup, but the baked-into-drupalSettings
   * history does. Strip it synchronously after the `innerHTML` assignment so
   * no broken/unstyled contrib button remains in the lived DOM. Idempotent.
   * No new sanitization of the rest of the html — the inherited trust
   * boundary from the XSS hardening pass stands.
   *
   * @param {HTMLElement} bubble
   *   The .asu-sparkles__bubble element.
   */
  Controller.prototype.stripContribButtons = function (bubble) {
    if (!bubble) {
      return;
    }
    const contribs = bubble.querySelectorAll('.chat-buttons');
    Array.prototype.forEach.call(contribs, function (el) {
      el.remove();
    });
  };

  /**
   * Strips contrib-rendered copy-button markup from a RAW HTML string using
   * an inert DOMParser, before the string is passed to sanitizeHtml / innerHTML.
   *
   * Root-cause fix for history-replay regression: DOMPurify strips
   * the `class` attribute from `<img class="chat-button copy">` because
   * ALLOWED_ATTR does not include `class`. This orphans the <img> so that the
   * post-innerHTML stripContribButtons(bubble) call (which queries
   * `.chat-buttons`) can no longer match it. Stripping by class BEFORE
   * sanitizeHtml, while the classes still exist in the raw string, closes the
   * gap.
   *
   * DOMParser.parseFromString(html, 'text/html') yields an **inert** document
   * with no browsing context: scripts do NOT execute and event handlers such
   * as onerror do NOT fire (proven by the stripContribButtonsFromString_is_inert
   * test). The parsed nodes are never connected to the live document — we only
   * read/remove nodes and serialize body.innerHTML back to a string, which then
   * goes through sanitizeHtml before it ever reaches a real innerHTML sink. (We
   * do not rely on any "no network fetch" guarantee; the security property we
   * depend on is no script/handler execution.) Any error falls back to returning
   * the original string so sanitizeHtml + the post-innerHTML stripContribButtons
   * defence-in-depth strip remain in effect.
   *
   * Do NOT add 'class' to ALLOWED_ATTR — that would be a broader allowance
   * than required and would open DOMPurify bypass vectors.
   *
   * @param {string} html
   *   Raw HTML string (e.g. from drupalSettings history or a server response).
   * @return {string}
   *   The HTML string with contrib button nodes removed; original if no
   *   contrib button markers found or on parse error.
   */
  Controller.prototype.stripContribButtonsFromString = function (html) {
    if (typeof html !== 'string' || html.indexOf('chat-button') === -1) {
      return html;
    }
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nodes = doc.querySelectorAll(
        '.chat-buttons, [class*="chat-button"]',
      );
      Array.prototype.forEach.call(nodes, function (n) {
        n.remove();
      });
      return doc.body ? doc.body.innerHTML : html;
    } catch (e) {
      // DOMParser unavailable or threw — sanitizeHtml + post-strip remain
      // as defense in depth.
      return html;
    }
  };

  /**
   * Appends a sparkles-owned copy button to a finalized assistant bubble.
   *
   * Produces one `<button class="asu-sparkles__copy" aria-label=
   * "Copy response">` with an inline stroked SVG copy glyph, attached as
   * the LAST child of the bubble. Idempotent: bails on null, on bubbles still
   * in the typing state, and on bubbles that already have a copy button.
   * Called from exactly TWO sites — replaceTyping (live finalization) and
   * seedFirstMessage (history replay for assistant entries).
   *
   * @param {HTMLElement} bubble
   *   The .asu-sparkles__bubble to attach to.
   */
  Controller.prototype.addCopyButton = function (bubble) {
    if (!bubble) {
      return;
    }
    // Copy icon is controlled by the native block "Add copy icon" field
    // (drupalSettings.ai_deepchat.show_copy_icon, default TRUE). Skip creating
    // the owned copy button only when it is explicitly disabled.
    if (
      drupalSettings &&
      drupalSettings.ai_deepchat &&
      drupalSettings.ai_deepchat.show_copy_icon === false
    ) {
      return;
    }
    // Never add during the typing state — the live-path call site calls
    // this AFTER replaceTyping has removed the --typing class, so this
    // guard is defense-in-depth.
    if (bubble.classList.contains('asu-sparkles__bubble--typing')) {
      return;
    }
    // Idempotency — covers attach-behavior re-entry and repeated seedFirstMessage.
    if (bubble.querySelector(':scope > .asu-sparkles__copy')) {
      return;
    }

    // Capture clean answer text BEFORE inserting the button, so the button
    // itself is excluded and the ::before sparkle (CSS pseudo, outside
    // the textContent walk) does not contribute.
    const text = (bubble.textContent || '').replace(/\s+/g, ' ').trim();

    const self = this;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'asu-sparkles__copy';
    btn.setAttribute('aria-label', Drupal.t('Copy response'));
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<rect x="8" y="8" width="12" height="12" rx="2"></rect>' +
      '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>' +
      '</svg>';
    // Store the captured text on the button so the handler can read it
    // without re-walking the DOM.
    btn._asuSparklesCopyText = text;

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      self.copyAnswerText(btn, btn._asuSparklesCopyText);
    });
    btn.addEventListener('keydown', function (ev) {
      // Native <button> activates on Enter/Space already; the explicit
      // handler defends against platforms that normalize differently.
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        self.copyAnswerText(btn, btn._asuSparklesCopyText);
      }
    });

    bubble.appendChild(btn);
  };

  /**
   * Writes the given text to the clipboard, with a graceful fallback.
   *
   * Tries `navigator.clipboard.writeText(text)` first (available
   * only in secure contexts — HTTPS); falls back to a hidden-textarea +
   * `document.execCommand('copy')` sequence for non-secure contexts and
   * legacy browsers. If both paths are unavailable OR both fail, the
   * live region announces "Copy is not supported in this browser" and
   * the button stays in rest state — no silent failure.
   *
   * @param {HTMLButtonElement} button
   *   The copy button that was activated.
   * @param {string} text
   *   The text to write.
   */
  Controller.prototype.copyAnswerText = function (button, text) {
    const self = this;
    if (!text) {
      self.onCopyFailure();
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          self.onCopySuccess(button);
        },
        function () {
          if (self.fallbackCopy(text)) {
            self.onCopySuccess(button);
          } else {
            self.onCopyFailure();
          }
        },
      );
      return;
    }
    if (self.fallbackCopy(text)) {
      self.onCopySuccess(button);
      return;
    }
    self.onCopyFailure();
  };

  /**
   * Clipboard fallback for non-secure contexts and legacy browsers.
   *
   * Creates a hidden textarea off-screen, selects its contents,
   * calls document.execCommand('copy'), and removes the textarea. Saves
   * and restores the current selection range so the user's selection
   * state is preserved. Returns TRUE on success, FALSE on any failure.
   *
   * Captures document.activeElement BEFORE focusing the textarea and
   * restores it after removal so a keyboard user's focus is not dropped to
   * <body> when the legacy fallback path runs. The primary
   * navigator.clipboard.writeText path is unchanged (it does not move focus).
   *
   * @param {string} text
   *   The text to write.
   *
   * @return {boolean}
   *   TRUE if the copy succeeded.
   */
  Controller.prototype.fallbackCopy = function (text) {
    if (!document.execCommand) {
      return false;
    }

    // Capture the currently-focused element BEFORE creating the textarea so
    // we can restore it afterward. Guards against null (nothing focused) and
    // against the element being detached from the document by the time we
    // restore (e.g. a dynamic list that mutated during the copy).
    const prev = document.activeElement || null;

    let savedRange = null;
    try {
      const sel = document.getSelection();
      if (sel && sel.rangeCount > 0) {
        savedRange = sel.getRangeAt(0);
      }
    } catch (e) {
      // Ignore — some sandbox contexts throw on getSelection().
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', 'readonly');
    textarea.setAttribute('aria-hidden', 'true');
    document.body.appendChild(textarea);

    let ok = false;
    try {
      textarea.focus();
      textarea.select();
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(textarea);

    // Restore focus to the previously-focused element so keyboard users are
    // not dropped to <body> after the fallback path runs (a11y fix).
    // Guards: prev must be non-null, must have a focus() method, and must
    // still be present in the document (guards against detached nodes).
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
      prev.focus();
    }

    if (savedRange) {
      try {
        const sel2 = document.getSelection();
        sel2.removeAllRanges();
        sel2.addRange(savedRange);
      } catch (e) {
        // Ignore — not fatal.
      }
    }
    return ok;
  };

  /**
   * Applies the transient "copied" state to the button and announces it.
   *
   * Toggles the .asu-sparkles__copy--copied class, swaps the
   * aria-label to "Copied", announces "Copied to clipboard" via the
   * .asu-sparkles__live region, and schedules a reversal in ~1500ms.
   * The reversal is a class/attribute swap — reduced motion safe.
   *
   * @param {HTMLButtonElement} button
   */
  Controller.prototype.onCopySuccess = function (button) {
    if (!button) {
      return;
    }
    button.classList.add('asu-sparkles__copy--copied');
    if (!button._asuSparklesOrigLabel) {
      button._asuSparklesOrigLabel = button.getAttribute('aria-label');
    }
    button.setAttribute('aria-label', Drupal.t('Copied'));
    this.announce(Drupal.t('Copied to clipboard'));

    if (button._asuSparklesCopyTimer) {
      window.clearTimeout(button._asuSparklesCopyTimer);
    }
    button._asuSparklesCopyTimer = window.setTimeout(function () {
      button.classList.remove('asu-sparkles__copy--copied');
      button.setAttribute(
        'aria-label',
        button._asuSparklesOrigLabel || Drupal.t('Copy response'),
      );
      button._asuSparklesCopyTimer = null;
    }, 1500);
  };

  /**
   * Announces a clipboard failure via the live region. No visual
   * button-state change — the button stays in rest state.
   */
  Controller.prototype.onCopyFailure = function () {
    this.announce(Drupal.t('Copy is not supported in this browser'));
  };

  /**
   * Renders a message bubble into the conversation log.
   *
   * @param {string} role
   *   The message role: 'user' or 'assistant'.
   * @param {string} content
   *   The message content (plain text, or HTML when isHtml is true).
   * @param {boolean} [isHtml]
   *   When true, content is inserted as HTML (and contrib copy-button
   *   markup is stripped); otherwise inserted as text.
   *
   * @return {HTMLElement}
   *   The created .asu-sparkles__bubble element.
   */
  Controller.prototype.renderMessage = function (role, content, isHtml) {
    const wrapper = document.createElement('div');
    wrapper.className = `asu-sparkles__msg asu-sparkles__msg--${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'asu-sparkles__bubble';
    if (isHtml) {
      // Strip contrib buttons from the RAW string BEFORE sanitizeHtml,
      // so DOMPurify cannot orphan the <img> by stripping its class attribute.
      // stripContribButtonsFromString uses an inert DOMParser (no script execution).
      const cleaned = this.stripContribButtonsFromString(content);
      bubble.innerHTML = this.sanitizeHtml(cleaned); // Sanitize before innerHTML
      // Post-innerHTML strip catches any residual
      // contrib .chat-buttons the string strip may have missed.
      this.stripContribButtons(bubble);
    } else {
      bubble.textContent = content;
    }
    wrapper.appendChild(bubble);
    if (this.log) {
      this.log.appendChild(wrapper);
      this.log.scrollTop = this.log.scrollHeight;
    }
    return bubble;
  };

  /**
   * Announces a message to assistive technology via the live region.
   *
   * @param {string} message
   *   The message to announce.
   */
  Controller.prototype.announce = function (message) {
    if (this.live) {
      this.live.textContent = message;
    }
  };

  // Module-scope flag: DOMPurify afterSanitizeAttributes hook is
  // installed at most once per page load (idempotent).
  let _domPurifyHookInstalled = false;

  /**
   * Sanitizes a server/history HTML string before it is written to innerHTML.
   *
   * XSS hardening. Uses DOMPurify when available (loaded via the
   * asu_ai_chatbot_styles/dompurify library dependency); falls back to the
   * module-scope fallbackSanitize() inert-document scrubber when DOMPurify
   * failed to load. Both paths enforce the 21-tag allowlist that mirrors
   * contrib DeepChatApi::$allowedTags. The afterSanitizeAttributes hook is
   * installed once (idempotent) to force rel="noopener noreferrer" on every
   * <a target="_blank"> anchor.
   *
   * Call before every untrusted innerHTML assignment. Safe to call on null/
   * undefined (returns '').
   *
   * @param {string|null} html
   *   Raw HTML from the server or baked drupalSettings history.
   * @return {string}
   *   Sanitized HTML string.
   */
  Controller.prototype.sanitizeHtml = function (html) {
    if (html == null) {
      return '';
    }
    if (typeof DOMPurify !== 'undefined' && DOMPurify.sanitize) {
      // One-time hook: force rel on target=_blank anchors. Installed at module
      // scope on first use (idempotent) so we never leak across calls.
      if (!_domPurifyHookInstalled) {
        DOMPurify.addHook('afterSanitizeAttributes', function (node) {
          if (
            node.nodeName === 'A' &&
            node.getAttribute('target') === '_blank'
          ) {
            node.setAttribute('rel', 'noopener noreferrer');
          }
        });
        _domPurifyHookInstalled = true;
      }
      return DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ADD_ATTR: ['target'], // target survives; rel forced above
        KEEP_CONTENT: true, // strip disallowed tags, keep their text
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false,
      });
    }
    // Fallback: inert DOMParser allowlist scrubber. Called only when the
    // DOMPurify library failed to load (defensive — the library dependency
    // guarantees it is present at normal attach time).
    return fallbackSanitize(html);
  };

  /**
   * Toggles the disabled state of input/send/chips/clearBtn and the --resetting CSS class.
   *
   * Helper for clearConversation's resetting gate.
   * Also disables preset chips and the clear button so
   * the user cannot trigger another clear or a chip question mid-reset.
   * Chips are <button> elements (verified in ai-deepchat--asu-sparkles.html.twig),
   * so native .disabled is sufficient — no aria-disabled needed.
   *
   * @param {boolean} flag
   *   Whether resetting is active.
   */
  Controller.prototype._setResettingUi = function (flag) {
    if (this.input) {
      this.input.disabled = !!flag;
    }
    if (this.sendBtn) {
      this.sendBtn.disabled = !!flag;
    }
    // Disable / re-enable preset chips.
    if (this.chips && this.chips.length) {
      this.chips.forEach(function (c) {
        c.disabled = !!flag;
      });
    }
    // Disable / re-enable the clear button.
    if (this.clearBtn) {
      this.clearBtn.disabled = !!flag;
    }
    // Disable / re-enable the ellipsis menu button.
    if (this.menuBtn) {
      this.menuBtn.disabled = !!flag;
    }
    if (this.root) {
      this.root.classList.toggle('asu-sparkles--resetting', !!flag);
    }
  };

  Drupal.behaviors.asuAiChatbotSparkles = {
    attach(context) {
      once('asu-sparkles', '.asu-sparkles', context).forEach(function (root) {
        root._asuSparklesController = new Controller(root);
      });
    },
    // Tear down the header-measurement resize listener and
    // pending debounce timer when the context element is removed from the
    // document (e.g. AJAX page fragments, Turbolinks, Drupal BigPipe
    // element removals). Prevents listener accumulation on re-attach.
    // Run on ALL triggers (not just 'unload'), and include the
    // context root itself when it is a .asu-sparkles element (querySelectorAll
    // excludes context, so we must add it explicitly when it matches).
    detach(context, settings, trigger) {
      // Build the set of roots to clean up: context itself (if it is a
      // .asu-sparkles element) plus any matching descendants.
      const roots = [];
      if (
        context &&
        typeof context.matches === 'function' &&
        context.matches('.asu-sparkles')
      ) {
        roots.push(context);
      }
      if (context && typeof context.querySelectorAll === 'function') {
        const descendants = context.querySelectorAll('.asu-sparkles');
        Array.prototype.forEach.call(descendants, function (el) {
          if (roots.indexOf(el) === -1) {
            roots.push(el);
          }
        });
      }
      Array.prototype.forEach.call(roots, function (root) {
        const c = root._asuSparklesController;
        if (!c) {
          return;
        }
        c.destroyOpenHeightTracking(); // Open-height MO + listeners
        c.destroyHeaderMeasurement(); // All measurement listeners + ROs
        // Close menu and null out outside-click handle.
        if (c._menuOpen) {
          c.closeMenu({ restoreFocus: false });
        }
        c.menuItems = [];
        // Abort any in-flight network requests so detached nodes
        // do not receive responses after the widget has been removed.
        if (c._abortController) {
          c._abortController.abort();
          c._abortController = null;
        }
        if (c._resetAbortController) {
          // Set _detaching so the resulting AbortError in the catch stays
          // SILENT — widget is being torn down; no announce needed.
          c._detaching = true;
          c._resetAbortController.abort();
          c._resetAbortController = null;
        }
        // Clear the reset timeout so it cannot fire on a
        // detached controller and attempt to modify an orphaned instance.
        if (c._resetTimer) {
          clearTimeout(c._resetTimer);
          c._resetTimer = null;
        }
      });
    },
  };

  // Expose the Controller + test namespace for later layers and the jsdom
  // unit harness. The _test namespace is never called by production code;
  // the _test prefix signals intent and the guard below prevents any
  // exposure when the namespace is not expected.
  Drupal.AsuSparkles = {
    Controller,
    _test: {
      readSseStream,
      sanitizeHtml: Controller.prototype.sanitizeHtml,
      fallbackSanitize,
      stripContribButtonsFromString:
        Controller.prototype.stripContribButtonsFromString,
      CONTINUATION_LIMIT,
      fitOpenMeasure,
    },
  };
})(Drupal, drupalSettings, once);
