/**
 * Build script for asu_news.
 *
 * Bundles @asu/component-news (ESM) + the Drupal glue in js/asu_news.js into
 * dist/asu_news.min.js. React/ReactDOM are provided at runtime by
 * asu_react_integration (window globals) — see the shared helper.
 */

const { bundle } = require('../asu_react_integration/esbuild-react-global');

bundle({
  dir: __dirname,
  entry: 'js/asu_news.js',
  outfile: 'dist/asu_news.min.js',
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
