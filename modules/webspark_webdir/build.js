/**
 * Build script for webspark_webdir.
 *
 * Bundles @asu/app-webdir-ui (ESM) + the Drupal glue in js/webspark_webdir.js
 * into dist/webspark_webdir.min.js. React/ReactDOM are provided at runtime by
 * asu_react_integration (window globals) — see the shared helper.
 */

const fs = require('fs');
const path = require('path');
const {
  bundle,
  copyAssets,
} = require('../asu_react_integration/esbuild-react-global');

bundle({
  dir: __dirname,
  entry: 'js/webspark_webdir.js',
  outfile: 'dist/webspark_webdir.min.js',
})
  .then(() => {
    copyAssets({ dir: __dirname, packageName: '@asu/app-webdir-ui' });

    // app-webdir-ui appends img/anon.png to appPathFolder, but publishes the
    // fallback at dist/assets/anon.png. Preserve the published path for Twig
    // templates and copy it to the component's expected runtime path.
    const source = path.join(__dirname, 'dist/assets/anon.png');
    const destination = path.join(__dirname, 'dist/assets/img/anon.png');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
