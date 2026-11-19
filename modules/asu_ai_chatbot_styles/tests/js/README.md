# JS Unit Tests

29 cases covering sanitization, continuation cap, reset gate, SSE reading,
CSRF retry, and generation guard. Run from the repo root with Node ≥ 18:

```bash
node --test docroot/profiles/contrib/webspark/modules/asu_ai_chatbot_styles/tests/js/*.test.js
# or via the package.json script:
yarn test:asu-sparkles-js
```

Requires `jsdom` in `devDependencies` (`yarn add --dev jsdom`). All tests use
Node's built-in `node:test` runner — no test-framework install needed.
