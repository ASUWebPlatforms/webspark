# AGENTS.md — asu_ai_chatbot_styles

Scoped to this module. Supplements the repo-root and
`asu_createai_provider/AGENTS.md` conventions. Written for an AI coding agent
picking this up later with no prior context.

## What this is

A Webspark-profile module that adds an **"ASU sparkles"** placement
(`asu_sparkles`) to the contrib AI Chatbot block (`ai_deepchat_block`, from
`ai:ai_chatbot`). It renders a bespoke upper-right chat widget (sparkle "ring"
→ rounded panel), not the Deep Chat web component. It is a **sibling** of
`asu_createai_provider` and depends only on `ai:ai_chatbot`, so it is
provider-agnostic.

Modelled on the `asu_ai_chatbot_floating` module from the `asucms`
`createai-poc` branch (`docroot/modules/custom/asu_ai_chatbot_floating`), which
adds a "Floating" placement the same way but _does_ reuse the Deep Chat
component. The key divergence here: `asu_sparkles` ships its own markup + JS
and speaks the chatbot HTTP API directly.

## Architecture (how the pieces connect)

- `hook_form_BASE_FORM_ID_alter('block_form')` adds `asu_sparkles` to the
  **Styling → Placement** `#options` and adds the **ASU sparkles settings**
  sub-form (preset questions, scroll trigger, data-layer section, PII toggle).
  It also splices `asu_ai_chatbot_styles_block_form_submit` into the save
  button's `#submit` **before `::save`** — the contrib `blockSubmit()` only
  captures its own keys, and `BlockForm::submitForm()` rebuilds the entity's
  `settings` from the plugin configuration, so our extra keys must be written
  onto the entity after that and before the save. Do **not** move this to
  `hook_block_presave()` (no form values there).
- `hook_ENTITY_TYPE_presave()` (`..._block_presave`) normalises
  `style_file`/`width`/`height` for the placement (schema-valid defaults; the
  widget sizes itself via CSS).
- `hook_config_schema_info_alter()` adds the `asu_sparkles_*` keys to
  `block.settings.ai_deepchat_block` **non-destructively** (`+=` on the
  existing mapping). Never redefine the whole mapping — it would drop the
  chatbot module's own keys.
- `ai_chatbot`'s `ChatbotHooks::themeSuggestionsAiDeepchatAlter()` adds the
  `ai_deepchat__<placement>` suggestion (it converts `-`→`_`). `hook_theme()`
  here registers `ai_deepchat__asu_sparkles` so the template is found (modules
  are only scanned for templates if they implement `hook_theme()`).
- `hook_preprocess_ai_deepchat()` maps the stored `asu_sparkles_*` settings
  onto clean template variables (`preset_questions`, `datalayer_section`,
  `scroll_trigger`, `send_typed_text`). The block's `build()` already attaches
  `drupalSettings.ai_deepchat.{assistant_id,thread_id,session_exists,…}`
  regardless of placement, which the JS reuses.
- `hook_page_attachments()` attaches the early header script
  (`asu-sparkles-early`) when an accessible `asu_sparkles` block exists, so a
  restored non-collapsed state does not replay its transition on load (incl.
  late BigPipe chunks).

## Front end

- `js/asu-sparkles.js` — `Drupal.behaviors.asuAiChatbotSparkles` creates one
  `Controller` per `.asu-sparkles`. State machine on `data-state`
  (`collapsed | open | compact | closed`), persisted to `localStorage`
  (`Drupal.asuSparkles.state`). `setState(state, {restore|silent})` skips
  persistence + the data-layer hook for restore/scroll transitions.
  `Drupal.AsuSparkles.Controller` is exposed.
- **Accessibility:** the FAB (`<button class="asu-sparkles__fab">`) carries
  `aria-expanded` (disclosure semantics) and `aria-controls` pointing to the
  log's unique id (`Drupal.Html.getUniqueId('asu-sparkles-log')`). No other
  element sets `aria-expanded`. A visible focus ring (WHITE ring) is provided
  on all interactive elements.
- Backend: `sendToBackend()` → `ensureCsrfToken()` (ALWAYS — see Rev 5 N8) →
  `postMessage()` (JSON or SSE via `readSseStream()`) → `handleResponse()`
  (with the `should_continue` agent loop using a `dummy_loading` user message,
  capped at `CONTINUATION_LIMIT = 10` follow-ups per turn). `clearConversation()`
  hits the reset-session route and uses `AbortController` to cancel any
  in-flight submit chain.
- Data layer: `pushDataLayer()` guards `window.dataLayer` and emits the
  standard 8 keys; `onStateChange()` emits `modal` open/close, `onSubmit()`
  emits `search` click/type. Typed `text` is redacted unless the block opts
  in. **No event** on scroll compaction.
