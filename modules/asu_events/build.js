/**
 * Build script for asu_events.
 *
 * Bundles @asu/component-events (ESM) + the Drupal glue in js/asu_events.js into
 * dist/asu_events.min.js. React/ReactDOM are provided at runtime by
 * asu_react_integration (window globals) — see the shared helper.
 */

const { bundle } = require('../asu_react_integration/esbuild-react-global');

bundle({
  dir: __dirname,
  entry: 'js/asu_events.js',
  outfile: 'dist/asu_events.min.js',
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
