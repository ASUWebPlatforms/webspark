# ASU React Integration

The ASU React Integration module provides React and ReactDOM as a Drupal library (`asu_react_integration/reactjs`) consumed by all React-based Webspark modules (`asu_brand`, `asu_react_core`, `asu_news`, `asu_events`, `webspark_webdir`, `asu_degree_rfi`).

## How it works

Rather than relying on React's pre-built UMD files (which were removed in React 19), this module builds its own combined bundle using [esbuild](https://esbuild.github.io/). The build entry point (`build.js`) imports React and ReactDOM and assigns them to `globalThis`, producing a single IIFE file (`dist/react.production.min.js`) that sets `window.React` and `window.ReactDOM` when loaded in a browser.

The downstream `@asu/*` UMD packages expect these two globals to be present before they execute. The Drupal library definition in `asu_react_integration.libraries.yml` loads the bundle with `weight: -10` to ensure it runs first.

The compiled `dist/react.production.min.js` artifact is committed to the repository so no build step is required at deploy time — matching the pattern used by all other Webspark React modules.

## Installation

The ASU React Integration module installs when you create a Webspark site. No manual steps are required.

## Requirements

Drupal 10.x or later.

## Updating React

When a new version of React is released, follow these steps:

**1. Update the version in `package.json`:**

```json
"dependencies": {
  "react": "^19",
  "react-dom": "^19"
}
```

Replace `^19` with the new version constraint as needed.

**2. Install dependencies:**

```bash
yarn install
```

**3. Rebuild the bundle:**

```bash
yarn build
```

This runs esbuild against `build.js` and overwrites `dist/react.production.min.js`.

**4. Verify the output:**

Confirm the bundle correctly sets both globals by running:

```bash
node -e "
const vm = require('vm');
const fs = require('fs');
const code = fs.readFileSync('dist/react.production.min.js', 'utf8');
const ctx = { globalThis: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const g = ctx.globalThis;
console.log('React.version:', g.React.version);
console.log('React.createElement:', typeof g.React.createElement);
console.log('ReactDOM.createRoot:', typeof g.ReactDOM.createRoot);
console.log('ReactDOM.hydrateRoot:', typeof g.ReactDOM.hydrateRoot);
"
```

All four values should be the new version string or `function`.

**5. Update the library version in `asu_react_integration.libraries.yml`:**

```yaml
reactjs:
  version: 2.19.x # update to reflect the new React version
```

**6. Commit the updated files:**

```
asu_react_integration/package.json
asu_react_integration/yarn.lock
asu_react_integration/asu_react_integration.libraries.yml
asu_react_integration/dist/react.production.min.js
```

## Notes on `react-dom/client` vs `react-dom`

In React 19, `createRoot` and `hydrateRoot` moved from the top-level `react-dom` export to `react-dom/client`. The `build.js` entry point imports `react-dom/client` specifically to ensure these methods are present on `window.ReactDOM`, as all `@asu/*` UMD bundles depend on them.

If a future `@asu/*` package requires additional methods on `window.ReactDOM` that live on the base `react-dom` export (such as `createPortal` or `flushSync`), update `build.js` to merge both:

```js
import * as React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactDOMBase from 'react-dom';
globalThis.React = React;
globalThis.ReactDOM = { ...ReactDOMBase, ...ReactDOMClient };
```

Note that this will increase the bundle size slightly as both `react-dom` and `react-dom/client` will be included.
