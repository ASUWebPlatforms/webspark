# asu_ai_chatbot_styles — Module Changelog

> **Provenance note.** The development of this module involved an adversarial
> design/code/review pipeline that tracked work using internal labels such as
> `Rev N`, `Finding N`, `Item N`, `P1`/`P2`/`P3`, `iter-N`, `Review #N`,
> `Review-fix cycle N`, `matrix row N`, `Fix N`, `WWWCMS-256`, `Option A`,
> and `belt-and-braces`. Those labels were useful during development but are
> process artefacts, not part of the module's public record. They have been
> removed from inline comments throughout the codebase; the history they
> described is preserved below.

---

## Initial widget + baseline QA (Revs 1–6)

The module's first meaningful version introduced the "ASU sparkles" bespoke
chat widget: a fixed upper-right circle ("ring") that expands into a 384 px
rounded panel. The JS Controller implements a three-state machine
(`collapsed | open | compact`), a crossfade/morph motion system, preset-question
chips, scroll compaction, and the full backend integration
(`/api/deepchat` with CSRF token, SSE streaming, and the `should_continue`
agent loop). The CSS token block was established at this point, keeping all
ASU brand hex values in a single declaration block.

An early QA cycle addressed five baseline issues and laid the structural
invariants that all subsequent work preserves:

- **Chip scoping.** The chips container was moved inside `.asu-sparkles__log`
  as its first child (the "N3 invariant"), so chip lookup is scoped to the log
  and chips anchor at the top while real messages append below.
- **Chip click behaviour.** Chip clicks populate the input and fire the
  data-layer event, but do not auto-submit — users can review and edit before
  sending (reverses an earlier auto-submit approach).
- **Header-clear top offset.** `--asu-sparkles-top` was introduced so the
  widget clears the page header across all states and viewports, replacing a
  hardcoded pixel offset.
- **Input focus-ring.** The white two-tone focus ring (`:focus-visible`) was
  established as the widget-scoped override of the Webspark theme's broad rule.
- **Sparkle asset.** The orbit sparkle (collapsed ring), the header sparkle
  (open state), and the FAB sparkle (compact state) were updated to the final
  supplied SVG asset (viewBox 0 0 38 38, two small + one large solid shape),
  rendered as gold-filled with no stroke.

The header sparkle visibility was also refined: shown in `open` only
(beside the title in the two-column intro layout), hidden in `collapsed`
(where the orbit sparkle in the ring gap serves the same visual role),
already hidden in `compact` (shell is `display:none`).

---

## Motion orchestration (Rev 3 / setState)

`Controller.prototype.setState` was rewritten as a motion dispatcher with
three paths: **INSTANT** (restore or `prefers-reduced-motion`), **MORPH**
(desktop `collapsed ↔ open` geometry transition using `--asu-sparkles-open-h`
and `.asu-sparkles--reflow`), and **CROSSFADE** (all other transitions, using
`.asu-sparkles--fading`). The in-flight-crossfade cancellation race guard
(`_fadeTimer` clear as the first step) prevents stale timer commits from
overwriting a later state request.

---

## DOMPurify XSS hardening (Rev 10)

The XSS sanitization layer was introduced:

- `sanitizeHtml()` added as the single call site before every untrusted
  `innerHTML` assignment. Uses DOMPurify when available; falls back to the
  module-scope `fallbackSanitize()` inert-document scrubber (DOMParser,
  no script execution).
- Both paths enforce a 21-tag allowlist mirroring `DeepChatApi::$allowedTags`,
  with `ALLOWED_ATTR` restricted to `href`, `src`, `alt`, `title` — `class`
  deliberately excluded to prevent replay of contrib `.chat-buttons` markup.
- The `afterSanitizeAttributes` DOMPurify hook forces `rel="noopener noreferrer"`
  on any `<a target="_blank">` node, installed once per page load (idempotent).
