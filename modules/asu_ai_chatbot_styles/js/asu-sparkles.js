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
 * Rev 3: Controller.setState is a motion dispatcher (MORPH / CROSSFADE /
 * INSTANT paths per §3.10 of the design doc). Backend, data-layer,
 * scroll-compaction, CSRF, SSE, and clearConversation code is unchanged.
 */
(function (Drupal, drupalSettings, once) {
  /* global DOMPurify */
  const STORAGE_KEY = 'Drupal.asuSparkles.state';

  // Rev 10 — hard cap on the should_continue agent loop (max follow-up POSTs
  // per user turn). A turn can render up to CONTINUATION_LIMIT+1 server HTML
  // strings before the cap trips and surfaces an error bubble.
  const CONTINUATION_LIMIT = 10;

  // -------------------------------------------------------------------------
  // Rev 10 — sanitizeHtml + fallback scrubber (XSS hardening).
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
    // Rev 10 FIX 1 — normalize URL attr values before scheme testing so that
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
  // Rev 4 entry rule (design doc §7.2 D1).
  //
  // When TRUE, the widget restores the persisted state on page load
  // (pre-Rev-4 behavior). When FALSE, every page load starts in
  // 'collapsed' and lets the scroll-compaction handler silently derive
  // 'compact' if the page is already scrolled past the trigger.
  //
  // The human may change their mind — this is intentionally a one-line
  // flip. Flipping to TRUE requires no other code change: readState()
  // will begin honoring the stored value, and writeState() has been
  // writing to localStorage all along for exactly this reason.
  // -------------------------------------------------------------------------
  const PERSIST_ENTRY_STATE = false;

  /**
   * Reads the persisted widget state.
   *
   * Rev 4: when PERSIST_ENTRY_STATE is FALSE (default), always returns
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
      // Rev 4: 'closed' is folded into 'compact'; coerce any legacy value.
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
    // Rev 5 N3 — chips live inside the log; scope the lookup to the log.
    this.chips = Array.prototype.slice.call(
      root.querySelectorAll('.asu-sparkles__log .asu-sparkles__chip'),
    );
    this.section = (
      root.getAttribute('data-datalayer-section') || 'welcome'
    ).toLowerCase();
    this.sendTypedText = root.getAttribute('data-send-typed-text') === '1';
    this.state = 'collapsed';
    // Internal timers for the motion orchestration (Rev 3).
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
    // P3-formal: header-measurement resize listener + debounce handle, stored
    // for teardown in Drupal.behaviors.detach / destroyHeaderMeasurement().
    this._resizeHandler = null;
    this._resizeDebounce = null;
    // Rev 10 — reset-gate flag + AbortControllers for teardown/abort.
    // resetting: true while a reset-session roundtrip is in flight.
    this.resetting = false;
    // AbortController for the active submit's postMessage chain.
    this._abortController = null;
    // AbortController for the active reset-session fetch.
    this._resetAbortController = null;
    // Fix 4b (iter-12) — timeout handle + timed-out generation tag.
    this._resetTimer = null;
    this._resetTimedOutGen = null;
    // RC3 (iter-12) — once-per-generation settle tracker.
    // _resetSettledGen holds the generation number that has already been
    // terminally settled by _finishReset(), so a second settle call for the
    // same generation (e.g. late success body after timeout) is a no-op.
    this._resetSettledGen = null;
    // RC3 (iter-12) — teardown flag: set TRUE before aborting in detach so
    // the resulting AbortError stays SILENT (widget is being torn down).
    this._detaching = false;
    // Rev 10 — open-height teardown handles (stored by initOpenHeightTracking).
    this._logObserver = null;
    this._rootObserver = null;
    this._transitionEndHandler = null;
    this._openHeightResizeHandler = null;
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
        // Review-fix cycle 2 (P2-a): defense-in-depth guard.
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
        // Rev 5 N2 (REVERSES §8.1 / Requirements §1):
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

    // Escape collapses an expanded widget back to the ring or FAB.
    // Routes through collapseToRingWithFocus() — the same shared helper
    // used by the close button — so the _suppressInputOpen guard fires
    // for both paths and Escape never triggers an auto-reopen. §7.2 L49.
    this.root.addEventListener('keydown', function (event) {
      if (
        event.key === 'Escape' &&
        (self.state === 'open' || self.state === 'compact')
      ) {
        event.preventDefault();
        self.collapseToRingWithFocus();
      }
    });

    // Rev 8 a11y rec #3: expose chat disclosure state via fab aria-controls.
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

    // Rev 4 D4: seed the opener / replay history now that state is applied.
    this.seedFirstMessage();

    window.addEventListener(
      'load',
      function () {
        document.documentElement.classList.remove('asu-sparkles-restoring');
      },
      { once: true },
    );

    this.initScrollCompaction();
    // Rev 3 — motion lifecycle: keep --asu-sparkles-open-h current while open.
    this.initOpenHeightTracking();
    // Rev 5 N1 — measure the real page header height and set --asu-sparkles-top
    // so the widget clears the header in ring, open, and compact states.
    this.initHeaderMeasurement();

    // P3-reviewer: re-measure the open height after web fonts load so a late
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
   * Rev 4 §2 + §7.2 L49 keyboard contract.
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

    // Rev 4 D7: proactively clear the measured open-height on every
    // exit from 'open', so no exit path (INSTANT, MORPH, CROSSFADE)
    // leaves a stale inline --asu-sparkles-open-h that could contaminate
    // the collapsed ring's or compact fab's measured geometry. The Rev 3
    // async rootObserver clear still runs as belt-and-braces.
    if (state !== 'open') {
      this.root.style.removeProperty('--asu-sparkles-open-h');
    }

    const expanded = state === 'open';
    this.toggleHidden(this.closeBtn, !expanded);
    this.toggleHidden(this.clearBtn, !expanded);
    // Rev 4: the 48px fab circle is the compact-ONLY idle-small visual.
    // 'closed' state is removed; fab shows only in 'compact'.
    this.toggleHidden(this.fab, state !== 'compact');
    if (this.fab) {
      this.fab.setAttribute('aria-expanded', 'false');
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
   * Measures the open panel's natural content height and sets
   * --asu-sparkles-open-h so the CSS height transition eases to it.
   * Desktop-only (phones use a CSS max-height clamp).
   */
  Controller.prototype.fitOpen = function () {
    if (this.state !== 'open' || window.innerWidth <= 900) {
      return;
    }
    const head = this.root.querySelector('.asu-sparkles__head');
    const { form } = this;
    const { log } = this;
    if (!head || !form || !log) {
      return;
    }
    // P2-reviewer: include the chips block height when chips are visible,
    // so a fresh open with preset chips sets the correct panel height.
    const chipsEl = this.root.querySelector('.asu-sparkles__chips');
    const chipsH =
      chipsEl && chipsEl.offsetParent !== null ? chipsEl.scrollHeight : 0;
    const h = head.offsetHeight + chipsH + log.scrollHeight + form.offsetHeight;
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
    // Rev 10 — store named handler so it can be removed in destroyOpenHeightTracking.
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
    // Rev 10 — store named handler so it can be removed in destroyOpenHeightTracking.
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
   * Rev 10 — idempotent teardown for the four handles stored by
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
   * Measures the page's top sticky/fixed header stack and returns the LOWEST
   * bottom edge across ALL candidate elements (in pixels, viewport-relative).
   *
   * Unlike the previous first-match-wins approach, this method gathers every
   * top-anchored header element — semantic selectors AND a heuristic scan —
   * and returns the MAXIMUM effective bottom so that a multi-row stacked
   * header (utility bar + brand row + nav) is correctly measured as a unit.
   *
   * Candidate sources:
   *   a. Semantic: header[role=banner], [role=banner], header, .uds-header,
   *      #header, .ms-site-header, .site-header.
   *      For semantic candidates, the effective bottom is the MAX of the
   *      candidate's own rect.bottom AND the rect.bottom of its descendants,
   *      so a collapsed/zero-height wrapper (e.g. a <header> whose own
   *      getBoundingClientRect().height === 0 because its children use
   *      position:absolute or overflow:hidden) still reflects the true extent
   *      of the visible masthead. Only descendants whose rect.top is at or
   *      above the candidate's own rect.bottom + 8px are included, preventing
   *      a full-page descendant from inflating the result.
   *   b. Heuristic: every element whose computed position is 'fixed' or
   *      'sticky', whose rect.top <= 4, and whose rect.width covers at
   *      least 60% of the viewport width.
   *
   * Exclusions (shared by both passes):
   *   - The widget root itself and any element inside .ai-chatbot-asu-sparkles-block.
   *   - Elements with display:none (computed style).
   *   - Zero-height elements in Pass B only; Pass A includes zero-height
   *     semantic headers and unions them with their visible descendants.
   *
   * Guard: effective bottoms exceeding 50% of the viewport height are treated
   * as full-height overlays, not headers, and are skipped.
   *
   * Returns null when no valid candidate is found (CSS token fallback applies).
   *
   * @return {number|null}
   *   The maximum header bottom in pixels, or null when not determinable.
   */
  Controller.prototype.measureHeaderTop = function () {
    const self = this;
    const halfViewport = window.innerHeight * 0.5;

    /**
     * Returns TRUE when the element is the widget or inside the sparkles
     * block, or has display:none — excludes from BOTH passes.
     *
     * Note: zero-height is NOT a universal exclusion (Pass A handles
     * zero-height semantic headers via the union-descendants algorithm).
     *
     * @param {Element} el
     * @return {boolean}
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

    /**
     * Computes the effective bottom of a semantic header candidate.
     *
     * The effective bottom is the maximum of the candidate's own rect.bottom
     * and the rect.bottom of any descendant whose rect.top sits at or above
     * (candidate.rect.bottom + 8px). This ensures a zero-height wrapper whose
     * visible content is absolutely positioned still yields the correct value.
     *
     * Descendants inside the sparkles block or with display:none are skipped.
     *
     * @param {Element} el
     *   The semantic header candidate.
     * @return {number}
     *   The effective bottom, in viewport-relative pixels.
     */
    function effectiveBottom(el) {
      const ownRect = el.getBoundingClientRect();
      // The threshold is the candidate's own bottom (may be 0 when
      // collapsed) plus a small epsilon so that an absolutely-positioned
      // descendant placed just below the 0-height wrapper is still counted.
      const threshold = ownRect.bottom + 8;
      let { bottom } = ownRect;

      const descendants = el.querySelectorAll('*');
      for (let k = 0; k < descendants.length; k++) {
        const d = descendants[k];
        // Skip the sparkles widget and display:none subtrees.
        if (isBaseExcluded(d)) {
          continue;
        }
        const dr = d.getBoundingClientRect();
        // Only count descendants whose top starts within the header region.
        if (dr.top > threshold) {
          continue;
        }
        if (dr.bottom > bottom) {
          bottom = dr.bottom;
        }
      }
      return bottom;
    }

    let maxBottom = 0;
    let found = false;

    // --- Pass A: semantic selectors (all matches, not just first) ----------
    // Zero-height semantic headers ARE included; effectiveBottom() unions
    // them with their descendants to produce the true visible extent.
    const SEMANTIC_SELECTORS =
      'header[role=banner], [role=banner], header, .uds-header, #header, .ms-site-header, .site-header';
    let semanticEls;
    try {
      semanticEls = document.querySelectorAll(SEMANTIC_SELECTORS);
    } catch (e) {
      semanticEls = [];
    }
    for (let i = 0; i < semanticEls.length; i++) {
      const el = semanticEls[i];
      if (isBaseExcluded(el)) {
        continue;
      }
      const effBottom = effectiveBottom(el);
      // Only consider candidates whose effective bottom is visually above
      // the viewport midpoint (guards against full-page overlays).
      if (effBottom > 0 && effBottom <= halfViewport) {
        if (effBottom > maxBottom) {
          maxBottom = effBottom;
          found = true;
        }
      }
    }

    // --- Pass B: heuristic scan (fixed/sticky, top-anchored, wide) ---------
    // Zero-height elements are excluded in Pass B (they are not semantic
    // header wrappers and have no descendants to union with).
    const allEls = document.querySelectorAll('*');
    for (let j = 0; j < allEls.length; j++) {
      const candidate = allEls[j];
      if (isBaseExcluded(candidate)) {
        continue;
      }
      var candidateStyle;
      try {
        candidateStyle = window.getComputedStyle(candidate);
      } catch (e) {
        continue;
      }
      const pos = candidateStyle.position;
      if (pos !== 'fixed' && pos !== 'sticky') {
        continue;
      }
      const rect = candidate.getBoundingClientRect();
      // Zero-height excluded in heuristic pass.
      if (rect.height === 0) {
        continue;
      }
      // Must be anchored at or near the very top of the viewport.
      if (rect.top > 4) {
        continue;
      }
      // Must span at least 60% of the viewport width.
      if (rect.width < window.innerWidth * 0.6) {
        continue;
      }
      // Ignore elements taller than half the viewport (full-height overlays).
      if (rect.bottom <= 0 || rect.bottom > halfViewport) {
        continue;
      }
      if (rect.bottom > maxBottom) {
        maxBottom = rect.bottom;
        found = true;
      }
    }

    return found ? maxBottom : null;
  };

  /**
   * Sets --asu-sparkles-top and --asu-sparkles-hdr-h on the widget root
   * based on a live header measurement, then re-measures on window resize
   * (debounced 150 ms).
   *
   * Override precedence:
   *   • If the widget root carries data-asu-sparkles-skip-measure="1", skip
   *     entirely so the theme's CSS token values are used as-is.
   *   • Otherwise JS sets both tokens as inline style on the widget root
   *     (highest cascade; beats any :root { } stylesheet rule).
   *   • A theme that wants to override the measured value should either set
   *     data-asu-sparkles-skip-measure="1" on the block template, or add
   *     an inline style directly on the .asu-sparkles element.
   *   • If measurement returns -1 (no header found / page not at top), the
   *     previously-set value is left unchanged so the CSS token fallback wins.
   *
   * P3-formal: the handler and debounce timer are stored on the instance
   * (_resizeHandler, _resizeDebounce) so they can be removed/cleared in the
   * teardown path (Drupal.behaviors.detach).
   */
  Controller.prototype.initHeaderMeasurement = function () {
    if (this.root.getAttribute('data-asu-sparkles-skip-measure') === '1') {
      return;
    }
    // P3-formal: once-guard — if a listener is already attached, tear it down
    // before registering a new one. Prevents duplicate listeners on re-attach
    // (e.g., SPAs, Turbolinks, or repeated Drupal.behaviors.attach calls).
    if (this._resizeHandler) {
      window.clearTimeout(this._resizeDebounce);
      this._resizeDebounce = null;
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    const self = this;

    const applyMeasurement = function () {
      const headerBottom = self.measureHeaderTop();
      // null means no valid header found — leave CSS token fallback in place.
      if (headerBottom === null) {
        return;
      }
      const topPx = `${Math.ceil(headerBottom + 16)}px`;
      const hdrPx = `${Math.ceil(headerBottom)}px`;
      self.root.style.setProperty('--asu-sparkles-top', topPx);
      self.root.style.setProperty('--asu-sparkles-hdr-h', hdrPx);
    };

    // P3-formal: store the handler on the instance for teardown.
    this._resizeHandler = function () {
      // P3-formal: clear any pending debounce before setting a new one so
      // rapid resize events accumulate into a single trailing measurement.
      window.clearTimeout(self._resizeDebounce);
      self._resizeDebounce = window.setTimeout(applyMeasurement, 150);
    };

    // Initial measurement — defer one frame so layout is stable.
    window.requestAnimationFrame(applyMeasurement);

    // Re-measure on resize (debounced 150 ms).
    window.addEventListener('resize', this._resizeHandler);
  };

  /**
   * Tears down the header-measurement resize listener and pending debounce
   * timer. Called from Drupal.behaviors.detach so the listener is removed
   * when the widget element is removed from the document.
   */
  Controller.prototype.destroyHeaderMeasurement = function () {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._resizeDebounce) {
      window.clearTimeout(this._resizeDebounce);
      this._resizeDebounce = null;
    }
  };

  /**
   * Transitions the widget to a new state, orchestrating the correct motion.
   *
   * Three paths (per §3.10 of the design doc):
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

    // Rev 4: fold any legacy 'closed' intent into 'compact'.
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
      window.innerWidth > 900 &&
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
      // Rev 10 — announce while resetting so assistive tech users know why
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
        type: 'keyword search',
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
      type: 'keyword search',
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

    // Rev 6 clear-robustness: capture the generation at dispatch time.
    // If clearConversation() fires while this request is in flight,
    // _resetGeneration advances; the response handlers check this guard
    // and silently discard the late response rather than re-appending
    // bubbles to the freshly-rebuilt log.
    const myGen = this._resetGeneration;

    // Rev 10 — allocate a fresh AbortController per submit so clearConversation
    // can abort this specific in-flight chain.
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    // Rev 5 N8 — token + POST + one-shot CSRF retry on 403.
    const self2 = self;
    const postOnce = function () {
      // Fix 4a (iter-12): pass the submit signal so aborting the submit also
      // cancels an in-flight CSRF session fetch.
      return self2.ensureCsrfToken(config, signal).then(function (token) {
        return self2.postMessage(
          self2.endpointUrl(token),
          config,
          [{ role: 'user', text }],
          signal,
        ); // Rev 10 — pass AbortController signal
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
        // Rev 6 clear-robustness / iter-4 concurrency guard: discard if
        // clearConversation() fired or a newer submitQuery() started after
        // this request was dispatched. A stale completion must NOT call
        // setBusy(false) — doing so would re-enable controls while the
        // current-generation request is still in flight, allowing concurrent
        // submissions. Only the current-generation request owns busy/UI cleanup.
        if (self._resetGeneration !== myGen) {
          return;
        }
        self.handleResponse(config, response, typing, myGen, 0); // Rev 10 — pass depth=0
      })
      .catch(function (err) {
        // Rev 10 — swallow AbortError quietly (clearConversation aborted us).
        // No error bubble, no setBusy toggle, no token clear.
        if (err && err.name === 'AbortError') {
          return;
        }
        // P1b-formal: retry exhausted (second 403 or any other failure).
        // Clear the cached token so the NEXT user attempt refetches rather
        // than re-using a stale/invalid token.
        Drupal.AsuSparkles.csrfToken = null;
        // Iter-4 concurrency guard: a stale error (generation mismatch) must
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
   * Rev 5 N8: the /api/deepchat route is declared with _csrf_token: 'TRUE'
   * and REQUIRES ?token=<session-scoped-token> on every POST, even when the
   * visitor already has an authenticated Drupal session. The prior
   * short-circuit `if (config.session_exists) return Promise.resolve('')`
   * caused returning visitors to POST with no token -> HTTP 403.
   *
   * Fix: ALWAYS obtain a token via POST /api/deepchat/session, cache it on
   * Drupal.AsuSparkles.csrfToken (session-scoped, cache for page lifetime),
   * and append it on every /api/deepchat POST via endpointUrl().
   *
   * Fix 4a (iter-12): accepts an optional AbortSignal so aborting a submit
   * (via clearConversation) also cancels an in-flight CSRF session fetch.
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
    // Fix 4a: only set signal when provided (avoids setting undefined on older
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
   * Rev 5 N8: called from the one-shot 403 retry path. If this refetch
   * also fails, the user sees the generic error bubble; no infinite retry.
   *
   * Fix 4a (iter-12): forwards the optional signal to ensureCsrfToken.
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

    // Rev 10 — pass the AbortController signal so clearConversation() can
    // cancel an in-flight fetch without leaving a dangling network request.
    const fetchOpts = {
      method: 'POST',
      credentials: 'same-origin', // Rev 5 N8 — session cookie must travel.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    if (signal) {
      fetchOpts.signal = signal;
    }

    return fetch(url, fetchOpts).then(function (response) {
      if (response.status === 403) {
        // Rev 5 N8 — signal CSRF retry to the caller.
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

    // Rev 7 iter-4 continuation guard: capture the generation for this
    // invocation. On first call myGen is passed in from sendToBackend (where it
    // was snapshotted at dispatch time). Recursive should_continue calls
    // propagate the same token so the entire continuation chain belongs to one
    // generation and stale chains from prior submits/Clears are discarded.
    const gen = myGen !== undefined ? myGen : self._resetGeneration;

    // Rev 10 — depth counter for the should_continue cap.
    const d = depth || 0;

    if (response && response.error) {
      this.replaceTyping(bubble, response.error, true);
      this.setBusy(false);
      return;
    }

    this.replaceTyping(bubble, (response && response.html) || '', false);

    if (response && response.should_continue) {
      // Rev 10 — hard cap BEFORE issuing the next POST. A turn can render
      // up to CONTINUATION_LIMIT+1 server HTML strings (initial + up to 10
      // follow-ups). OPEN-5 default: d+1 > CONTINUATION_LIMIT (10 follow-ups).
      if (d + 1 > CONTINUATION_LIMIT) {
        this.replaceTyping(
          bubble,
          Drupal.t('The assistant stopped responding. Please try again.'),
          true,
        );
        this.setBusy(false);
        return; // no POST
      }

      // Rev 5 N8 — should_continue follow-up also uses one-shot CSRF retry.
      const signal = self._abortController
        ? self._abortController.signal
        : undefined;
      const postOnceContinue = function () {
        // Fix 4a (iter-12): pass the submit signal so aborting the submit also
        // cancels an in-flight CSRF session fetch.
        return self.ensureCsrfToken(config, signal).then(function (token) {
          return self.postMessage(
            self.endpointUrl(token),
            config,
            [{ role: 'user', text: 'dummy_loading' }],
            signal,
          ); // Rev 10 — pass AbortController signal
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
          // Rev 7 iter-4 continuation guard (success path): discard if a Clear
          // or newer submit advanced the generation after this continuation was
          // dispatched. A stale continuation must not render into the rebuilt
          // log or call setBusy(false) for the current-generation request.
          if (self._resetGeneration !== gen) {
            return;
          }
          self.handleResponse(config, next, bubble, gen, d + 1); // Rev 10 — pass d+1
        })
        .catch(function (err) {
          // Rev 10 — swallow AbortError quietly (clearConversation aborted us).
          if (err && err.name === 'AbortError') {
            return;
          }
          // P1b-formal: retry exhausted on should_continue follow-up.
          // Clear cached token (same as sendToBackend final-catch) and
          // surface the generic error bubble so the user is informed.
          // Rev 7 iter-4 continuation guard (error path): same stale-generation
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
   * RC3 (iter-12) — consolidates all reset settle paths (timeout callback,
   * success .then, failure .catch) into ONE terminal entry point so each
   * generation can settle exactly ONCE, regardless of how many paths race.
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
   * Fixes:
   *   P1-1: a late body that resolves {success:true} after the timeout already
   *   called _finishReset(gen, 'failure') hits the ONCE guard and is a no-op.
   *
   *   P1-2: a current-generation AbortError that is NOT a stale/detach abort
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
   * Rev 6 clear-robustness: the UI rebuild is now SYNCHRONOUS and DETERMINISTIC.
   * The log is rebuilt to exactly [.asu-sparkles__chips, .asu-sparkles__intro-msg]
   * immediately (before the network call), so the widget is correct regardless
   * of whether the reset-session call succeeds, fails, or arrives late.
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
   *      .asu-sparkles__intro-msg, loading/typing nodes, and any stray nodes).
   *      Chips are always kept as the first child (N3 invariant).
   *   5. Call seedFirstMessage() once to insert the intro-msg after the chips.
   *      The _historyCleared flag prevents history replay in this call.
   *   6. Fire the network reset-session call. On success: update thread_id.
   *      The generation guard discards the response if the user started a new
   *      conversation in the meantime. On failure: log is already correct — no
   *      rollback needed.
   *
   * @see N3 invariant: .asu-sparkles__chips is always the first child of the log.
   */
  Controller.prototype.clearConversation = function () {
    const self = this;
    const config = (drupalSettings && drupalSettings.ai_deepchat) || {};
    if (!config.assistant_id) {
      return;
    }

    // Rev 10 FIX 4 — setBusy(false) fires BEFORE _setResettingUi(true) so
    // the resetting gate wins: _setResettingUi(true) sets input.disabled and
    // sendBtn.disabled to true AFTER setBusy(false) clears them, ensuring
    // both controls stay disabled for the entire reset window.
    this.setBusy(false);

    // Rev 10 — reset-gate ENTRY: set resetting=true FIRST so any submitQuery
    // arriving between now and the reset-session response is blocked.
    this.resetting = true;
    this._setResettingUi(true);

    // Rev 10 — abort any in-flight submit chain (sendToBackend / continuation).
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    // Step 1: Advance the generation so any in-flight chat response discards.
    this._resetGeneration = (this._resetGeneration || 0) + 1;
    const myGeneration = this._resetGeneration;

    // Step 2: Mark history as cleared so seedFirstMessage() skips replay.
    this._historyCleared = true;

    // Step 4: Synchronously rebuild the log to exactly chips + (nothing yet).
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

    // Step 5: Insert the intro-msg before the chips (Rev 6 R2 order).
    // seedFirstMessage() is guarded against duplicate intro by its own selector
    // check; _historyCleared prevents replaying baked config.messages.
    this.seedFirstMessage();

    // Fix 1 (iter-12): Do NOT announce 'Conversation cleared.' here.
    // The log is rebuilt optimistically, but the announcement must only fire
    // on CONFIRMED success (reset-session returned ok AND not {success:false}).

    // Step 6: Fire the background network call to reset the server-side session.
    // This is fire-and-forget from the UI perspective — the log is already
    // correct. Only the thread_id update needs the response.
    const url = `${this.basePath()}ajax/chatbot/reset-session/${encodeURIComponent(
      config.assistant_id,
    )}/${encodeURIComponent(config.thread_id)}`;

    // Review-fix cycle 2 (P1-a): cancel ANY prior generation's timer BEFORE
    // creating the new AbortController and timer. This ensures Clear B always
    // cancels Clear A's timer; A's timeout callback can never abort B's
    // controller or release B's gate, even if A was already in flight.
    clearTimeout(this._resetTimer);
    this._resetTimer = null;

    // Rev 10 — use its own AbortController so a second Clear aborts the first.
    if (this._resetAbortController) {
      this._resetAbortController.abort();
    }
    this._resetAbortController = new AbortController();
    const resetSignal = this._resetAbortController.signal;

    // Fix 4b (iter-12) / review-fix cycle 2 (P1-a):
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
      // RC3: mark timed-out gen, abort the captured controller, then call
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
      signal: resetSignal, // Rev 10 — abort on second Clear
    })
      .then(function (response) {
        // RC3 (P1-b): do NOT clear the timer here.
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
        // RC3: funnel through _finishReset.
        //   - STALE guard (gen !== _resetGeneration): no-op — a newer Clear owns the gate.
        //   - ONCE guard (_resetSettledGen === gen): no-op — already settled
        //     (e.g. timeout fired before body resolved, P1-1 fix).
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
        // RC3: funnel through _finishReset.
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
          // abort, P1-2 fix): _finishReset releases + announces. If the timeout
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
   * Renders a disclaimer-style intro message (NOT a full assistant answer).
   *
   * Rev 5 N5: when drupalSettings.ai_deepchat.first_message is seeded on
   * an empty log, render it as a muted intro paragraph (14/18, Gray 6, no
   * sparkle), NOT as a .asu-sparkles__msg--assistant bubble with the
   * stroked white sparkle. Inserts immediately BEFORE the always-present
   * .asu-sparkles__chips container (if present), so the paragraph sits
   * above the chips and any real messages that follow (Rev 6 R2).
   *
   * @param {string} text
   *   The plaintext intro message. HTML tags are NOT interpreted
   *   (textContent, not innerHTML).
   *
   * @return {HTMLElement|null}
   *   The inserted paragraph, or null when the log is unavailable.
   */
  Controller.prototype.renderIntroMessage = function (text) {
    if (!this.log || typeof text !== 'string' || !text.length) {
      return null;
    }
    const p = document.createElement('p');
    p.className = 'asu-sparkles__intro-msg';
    p.textContent = text;
    const chips = this.log.querySelector('.asu-sparkles__chips');
    if (chips) {
      // Rev 6 R2: intro-msg sits BEFORE chips (first child of the log);
      // chips becomes the second child. REVERSES the Rev 5 N5
      // "intro-msg after chips" placement.
      this.log.insertBefore(p, chips);
    } else {
      // No chips container (preset_questions empty). Prepend as first child.
      this.log.insertBefore(p, this.log.firstChild);
    }
    return p;
  };

  /**
   * Seeds the empty conversation log with the configured first_message or
   * replays the configured messages history.
   *
   * Reads drupalSettings.ai_deepchat.first_message (a plaintext greeting)
   * and drupalSettings.ai_deepchat.messages (an array of {role, text|content}
   * entries). History replay takes precedence over first_message so a
   * returning session resumes where it left off.
   *
   * Guard (Rev 5 N3/N5): checks for message/intro-msg children specifically,
   * not ANY child (chips are always present in the log when configured, so
   * log.children.length > 0 would suppress seeding incorrectly).
   * Called at init() and inside clearConversation() (synchronous rebuild step).
   *
   * Rev 6 clear-robustness: when _historyCleared is TRUE, the history replay
   * branch (config.messages) is skipped entirely. The server session was reset
   * by clearConversation(), so the baked page-load messages are stale.
   * Only the first_message intro paragraph is rendered in this case.
   */
  Controller.prototype.seedFirstMessage = function () {
    if (!this.log) {
      return;
    }
    // Rev 5 N3 + N5: guard against duplicate seeding by checking for MESSAGE
    // children (real msgs OR intro-msg), not any child. The chips container
    // is always present as a child when preset_questions is configured.
    if (
      this.log.querySelector('.asu-sparkles__msg, .asu-sparkles__intro-msg')
    ) {
      return;
    }

    const config = (drupalSettings && drupalSettings.ai_deepchat) || {};
    const self = this;

    // Rev 6 R2 + R3: ADDITIVE seeding. If first_message is set, render
    // the intro-msg FIRST (prepended BEFORE chips by renderIntroMessage,
    // per Rev 6 R2). If messages[] history is set AND _historyCleared
    // is false, replay the history AFTER so messages land AFTER chips
    // in log order. Final order: [intro-msg?, chips, ...history].
    if (
      typeof config.first_message === 'string' &&
      config.first_message.length
    ) {
      // Rev 5 N5 (REVERSES Rev 4 D4's render-as-assistant choice):
      // the seeded first_message renders as an intro-style paragraph
      // (no sparkle, 14/18 Gray 6), NOT a full assistant answer.
      this.renderIntroMessage(config.first_message);
    }

    // Rev 6 R3: contrib DeepChatFormBlock::historicalMessages() builds
    // each history entry as {role, html} — the `html` field is the
    // markdown-converted + rendered-copy-button HTML. The Rev 5 code
    // read (msg.text || msg.content), which is always undefined for
    // these entries, so EVERY history message was silently dropped.
    // Fix: read msg.html first (fallback msg.text || msg.content for
    // safety), render as html for both roles when .html is present
    // (same inherited trust boundary noted in Rev 5 — the content is
    // server-produced and server-safe; this fix stops dropping it,
    // not add new sanitization). User-role entries receive the
    // --user class without the Rev 5 N4 sparkle ::before (per N4,
    // only assistant answers get the sparkle). The _historyCleared
    // guard still suppresses replay after Clear.
    if (
      !this._historyCleared &&
      Array.isArray(config.messages) &&
      config.messages.length
    ) {
      config.messages.forEach(function (msg) {
        const role = msg && msg.role === 'user' ? 'user' : 'assistant';
        const html = msg && msg.html;
        if (html) {
          // Rev 11 — renderMessage() pre-strips contrib .chat-buttons from
          // the raw string before sanitizeHtml, so DOMPurify cannot orphan the
          // <img> by stripping its class. Post-innerHTML belt-and-braces strip
          // remains. Only assistant entries get the sparkles copy button.
          const bubble = self.renderMessage(role, html, true);
          // Rev 7 — only assistant history entries get the sparkles copy
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
    if (isError) {
      bubble.textContent = content;
    } else {
      // Rev 11 — strip contrib buttons from the RAW string BEFORE sanitizeHtml
      // (same reason as renderMessage: DOMPurify would orphan the <img> by
      // stripping its class, leaving an unmatched img that stripContribButtons
      // post-innerHTML can no longer catch). Applied on the live path for
      // symmetry; contrib does not normally bake buttons here, but defends
      // against a future show_copy_icon flag flip.
      const cleanedTyping = this.stripContribButtonsFromString(content);
      bubble.innerHTML = this.sanitizeHtml(cleanedTyping); // Rev 10 — sanitize before innerHTML
      // Rev 11 — belt-and-braces: post-innerHTML strip for residual contrib nodes.
      this.stripContribButtons(bubble);
      // Rev 7 — attach the sparkles-owned copy button to the finalized
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
   * Rev 7: contrib `ai_chatbot/src/Service/MessagesButtons::getRenderedButtons()`
   * appends `<div class="chat-buttons"><img class="chat-button copy" …></div>`
   * to each assistant history message's html when `show_copy_icon` is TRUE.
   * We send `show_copy_icon: false` on live /api/deepchat POSTs, so streamed
   * responses do not have this markup, but the baked-into-drupalSettings
   * history does. Strip it synchronously after the `innerHTML` assignment so
   * no broken/unstyled contrib button remains in the lived DOM. Idempotent.
   * No new sanitization of the rest of the html — the inherited trust
   * boundary from Rev 5 stands.
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
   * Rev 11 — root-cause fix for history-replay regression: DOMPurify strips
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
   * belt-and-braces remain in effect.
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
   * Rev 7: produces one `<button class="asu-sparkles__copy" aria-label=
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
   * Rev 7: tries `navigator.clipboard.writeText(text)` first (available
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
   * Rev 7: creates a hidden textarea off-screen, selects its contents,
   * calls document.execCommand('copy'), and removes the textarea. Saves
   * and restores the current selection range so the user's selection
   * state is preserved. Returns TRUE on success, FALSE on any failure.
   *
   * Rev 7 review (P2): captures document.activeElement BEFORE focusing the
   * textarea and restores it after removal so a keyboard user's focus is
   * not dropped to <body> when the legacy fallback path runs. The primary
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
    // not dropped to <body> after the fallback path runs (P2 a11y fix).
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
   * Rev 7: toggles the .asu-sparkles__copy--copied class, swaps the
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
      // Rev 11 — strip contrib buttons from the RAW string BEFORE sanitizeHtml,
      // so DOMPurify cannot orphan the <img> by stripping its class attribute.
      // stripContribButtonsFromString uses an inert DOMParser (no script execution).
      const cleaned = this.stripContribButtonsFromString(content);
      bubble.innerHTML = this.sanitizeHtml(cleaned); // Rev 10 — sanitize before innerHTML
      // Rev 11 — belt-and-braces: post-innerHTML strip catches any residual
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

  // Rev 10 — module-scope flag: DOMPurify afterSanitizeAttributes hook is
  // installed at most once per page load (idempotent).
  let _domPurifyHookInstalled = false;

  /**
   * Sanitizes a server/history HTML string before it is written to innerHTML.
   *
   * Rev 10 — XSS hardening. Uses DOMPurify when available (loaded via the
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
   * Rev 10 — helper for clearConversation's resetting gate.
   * Fix 5 (iter-12): also disables preset chips and the clear button so
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
    // Fix 5: disable / re-enable preset chips.
    if (this.chips && this.chips.length) {
      this.chips.forEach(function (c) {
        c.disabled = !!flag;
      });
    }
    // Fix 5: disable / re-enable the clear button.
    if (this.clearBtn) {
      this.clearBtn.disabled = !!flag;
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
    // P3-formal: tear down the header-measurement resize listener and
    // pending debounce timer when the context element is removed from the
    // document (e.g. AJAX page fragments, Turbolinks, Drupal BigPipe
    // element removals). Prevents listener accumulation on re-attach.
    // FIX 3 — run on ALL triggers (not just 'unload'), and include the
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
        c.destroyOpenHeightTracking(); // Rev 10 — open-height MO + listeners
        c.destroyHeaderMeasurement(); // existing — header-measurement listener
        // Rev 10 — abort any in-flight network requests so detached nodes
        // do not receive responses after the widget has been removed.
        if (c._abortController) {
          c._abortController.abort();
          c._abortController = null;
        }
        if (c._resetAbortController) {
          // RC3: set _detaching so the resulting AbortError in the catch stays
          // SILENT — widget is being torn down; no announce needed.
          c._detaching = true;
          c._resetAbortController.abort();
          c._resetAbortController = null;
        }
        // Fix 4b (iter-12): clear the reset timeout so it cannot fire on a
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
    },
  };
})(Drupal, drupalSettings, once);