- **XSS hardening (Rev 10):** `sanitizeHtml()` is called before every untrusted
  `innerHTML` assignment (history replay via `renderMessage` + live response
  via `replaceTyping`). Uses DOMPurify (loaded via the
  `asu_ai_chatbot_styles/dompurify` Drupal library, mirroring the blazy
  declaration). Allowlist mirrors contrib `DeepChatApi::$allowedTags` (21 tags).
  A fallback inert-document scrubber runs when DOMPurify fails to load.

## Gotchas

- The widget's collapsed "ring" is visible by default (not `opacity:0` like
  the floating panel), so there is **no** separate `hook_page_bottom()` toggle
  button — the collapsed ring and the closed-state `.asu-sparkles__fab` both
  live inside the block template.
- `t()` in the `.module` requires a container; the unit tests set a
  `string_translation` stub before calling the hooks.
- Scroll compaction only acts on the idle `collapsed` state (→ `compact` and
  back), never on `open`/`closed`, so a live conversation is not disrupted.

## Verification

- PHP unit tests: `ddev exec "vendor/bin/phpunit -c docroot/core --no-coverage
docroot/profiles/contrib/webspark/modules/asu_ai_chatbot_styles/tests/src/Unit"`
  (12 tests, 44 assertions). They require Drupal's phpunit bootstrap
  (`-c docroot/core`), not a bare phpunit run.
- JS unit tests (29 cases, separate from phpunit):
  `node --test docroot/profiles/contrib/webspark/modules/asu_ai_chatbot_styles/tests/js/*.test.js`
  (or `yarn test:asu-sparkles-js`). Requires `jsdom` in devDependencies.
- phpcs: `ddev exec "vendor/bin/phpcs --standard=Drupal,DrupalPractice
--extensions=php,module,inc,install,yml,twig,css <module path>"` — clean
  except the expected "global constants" warnings (same pattern as the
  floating reference) and test `#options` `t()` warnings. Do **not** pass
  `--extensions=...,js`: Drupal lints JS with eslint, not phpcs, and forcing
  PHP sniffs onto JS yields false positives.
- eslint: `ddev yarn run eslint
docroot/profiles/contrib/webspark/modules/asu_ai_chatbot_styles/js/asu-sparkles.js
docroot/profiles/contrib/webspark/modules/asu_ai_chatbot_styles/tests/js`

## Durable references (migrated from REQUIREMENTS.md)

- **Reference prototype** — `~/web/01DeveloperHandoff/01 Prototype/index.html`,
  the `#chat` widget: `data-state=collapsed|open|min|closed`, `.chips`
  preset buttons calling `ask()`, sparkle SVG, "Welcome!" / "How can we
  help you today?" / "Ask anything about ASU".
- **Reference module** — `~/web/asucms` (branch `createai-poc`) →
  `docroot/modules/custom/asu_ai_chatbot_floating`. The "Floating"
  placement built the same way but reusing `<deep-chat>`.
- **Data-layer standard** — the `datalayer-docs` knowledge base
  (indexed from `~/web/datalayer-docs.pdf`).

## Trust boundary & upstream asks (Rev 10)

**Why history HTML is sanitized client-side.** Contrib
`DeepChatFormBlock::historicalMessages()` (`docroot/modules/contrib/ai/
modules/ai_chatbot/src/Plugin/Block/DeepChatFormBlock.php` ~line 952)
builds `drupalSettings.ai_deepchat.messages[*].html` by running
`CommonMarkConverter::convert($text)` without wrapping the output in
`Xss::filter`. Live responses ARE server-filtered
(`DeepChatApi::sanitizeHtml` at lines 275 and 417, `ChatForm` line 176),
but the baked history is not. We mirror the contrib server allowlist
(`DeepChatApi::$allowedTags` = `a, b, blockquote, br, code, del, em,
h1–h6, hr, i, img, li, ol, p, pre, strong, ul`) with DOMPurify, locally
loaded (no CDN). This is defense-in-depth on live responses and essential
for history. **Upstream ask:** wrap `historicalMessages()`'s CommonMark
output in `Xss::filter($html, $this->allowedTags)` so history and live
share one sanitization boundary.

**Why we abort writes to retired threads client-side.** Contrib
`AiAssistantApiRunner::createMessage()` / `::createRun()` (`docroot/
modules/contrib/ai/modules/ai_assistant_api/src/AiAssistantApiRunner.php`
~lines 618 / 681) do not check whether the thread was retired by a
`/reset-session` call. A race between a Clear and an in-flight submit
can therefore write an assistant message onto a thread the user has
already discarded. Rev 10 aborts the in-flight fetch client-side via
`AbortController`. **Upstream ask:** reject writes to retired threads
with HTTP 410 (Gone), and update `/reset-session` to emit the retirement
event the runner can key off.

## Future work

`Controller.prototype.measureHeaderTop()` performs an O(DOM)
`document.querySelectorAll('*')` + `getComputedStyle` scan twice per
call (Pass A semantic + Pass B heuristic). Replace with a one-pass
cached scan + a `ResizeObserver` on known header candidates. **Deferred;
not blocking Rev 10.**
