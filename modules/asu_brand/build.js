/**
 * Build script for asu_brand.
 *
 * Bundles @asu/component-header-footer (ESM) + the Drupal glue in
 * js/asu_brand.header.js into dist/asu_brand.min.js. React/ReactDOM are provided
 * at runtime by asu_react_integration (window globals) — see the shared helper.
 *
 * The header block serves its logo images by URL at runtime (see
 * AsuBrandHeaderBlock::getPathImgFolder), so copy the package's assets into
 * dist/assets alongside the bundle.
 */

const {
  bundle,
  copyAssets,
} = require('../asu_react_integration/esbuild-react-global');

bundle({
  dir: __dirname,
  entry: 'js/asu_brand.header.js',
  outfile: 'dist/asu_brand.min.js',
})
  .then(() =>
    copyAssets({ dir: __dirname, packageName: '@asu/component-header-footer' }),
  )
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
