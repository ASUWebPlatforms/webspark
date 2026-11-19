# AGENTS.md — CreateAI provider + AI Tools (asu_createai_provider)

Scoped to this module and its submodules (`modules/asu_editor_guardrails/`,
`modules/asu_agents_guardrails/`). Supplements the repo-root
[`AGENTS.md`](../../../../../../AGENTS.md) — read that first for general
Webspark conventions (developer roles, dependency folders, build/lint
commands); this file only covers what's specific to this subsystem.

Status as of 2026-09-14, branch `update-ai-tools` (pushed to origin, not yet
merged to `develop`). Written for an AI coding agent picking up this work
later — assumes no prior context beyond this file and the code itself.

## What this is

Webspark-core integration of **CreateAI** (ASU AIML's internal, OpenAI-compatible
gateway) as a `drupal/ai` chat provider, plus supporting security guardrails and
a CKEditor5 crash fix that was a hard blocker for the AI Writer feature.

Three modules, all under this directory:

```
asu_createai_provider/                 (this module — the provider itself)
├── src/Plugin/AiProvider/CreateAiProvider.php   — the drupal/ai ChatInterface plugin
├── src/Form/CreateAiConfigForm.php              — settings form (multi-agent)
├── src/CreateAiChatMessageIterator.php          — streaming response iterator
├── asu_createai_provider.install                — hook_update_10001 (config migration)
├── config/schema/, config/install/              — agents + default_agent schema
└── modules/                                     — true Drupal submodules:
    ├── asu_editor_guardrails/    — guards ai_ckeditor + ai_automators
    └── asu_agents_guardrails/    — guards ai_agents' write-capable tools
```

## 1. CreateAiProvider — multi-agent chat provider

**Core fact**: CreateAI resolves the actual model/bot **server-side**, purely
from which Service Token is used — the provider always sends `model:
"defaults"` in the request body. So "picking a different CreateAI chatbot" =
"using a different Service Token + endpoint", not a `model` parameter.

**Config shape** (`asu_createai_provider.settings`):

```yaml
default_agent: <machine_name> # which agent below is the sitewide default
agents:
  - id: <machine_name>
    label: <human label>
    endpoint_url: <one of the 3 ALLOWED_HOSTS, https, /v1 path>
    api_key: <Key module key ID — NEVER a raw secret in config>
    capabilities: { chat: bool, chat_with_rag: bool }
    enable_search: bool # sends enable_search header (RAG)
    enable_history: bool # sends enable_history header + session_id
```

A site can configure **multiple agents** (e.g. a general chatbot + a
brand-standards-trained one for CKEditor) via
`/admin/config/ai/providers/createai`. Each becomes a separate selectable
`provider`/`model` option anywhere `drupal/ai` exposes one (e.g. `ai_ckeditor`'s
per-feature "AI provider" dropdown).

**model_id scheme** — this is the part most likely to confuse a future agent:

- Whichever agent's `id` matches `default_agent` is exposed under the LEGACY
  constant `CreateAiProvider::DEFAULT_MODEL_ID = 'createai_project_default'`
  — for backward compatibility with already-existing config (e.g.
  `ai.settings.default_providers.chat`, or an already-picked `ai_ckeditor`
  'provider' value).
- Every OTHER agent is exposed as `'agent_' . $id` (via
  `CreateAiProvider::AGENT_MODEL_PREFIX`).
- `getAgentDefinitions()` is the single source of truth for this mapping —
  read it before touching `getConfiguredModels()`/`isUsable()`/`resolveAgent()`.

**Why `ai_ckeditor` "just works" once you add + default an agent**: its
`AiRequest::doRequest()` controller (contrib, not ours) falls back to
`ai.settings.default_providers.chat` whenever a CKEditor AI feature's own
`provider` setting is empty (the out-of-the-box state). So marking an agent as
`default_agent` here + having `ai.settings.default_providers.chat` set to
`{provider_id: createai, model_id: createai_project_default}` makes EVERY
un-overridden CKEditor AI feature use that agent, with zero CKEditor-specific
code or config needed.

**Security invariants — do not relax these**:

- `normalizeEndpoint()` is the ONLY SSRF defense: exact-host allowlist (3
  documented CreateAI hosts), https-only, no userinfo/nonstandard-port,
  path must be `''` or `/v1`, no query/fragment. Applied to EVERY agent's
  endpoint, at both form-validate time and request time.
- `chat()` resolves the agent's token fresh on every call (inside a
  `try`/`finally` that always resets `$this->apiKey = ''`) — a provider
  plugin instance can be reused across multiple `chat()` calls for
  DIFFERENT agents within one request, so nothing may leak between calls.
  Also respects a `ProviderProxy`-driven runtime auth override
  (`setAuthentication()` called just before `chat()`) by only
  auto-resolving from config if `$this->apiKey === ''`.
