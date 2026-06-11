/**
 * Post-install patch for @asu/unity-react-core React 18/19 compatibility.
 *
 * unityReactCore.umd.js bundles its own internal copy of react-dom which uses
 * Symbol.for("react.transitional.element") as REACT_ELEMENT_TYPE. Our global
 * React (window.React from asu_react_integration) produces elements with
 * Symbol.for("react.element") for compatibility with React 18 UMD bundles.
 * The internal reconciler's switch($$typeof) therefore never matches, throwing #525.
 *
 * Fix: replace all Symbol.for("react.transitional.element") with
 * Symbol.for("react.element") in the UMD bundle.
 */

const fs = require('fs');
const path = require('path');

const umdFile = path.join(
  __dirname,
  'node_modules/@asu/unity-react-core/dist/unityReactCore.umd.js',
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
    'patch.js: unityReactCore.umd.js already patched or pattern not found — skipping.',
  );
  process.exit(0);
}

content = content.replaceAll(original, replacement);
fs.writeFileSync(umdFile, content);
console.log(
  `patch.js: replaced ${count} occurrence(s) of Symbol.for("react.transitional.element") → Symbol.for("react.element") in unityReactCore.umd.js`,
);