- URL attr values are normalised (strip ASCII whitespace and control chars,
  lowercase) before the denylist check in `fallbackSanitize`, closing
  obfuscated-scheme bypass vectors.

---

## CSRF/reset gates, continuation cap, and history replay (Revs 5–7, 10–11)

- **CSRF token.** Every `/api/deepchat` POST requires a session-scoped CSRF
  token obtained via `POST /api/deepchat/session`. The token is cached for the
  page lifetime and a one-shot 403 retry refetches it.
- **Reset gate.** `clearConversation()` rebuilds the log synchronously
  (deterministic), increments `_resetGeneration`, and fires a background
  `reset-session` call. The `_finishReset()` helper provides once-per-generation
  terminal settlement (stale guard + idempotency guard) so only the current
  generation can release the UI gate. A 20 s timeout aborts a hung reset-session
  request and releases the gate gracefully.
- **Continuation cap.** The `should_continue` agent loop is capped at
  `CONTINUATION_LIMIT = 10` follow-up POSTs per user turn. If the cap trips,
  an error bubble surfaces rather than spinning indefinitely.
- **History replay.** `seedFirstMessage()` replays `drupalSettings.ai_deepchat
.messages` into the log on init. Contrib `.chat-buttons` markup is stripped
  from the raw history string before `sanitizeHtml` using an inert DOMParser
  (`stripContribButtonsFromString`), solving the DOMPurify class-stripping
  orphan bug that made the post-innerHTML strip miss the node.
- **Copy button.** The sparkles-owned copy button (`.asu-sparkles__copy`) is
  rendered via `createElement` after `sanitizeHtml`, so it is never passed
  through the sanitizer. Idempotent; added to every finalized assistant bubble.

---

## Five-finding QA batch (Findings 1–4)

The main feature development round addressed four Figma-driven findings on
the placed widget:

### Finding 1 — Send-button spacing

`.asu-sparkles__field` right padding changed from 4 px to 8 px, adding
~6 px of breathing room between the send button and the pill stroke.
CSS-only change; no JS or Twig involved.

### Finding 2 — Empty-state snugness

`Controller.prototype.fitOpen` was computing panel height by adding the
chips height twice (once directly and once via `log.scrollHeight`, since the
chips container lives inside the log). The double-count produced a spurious
empty gap below the input. The fix: `h = head.offsetHeight + log.scrollHeight

- form.offsetHeight`—`log.scrollHeight`is the single source of truth for
all log content including chips. A pure-calculation helper`fitOpenMeasure()`
  was extracted for unit testing.

### Finding 3 — 48 px placement + measurement race

Two related issues were resolved together:

**Gap literals changed.** Desktop top gap and right gap updated from 16/24 px
to 48/48 px (Figma specification). Phone geometry is unchanged.

**Admin-toolbar-aware measurement.** `measureHeaderTop()` was rewritten as the
"targeted-anchor" approach: an ordered selector list (`#asuHeader`, `.uds-header`,
`header[role="banner"]`, `#header`) picks the first fixed/positioned header with
a valid bounding rect. Drupal admin toolbar presence is detected from
`document.body` classes (`toolbar-fixed`, `toolbar-horizontal`,
`toolbar-vertical`) rather than a page-wide element scan. The horizontal open
tray is included in the measurement; the vertical tray (a sidebar) is not.
The earlier pass-B page-wide heuristic was removed — it was the root cause of
a 183 px scroll-triggered jump.

**Scroll-shrink latch.** A `ResizeObserver` on the resolved anchor element
uses a shrink-only latch (`_restingHeaderBottom`): baseline events (init,
resize, body-class mutation, `window.load`) update the baseline in both
directions; the ResizeObserver callback only lowers it (captures the header's
24 px scroll-contraction), never raises it (grow-back is ignored, keeping the
widget pinned to the contracted position). A `MIN_HEADER_BOTTOM_PX = 32` floor
prevents transient animation heights from permanently lowering the latch.

