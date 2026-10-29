/**
 * Build script for asu_degree_rfi.
 *
 * Produces two committed IIFE artifacts:
 *  - dist/asu_degree_rfi.rfi.min.js: @asu/app-rfi (ESM) + js/asu_degree_rfi.rfi.js
 *    glue, for the `app-rfi` library (single consumer).
 *  - dist/degree-page-core.min.js: @asu/app-degree-pages (ESM) re-exposed as the
 *    `AsuDegreePages` global, shared by the degree-listing-page and
 *    program-detail-page libraries (multiple consumers).
 *
 * React/ReactDOM are provided at runtime by asu_react_integration (window
 * globals) — see the shared helper.
 */

const {
  bundle,
  bundleGlobal,
  copyAssets,
} = require('../asu_react_integration/esbuild-react-global');

Promise.all([
  bundle({
    dir: __dirname,
    entry: 'js/asu_degree_rfi.rfi.js',
    outfile: 'dist/asu_degree_rfi.rfi.min.js',
  }),
  bundleGlobal({
    dir: __dirname,
    packageName: '@asu/app-degree-pages',
    globalName: 'AsuDegreePages',
    outfile: 'dist/degree-page-core.min.js',
  }),
])
  .then(() => {
    // Both bundles load from dist/, so colocate both packages' assets there.
    copyAssets({ dir: __dirname, packageName: '@asu/app-rfi' });
    copyAssets({ dir: __dirname, packageName: '@asu/app-degree-pages' });
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
