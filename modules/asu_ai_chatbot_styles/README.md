# ASU AI Chatbot Styles

Adds bespoke presentation "placements" to the contrib AI Chatbot (DeepChat)
block (`ai_deepchat_block`, provided by `ai:ai_chatbot`).

This module ships one placement, **ASU sparkles** (`asu_sparkles`): an
upper-right chat widget that starts as a small sparkle "ring"
(“Welcome! / How can we help you today?” with an _Ask anything about ASU_
input) and expands into a rounded-corner panel when the visitor asks a
question. It offers up to five configurable pre-loaded questions and can
compact to a slim bar when the page is scrolled past a configured element.

It is **provider-agnostic** — it depends only on `ai:ai_chatbot`, so it works
with any `drupal/ai` chat provider (CreateAI, OpenAI, Gemini, …), not just
`asu_createai_provider`.

> **Not enabled by default.** This module is intentionally left out of the
> Webspark install profile's module list and ships no default block
> placement. Enable it and place/configure a block only where it is wanted.

## How it works

- **Placement, not a new block.** A `hook_form_BASE_FORM_ID_alter()` adds
  _ASU sparkles_ to the chatbot block's **Styling settings → Placement**
  select. The block plugin
  (`\Drupal\ai_chatbot\Plugin\Block\DeepChatFormBlock`) still provides the
  assistant selection, access checks and the `drupalSettings.ai_deepchat.*`
  values, so this behaves like any other placement option.
- **Bespoke front end.** Unlike the built-in placements (and
  `asu_ai_chatbot_floating`), `asu_sparkles` does **not** render the Deep Chat
  web component. `ai_chatbot` adds an `ai_deepchat__asu_sparkles` theme
  suggestion; this module registers that hook and renders its own template
  (`templates/ai-deepchat--asu-sparkles.html.twig`) driven by its own
  JavaScript (`js/asu-sparkles.js`). This keeps the markup and behaviour fully
  under our control and gives a clean seam for a future React/Lit Unity
  component to replace the front end without changing the backend contract.
- **Backend contract (reused as-is).** The JavaScript talks directly to the
  `ai_chatbot` endpoints:
  - `POST /api/deepchat/session` → CSRF token (only needed before the first
    message for an anonymous visitor).
  - `POST /api/deepchat` with
    `{assistant_id, thread_id, stream, contexts, messages:[{role:'user', text}]}`;
    non-streamed responses are `{html, should_continue}`, streamed responses
    are SSE `data: {html, overwrite}` lines. The `should_continue` flag drives
    the agent/tool continuation loop.
  - `POST /ajax/chatbot/reset-session/{assistant_id}/{thread_id}` to clear the
    conversation.

## Configuration

Place the **AI DeepChat Chatbot** block, open **Styling settings**, choose
**ASU sparkles**, then use **ASU sparkles settings**:

- **Pre-loaded questions** — up to five. Each has a _label_ (shown on the
  chip) and _sent text_ (submitted to the assistant on click). Rows with empty
  sent text are ignored; an empty label falls back to the sent text.
- **Scroll-compaction trigger** — a CSS selector. When the visitor scrolls
  past that element the idle widget compacts to a slim bar and restores when
  it returns. Leave empty to disable. (Only the idle collapsed state
  auto-compacts, so an open conversation is never disrupted.)
- **Data-layer section** — the `section` value for data-layer events
  (default `welcome`).
- **Send typed query text to the data layer** — off by default (typed text is
  redacted). See _Data layer_ below.

## Data layer

Interactions emit events to the global `dataLayer` following the ASU
Enterprise web data-layer standard (eight standard keys, lowercase, trimmed).
The container is created by GTM; this module only pushes (guarded so a missing
container cannot throw).

| Interaction           | event    | action  | name      | type             | text                  | component    |
| --------------------- | -------- | ------- | --------- | ---------------- | --------------------- | ------------ |
| Open panel            | `modal`  | `open`  | `onclick` | `click`          | `open the asu chat`   | `button`     |
| Close / minimize      | `modal`  | `close` | `onclick` | `click`          | `close the asu chat`  | `button`     |
| Preset question click | `search` | `click` | `onclick` | `keyword search` | _question label_      | `button`     |
| Typed query submit    | `search` | `type`  | `onenter` | `keyword search` | _query or `redacted`_ | `search bar` |

All events also carry `region: main content` and the configured `section`.
Automatic scroll-compaction is a state change, not a user interaction, so it
emits **no** event.

**PII:** the typed-query `text` is the only PII-sensitive field. It is
redacted (`redacted`) unless _Send typed query text to the data layer_ is
enabled. Confirm with the ASU data-governance / security team before enabling.
Preset-question labels are author-controlled and always sent.

## Accessibility & brand

- WCAG 2.1 AA: semantic region/log, labelled controls, visible focus (WHITE
  ring), `aria-expanded` (FAB-only disclosure semantics; `aria-controls` points
  to the log's unique id `Drupal.Html.getUniqueId('asu-sparkles-log')`),
  `aria-busy`, Escape to minimize, a polite live region,
  `prefers-reduced-motion` and `forced-colors` support, and reflow down to 320px.
- Brand values mirror ASU Unity tokens (maroon `#8c1d40`, gold `#ffc627`,
  Arial family) declared once as CSS custom properties. The panel uses the
  prototype's dark (glass-over-hero) surface. Because that surface can sit over
  arbitrary page backgrounds, a configurable **scrim** (a dimming layer behind
  the widget) is the interim mitigation for contrast/legibility issues on
  hero/background pages, pending design's final treatment decision. The scrim
  ships **off** by default and is enabled per block where a deployment needs it.

## Tests

PHP unit tests under `tests/src/Unit` cover the placement registration,
the preset-question persistence/cleaning, the preprocess mapping and the
config-schema alter (12 tests, 44 assertions):

```
ddev exec "vendor/bin/phpunit -c docroot/core --no-coverage \
  docroot/profiles/contrib/webspark/modules/asu_ai_chatbot_styles/tests/src/Unit"
```

JS unit tests under `tests/js/` cover sanitization, continuation cap, reset
gate, SSE reading, CSRF retry, and generation guard (29 cases):

```
node --test \
  docroot/profiles/contrib/webspark/modules/asu_ai_chatbot_styles/tests/js/*.test.js
# or:
yarn test:asu-sparkles-js
```