- `buildSessionCorrelationId(string $agent_id)` HMACs `agent_id . ':' .
session_id` — never the raw session ID (bearer-credential material), and
  agent-scoped so two agents in one session can't have their history
  correlated together by CreateAI.
- The settings form's "Test connection" button intentionally scopes
  `#limit_validation_errors` to just that agent's own fields (needed for
  the values to actually populate) — this reopens a path where the
  submitted Key ID could bypass the `key_select` element's normal
  authentication-type filtering, so `probeConnection()` explicitly
  re-checks the key is in `getKeyNamesAsOptions(['type' => 'authentication'])`
  before using it.
- Known, deliberately-deferred gap: the settings form route only requires
  `administer ai providers`, not `administer keys` — someone with the
  former but not the latter can pick any authentication-type Key. Not
  fixed per explicit user decision (documented, not a blind spot).
- `agentIdExists()`'s machine-name collision check compares against the
  element's own `#default_value`, not form-delta-vs-stored-config-index —
  keying by position used to drift out of sync if agents were ever
  reordered/removed (caught in code review; fixed).

**Known gap, not fixed**: the streaming path
(`CreateAiChatMessageIterator`) does not read/accumulate `delta.tool_calls`
— a streamed response that requests a tool call silently drops it. Tool
calling only works on the non-streamed path. Use non-streamed chat for any
`ai_agents`-driven request until the iterator is updated. `doIterate()` now
logs a single warning per response (`asu_createai_provider` channel,
guarded by a flag so a tool call spanning dozens of chunks doesn't flood
the log) if it ever sees `delta.tool_calls` on the streamed path, so this
fails loud instead of silent if something ever drives a streamed
tool-call request.

## 2. asu_editor_guardrails

Guards `ai_ckeditor` (the AI Assistant CKEditor button) and `ai_automators`
(AI-driven field auto-population), neither of which have built-in rate
limiting, forced-safe-format enforcement, or access gating (verified against
upstream `drupal/ai` source — this is a real, undocumented gap in the
official module, not a Webspark bug).

- `CkeditorFloodAccessCheck` — per-user flood control on the
  `ai_ckeditor.do_request` route via the `_asu_editor_guardrails_flood`
  route requirement.
- `AutomatorGuardrailSubscriber` — on `ai_automators`'
  `ShouldProcessFieldEvent`: vetoes processing for unpublished/inaccessible
  entities (fails closed if the access check itself throws); throttles
  automator re-triggers per entity+bundle+field (unconditional, not
  edit_mode-gated — some rule base classes regenerate on every save
  regardless of `edit_mode`); backstops with a per-user cap.
- `asu_editor_guardrails.module`'s `hook_entity_presave()` — forces any
  field with an `ai_automator` attached into `restricted_html` format (or
  `plain_text` if that doesn't exist) and runs `Xss::filter()` as
  defense-in-depth, regardless of what format was originally configured on
  that field. This is the actual teeth of the module: `ai_automators`
  writes raw LLM output straight into whatever format is configured, with
  no XSS filtering of its own.

**Rate limits/cooldowns are configurable** via
`/admin/config/ai/safety-compliance/editor-guardrails` (requires `administer
ai`, matching the parent `ai.admin_config_safety` menu section;
`asu_editor_guardrails.settings` config, `SettingsForm`):
`ckeditor_limit`/`ckeditor_window` (default 30/300s) for the CKEditor
endpoint, `automator_cooldown` (default 300s), `automator_user_limit`/
`automator_user_window` (default 20/300s) for automators. Both
`CkeditorFloodAccessCheck` and `AutomatorGuardrailSubscriber` read these live
from config on every request (no caching), via an injected
`ConfigFactoryInterface`, and fall back to class constant defaults if a key
is missing (e.g. config not yet imported on a given site) rather than
coercing a missing value to `0` and locking the feature out entirely.
`AutomatorGuardrailSubscriber`'s per-entity flood key is hashed
(`hash('crc32b', ...)`) rather than concatenating entity type/bundle/field
names directly — Flood's `event` column is a 64-char varchar, and
long bundle/field machine names can otherwise exceed it under MySQL strict
mode.

## 3. asu_agents_guardrails

Guards `ai_agents`' write-capable tools (Taxonomy, Content Type, Field
agents — see `AgentWriteGuardrailSubscriber::WRITE_TOOLS` for the explicit
allowlist of plugin IDs covered; treat as allowlist-only, not catch-all).