**Visibility gate.** The `.asu-sparkles--measuring` class is added by the
Controller constructor before the first layout, applying `visibility: hidden`
via CSS. On the first successful `applyMeasurement` call the class is removed
in a trailing `requestAnimationFrame` (synchronously under `prefers-reduced-motion`).
A `window.load + 200 ms` safety net ensures the gate is always released even
on measurement failure, so users are never left with an invisible widget.

### Finding 4 — Ellipsis (⋯) menu

The `↻` clear icon in the header was replaced by a `⋯` options menu button
(`aria-haspopup="menu"`). The menu popover (`role="menu"`) always contains a
"Clear conversation" `menuitem`, followed by up to four optional label+URL
links from block config (mirroring the `asu_sparkles_questions` pattern).

Key details:

- WCAG ARIA menu pattern: roving focus (`tabindex="-1"` on non-focused items,
  `tabindex="0"` on the focused item), `ArrowDown`/`ArrowUp`/`Home`/`End`
  roving, `Escape` closes and returns focus to the trigger, `Tab` closes
  without focus restore (lets natural tab order proceed), outside-click via
  a capture-phase document listener.
- The widget-level `Escape` handler defers to the menu's own handler when the
  menu is open, so a single Escape keypress closes the menu without also
  collapsing the widget panel.
- URLs are validated via `_asu_ai_chatbot_styles_build_link_url()`: dangerous
  schemes (`javascript:`, `vbscript:`, `data:`) are rejected after
  normalisation; internal paths go through `Url::fromUserInput()`, external
  through `Url::fromUri()`. Protocol-relative `//` and backslash variants
  are rejected.
- No `target="_blank"` on any link (by explicit design decision). External
  links carry `rel="external noopener"` as a security defence-in-depth measure.
- Config schema is extended non-destructively via `hook_config_schema_info_alter`
  (no `config/install` files, no `hook_update_N` required).

---

## Change-request batch (Items 0–5)

A second round addressed further change requests:

- **Item 0 — Shrink-only latch.** The latch semantics were inverted from
  growth-only to shrink-only (see Finding 3 above for the final behaviour).
  A subsequent fix added the `MIN_HEADER_BOTTOM_PX` floor to reject transient
  tiny measurements during animations. `applyBaseline(null)` was updated to
  clear stale inline tokens (previously they were left in place, pinning the
  widget at a stale position when the anchor disappeared from the DOM).
- **Item 1 — Hide copy icon.** `asu_sparkles_hide_copy` boolean setting added.
  When `true`, `addCopyButton()` returns early and no copy button is created.
- **Item 2 — New sparkle SVG.** The three decorative sparkle SVGs (orbit ring,
  header, FAB) were replaced with the final supplied path (viewBox 0 0 38 38).
  The CSS fill rule was updated to `fill: var(--asu-sparkles-gold); stroke: none`
  (asset is filled, not stroked).
- **Item 3 — Mobile open panel flush to header.** In `@media (max-width: 768px)`,
  the open panel was changed to sit flush to the header bottom (top offset =
  `--asu-sparkles-hdr-h`, no gap), with square top corners and 4 px bottom
  corners. The spectrum ring's top 2 px strip is collapsed by setting
  `padding: 0 2px 2px` on `::before` (the mask-composite ring has no CSS
  border to remove — the padding controls the strip width).
- **Item 4 — Typing dots horizontal.** `.asu-sparkles__bubble--typing` changed
  to `display: inline-flex; flex-direction: row` with `gap: 4px`. Dot pulse
  stagger and the `@keyframes asu-sparkles-typing` animation are unchanged.
