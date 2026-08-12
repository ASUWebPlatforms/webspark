/**
 * Post-install patch for @asu/component-header-footer React 18/19 compatibility.
 *
 * asuHeaderFooter.umd.js bundles its own internal copy of react-dom 19 which uses
 * Symbol.for("react.transitional.element") as REACT_ELEMENT_TYPE. Our global
 * React (window.React from asu_react_integration) is patched to produce elements
 * with Symbol.for("react.element") for compatibility with React 18 UMD bundles.
 * The internal reconciler's switch($$typeof) therefore never matches, throwing #525.
 *
 * Fix: replace all Symbol.for("react.transitional.element") with
 * Symbol.for("react.element") in the UMD bundle so its internal react-dom and the
 * global React speak the same element symbol.
 */

const fs = require('fs');
const path = require('path');

const umdFile = path.join(
  __dirname,
  'node_modules/@asu/component-header-footer/dist/asuHeaderFooter.umd.js',
);

if (!fs.existsSync(umdFile)) {
  console.error('patch.js: UMD file not found:', umdFile);
  process.exit(1);
}

let content = fs.readFileSync(umdFile, 'utf8');

const original = 'Symbol.for("react.transitional.element")';
const replacement = 'Symbol.for("react.element")';
const count = (
  content.match(/Symbol\.for\("react\.transitional\.element"\)/g) || []
).length;

if (count === 0) {
  console.log(
    'patch.js: asuHeaderFooter.umd.js already patched or pattern not found — skipping.',
  );
  process.exit(0);
}

content = content.replaceAll(original, replacement);
fs.writeFileSync(umdFile, content);
console.log(
  `patch.js: replaced ${count} occurrence(s) of Symbol.for("react.transitional.element") → Symbol.for("react.element") in asuHeaderFooter.umd.js`,
);
