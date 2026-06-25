/**
 * Post-install patch for React 18/19 compatibility.
 * See asu_brand/patch.js or asu_react_core/patch.js for full explanation.
 */

const fs = require('fs');
const path = require('path');

const targets = [
  'node_modules/@asu/app-webdir-ui/dist/webdirUI.umd.js',
  'node_modules/@asu/unity-react-core/dist/unityReactCore.umd.js',
];

const original = 'Symbol.for("react.transitional.element")';
const replacement = 'Symbol.for("react.element")';

for (const rel of targets) {
  const file = path.join(__dirname, rel);
  if (!fs.existsSync(file)) {
    console.warn(`patch.js: not found, skipping: ${rel}`);
    continue;
  }
  const content = fs.readFileSync(file, 'utf8');
  const count = (
    content.match(/Symbol\.for\("react\.transitional\.element"\)/g) || []
  ).length;
  if (count === 0) {
    console.log(
      `patch.js: already patched or pattern not found — skipping: ${rel}`,
    );
    continue;
  }
  fs.writeFileSync(file, content.replaceAll(original, replacement));
  console.log(`patch.js: replaced ${count} occurrence(s) in ${rel}`);
}