- **Item 5 — Static first-message header line.** The `first_message` text moved
  from a `.asu-sparkles__intro-msg` appended into the log by `seedFirstMessage()`
  to a static slot in the header (`.asu-sparkles__subtitle` / `.asu-sparkles__firstmsg`).
  `clearConversation()` no longer calls `seedFirstMessage()` — the header slot
  is untouched by clear. An `.asu-sparkles__intro-text` wrapper div was added
  around the `<h2>` title and `<p>` subtitle in Twig to support the two-column
  open-state flex layout (sparkle left, text column right). `min-width: 0` was
  added to the flex child to allow shrinking below max-content width, and
  `word-break: break-word` / `overflow-wrap: break-word` replaced the former
  `white-space: nowrap` to fix WCAG reflow overflow at 320 px.

---

## MR 1289 review fixes (#1–#11)

After the main development rounds, an adversarial code review (MR 1289) raised
eleven findings that were addressed before merge:

1. **Trigger Escape while menu open.** When focus is on the `⋯` trigger while
   the menu is open (e.g. after `Shift+Tab` back to it), `Escape` now closes
   the popover. The `keydown` handler on the trigger was updated to handle
   `Escape` when `_menuOpen` is true.
2. **Space key on anchor menuitems.** Native anchor elements do not activate on
   Space (only Enter). The `_onMenuKeyNav` Space case was added to synthesise a
   `click()` on `<a>` menuitems, matching the ARIA menu pattern.
3. **`focusout` close on Tab / Shift+Tab.** A `focusout` listener on the
   popover closes the menu when focus moves outside it (unless it moves between
   menuitems). Paired with the `Tab` case in `_onMenuKeyNav` (which closes
   without focus-restore and lets the browser advance focus naturally).
4. **Outside-click trigger-button containment.** The outside-click document
   listener was updated to use `menuBtn.contains(e.target)` so clicking the
   nested `<span aria-hidden>` inside the trigger button (a valid pointer
   target) correctly counts as "inside the trigger" and does not close the menu.
5. **`drupalSettings` menu_links attachment removed.** The preprocess no longer
   attaches `drupalSettings.asu_sparkles.menu_links` — the JS reads the menu
   purely from the server-rendered DOM. This removes an unnecessary serialisation
   and avoids the question of whether the data needs to be treated as trusted.
6. **`menu_popover_id` uses `Html::getId()` not `Html::getUniqueId()`.** The
   per-request counter on `getUniqueId()` can produce different values on a
   cached vs. fresh render, causing `aria-controls` on the trigger to reference
   a different id than the popover's actual `id`. `Html::getId()` is deterministic
   and stable.
7. **Protocol-relative and backslash URL rejection.** `_asu_ai_chatbot_styles_build_link_url()`
   was tightened to also reject `//`, `/\`, and `\\` prefix forms (browsers
   normalise `\` to `/`, so `/\evil.com` resolves as `//evil.com`). Both the
   raw and normalised (whitespace-stripped) forms are checked.
8. **Phone breakpoint constant.** The `PHONE_MAX_WIDTH_PX` constant was added so
   JS always uses the same breakpoint value as the CSS `@media (max-width: 768px)`
   rule, rather than a hardcoded literal that could drift. `HEADER_GAP_DESKTOP_PX`
   and `HEADER_GAP_PHONE_PX` were added for the same reason.
9. **`_setResettingUi` disables menu button.** During a reset window the `⋯`
   menu button is now disabled alongside the input, send button, chips, and clear
   button, preventing the user from opening the menu while the reset is in flight.
10. **`detach` runs on all triggers.** The `Drupal.behaviors.asuSparkles.detach`
    handler was updated to run on all trigger values (not just `'unload'`) and to
    include the context root itself when it is a `.asu-sparkles` element, since
    `querySelectorAll` excludes the context element from its search.
11. **Abort isolation in `clearConversation`.** Prior-generation timers are
    cancelled before creating the new `AbortController` and timer, so a Clear B
    always cancels Clear A's timer. The captured `AbortController` in the timeout
    closure aborts its own controller (not `self._resetAbortController`, which may
    have been replaced by a newer Clear).
