/**
 * Build script for asu_react_core.
 *
 * @asu/unity-react-core (ESM) is shared by many Drupal libraries (testimonial,
 * carousels, cards, etc.) via the `unityReactCore` global. We bundle it into a
 * single IIFE (dist/react-core.min.js) that re-exposes that global, so the
 * individual component JS files keep calling `unityReactCore.initX(...)`
 * unchanged. React/ReactDOM are provided at runtime by asu_react_integration.
 */

const {
  bundleGlobal,
} = require('../asu_react_integration/esbuild-react-global');

bundleGlobal({
  dir: __dirname,
  packageName: '@asu/unity-react-core',
  globalName: 'unityReactCore',
  outfile: 'dist/react-core.min.js',
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
