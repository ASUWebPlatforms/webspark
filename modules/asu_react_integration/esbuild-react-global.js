/**
 * Shared esbuild helper for Webspark React modules.
 *
 * Bundles an `@asu/*` package's ESM build plus a module's Drupal glue JS into a
 * single classic IIFE that Drupal loads as an ordinary script (JS aggregation
 * and Drupal.behaviors keep working). React/ReactDOM are not bundled: the
 * `reactGlobalAlias` plugin rewrites bare react imports to the window globals
 * provided by asu_react_integration, so the whole site shares one React
 * instance.
 */

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

// react/react-dom are needed at build time only, to enumerate the named exports
// each runtime global must expose.
const React = require('react');
const ReactDOM = require('react-dom');
const ReactDOMClient = require('react-dom/client');

const exportNames = (obj) =>
  Object.keys(obj).filter(
    (k) => k !== 'default' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k),
  );

const buildStub = (globalExpr, obj) => {
  const names = exportNames(obj);
  return (
    `const _m = ${globalExpr};\n` +
    `export default _m;\n` +
    names
      .map((n) => `export const ${n} = _m[${JSON.stringify(n)}];`)
      .join('\n') +
    '\n'
  );
};

const reactGlobalAlias = {
  name: 'react-global-alias',
  setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({
      path: 'react',
      namespace: 'react-global',
    }));
    build.onResolve({ filter: /^react-dom$/ }, () => ({
      path: 'react-dom',
      namespace: 'react-global',
    }));
    build.onResolve({ filter: /^react-dom\/client$/ }, () => ({
      path: 'react-dom/client',
      namespace: 'react-global',
    }));
    build.onLoad({ filter: /.*/, namespace: 'react-global' }, (args) => {
      const contents =
        args.path === 'react'
          ? buildStub('window.React', React)
          : // asu_react_integration merges react-dom + react-dom/client onto
            // window.ReactDOM, so both specifiers resolve there.
            buildStub('window.ReactDOM', { ...ReactDOM, ...ReactDOMClient });
      return { contents, loader: 'js' };
    });
  },
};

// Several @asu packages ship a `browser` field pointing at their legacy UMD
// build, which esbuild would otherwise prefer. Putting `module` first (and the
// `import` condition) forces the ESM build that externalizes React.
const ESM_RESOLUTION = {
  mainFields: ['module', 'main'],
  conditions: ['import', 'module', 'browser', 'default'],
};

// Inline images/fonts as data URIs (matching the old all-in-one bundles); CSS
// is injected at runtime via the `css` loader.
const ASSET_LOADERS = {
  loader: {
    '.png': 'dataurl',
    '.jpg': 'dataurl',
    '.jpeg': 'dataurl',
    '.gif': 'dataurl',
    '.webp': 'dataurl',
    '.svg': 'dataurl',
    '.mp4': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.ttf': 'dataurl',
    '.eot': 'dataurl',
    '.css': 'css',
  },
};

/**
 * Bundle a module entry file into a committed IIFE artifact.
 *
 * @param {object} opts
 * @param {string} opts.dir   Absolute path of the calling module (use __dirname).
 * @param {string} opts.entry Entry file relative to dir (e.g. 'js/asu_news.js').
 * @param {string} opts.outfile Output file relative to dir (e.g. 'dist/asu_news.min.js').
 * @returns {Promise<void>}
 */
const bundle = ({ dir, entry, outfile }) =>
  esbuild.build({
    entryPoints: [path.join(dir, entry)],
    bundle: true,
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: path.join(dir, outfile),
    plugins: [reactGlobalAlias],
    logLevel: 'info',
    ...ESM_RESOLUTION,
    ...ASSET_LOADERS,
  });

/**
 * Bundle an `@asu/*` package and expose it on a window global, for cases where
 * several Drupal libraries share one package via a global namespace (e.g.
 * `window.unityReactCore`). Uses a virtual entry, so no source entry file is
 * needed.
 *
 * @param {object} opts
 * @param {string} opts.dir         Absolute path of the calling module (__dirname).
 * @param {string} opts.packageName Bare specifier to bundle (e.g. '@asu/unity-react-core').
 * @param {string} opts.globalName  Window global to assign (e.g. 'unityReactCore').
 * @param {string} opts.outfile     Output file relative to dir.
 * @returns {Promise<void>}
 */
const bundleGlobal = ({ dir, packageName, globalName, outfile }) =>
  esbuild.build({
    stdin: {
      contents:
        `import * as _ns from ${JSON.stringify(packageName)};\n` +
        `window[${JSON.stringify(globalName)}] = _ns;\n`,
      resolveDir: dir,
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    outfile: path.join(dir, outfile),
    plugins: [reactGlobalAlias],
    logLevel: 'info',
    ...ESM_RESOLUTION,
    ...ASSET_LOADERS,
  });

/**
 * Copy an `@asu/*` package's `dist/assets` directory into the module's own
 * `dist/assets`, so runtime asset paths keep resolving.
 *
 * Several components build image URLs relative to their own script location
 * (via `document.currentScript.src`), e.g. `${base}/assets/img/foo.png`. When
 * the bundle lived in `node_modules/<pkg>/dist/`, those assets sat right beside
 * it. Now that the committed bundle lives in `<module>/dist/`, the assets must
 * be colocated there too to preserve identical behavior.
 *
 * @param {object} opts
 * @param {string} opts.dir         Absolute path of the calling module (__dirname).
 * @param {string} opts.packageName Package whose assets to copy (e.g. '@asu/app-rfi').
 * @param {string} [opts.outDir]    Output dir relative to the module (default 'dist').
 */
const copyAssets = ({ dir, packageName, outDir = 'dist' }) => {
  const src = path.join(dir, 'node_modules', packageName, 'dist', 'assets');
  if (!fs.existsSync(src)) {
    return;
  }
  const dest = path.join(dir, outDir, 'assets');
  fs.cpSync(src, dest, { recursive: true });
  console.log(`copied assets: ${packageName}/dist/assets -> ${outDir}/assets`);
};

module.exports = {
  reactGlobalAlias,
  bundle,
  bundleGlobal,
  copyAssets,
};