- Rate limits via flood (default 20/300s per user, configurable — see
  below), fails closed by throwing `\RuntimeException` in `onPreExecute()`
  BEFORE the tool runs.
- Logs every successful execution (`onFinished()`) AND every
  flood-rejection (`onPreExecute()`) — the rejection log matters because
  `AgentToolFinishedExecutionEvent` only fires on success, so a blocked
  attempt would otherwise leave zero audit trail.

**Rate limit is configurable** via
`/admin/config/ai/safety-compliance/agents-guardrails` (requires `administer
ai`; `asu_agents_guardrails.settings` config, `SettingsForm`): `write_limit`/
`write_window` (default 20/300s). `AgentWriteGuardrailSubscriber` reads these
live from config via an injected `ConfigFactoryInterface`, falling back to
class constant defaults if a key is missing.

Neither guardrail module depends on `asu_createai_provider` itself — they
guard `ai_ckeditor`/`ai_automators`/`ai_agents` generically and should work
with any `drupal/ai` provider, not just CreateAI. They're nested here purely
for packaging/distribution convenience (mirrors how `drupal/ai` itself nests
`ai_ckeditor`/`ai_automators`/`ai_agents` under its own `modules/`).

## 4. The CKEditor5 crash (separate but related work, already committed)

AI Writer ("Generate with AI") crashed on `enableReadOnlyMode()` due to TWO
independent bugs, both already fixed on this branch:

1. **Webspark core** (commit `8079b8c3db`, later dropped via rebase — see
   below): `WebsparkListStyleEditing` replaced `bulletedList`/`numberedList`
   commands with plain objects instead of listening on `execute`.
2. **Contrib** (`ai_ckeditor`'s precompiled JS bundle pinned to CKEditor5
   `~41.3.1` while the site runs `47.6.0`) — fixed via a composer patch
   (`patches/ai_ckeditor/ckeditor5_version_bundle_rebuild.patch`,
   registered in `webspark-dependencies-source/patches.webspark.json`).

**Important**: fix #1 above was DROPPED from this branch via
`git rebase --onto` because a colleague's MR !1058 (`list-command-api-fixes`
branch) independently fixes the exact same `WebsparkListStyleEditing` bug —
plus a second, related bug in `InsertWebsparkListStyleCommand::refresh()`
that wrote to the model through private properties (`_attrs`,
`_children._nodes`) mid-dispatch. Two rounds of dual-model subagent review
(GPT-5.6 Terra + Gemini 3.8 Flash) plus live browser reproduction confirmed
a real bug in !1058's first version (a `differ`-based post-fixer that
missed newly-converted list blocks); the author pushed a fix (`collect()`
checking both `change.position.parent`/`change.range.start.parent` AND
`.nodeAfter`) that was re-reviewed and confirmed correct.

**!1058 has since MERGED into `develop`** (2026-09-14). `update-ai-tools` is
now ~11 commits behind `origin/develop` and has NOT been rebased onto it yet
as of this writing — that's the next actionable step (`git fetch origin &&
git rebase origin/develop`), not something to wait on anymore. **Do not
re-add a Webspark-core fix for the `WebsparkListStyleEditing`/
`InsertWebsparkListStyleCommand` bugs** — they're already fixed on
`develop` via !1058.

## Testing

- Live-verified end-to-end: added a 2nd agent via the settings form UI,
  confirmed both agents show up correctly in `getConfiguredModels()`/the
  `ai_ckeditor` provider dropdown, confirmed `chat()` against the real
  CreateAI backend returns real text.
- Browser-automation gotcha seen on this environment: Playwright's
  `click()`/`click_element` can hang indefinitely on "waiting for element
  to be visible, enabled and stable" on this site (possibly related to a
  repeating JS error from the theme's `unity-bootstrap.umd.js`), even
  after `scrollIntoView` and across fresh page reloads. Workaround that
  reliably works: submit the form directly via the DOM API instead of
  relying on Playwright's actionability checks —
  ```js
  await page.evaluate(() => {
    const btn = document.getElementById('some-button-id');
    btn.closest('form').requestSubmit(btn);
  });
  ```
  This works because Drupal's AJAX buttons are progressive enhancement
  over a real working plain submit, so bypassing the JS/AJAX layer and
  submitting directly still triggers the actual PHP submit handler.
- `ddev phpcs`/`ddev phpstan` clean on all 3 modules as of the last commit.
- No `ai_automator` config currently exists on `websparkci` (cleaned up
  after earlier testing) — recreate one to live-test the XSS-neutralization
  path in `asu_editor_guardrails` if needed.
