/**
 * Post-build patch for React 19 / React 18 UMD bundle compatibility.
 *
 * Problem: React 19 renamed the element $$typeof symbol:
 *   React 18 (REACT_ELEMENT_TYPE):          Symbol.for("react.element")
 *   React 19 (REACT_ELEMENT_TYPE):          Symbol.for("react.transitional.element")
 *   React 19 (REACT_LEGACY_ELEMENT_TYPE):   Symbol.for("react.element")  ← throws #525
 *
 * Third-party UMD bundles compiled against React 18 (e.g. @asu/component-events,
 * @asu/component-news) contain a bundled copy of the old React 18 JSX classic
 * runtime which stamps elements with $$typeof = Symbol.for("react.element").
 *
 * React 19's reconciler switch(newChild.$$typeof) only matches REACT_ELEMENT_TYPE
 * ("react.transitional.element"), so React 18 elements fall through to
 * throwOnInvalidObjectTypeImpl → error #525 (legacy element) or error #31 (unknown).
 *
 * Fix: replace ALL occurrences of "react.transitional.element" with "react.element"
 * in the compiled bundle. This aligns React 19's REACT_ELEMENT_TYPE constant and
 * React.createElement output back to "react.element", matching what the old bundled
 * JSX runtimes produce. The REACT_LEGACY_ELEMENT_TYPE constant (also "react.element")
 * collapses into REACT_ELEMENT_TYPE so the legacy-throw path is never triggered.
 */

const fs = require('fs');
const path = require('path');

const distFile = path.join(__dirname, 'dist', 'react.production.min.js');
let content = fs.readFileSync(distFile, 'utf8');

const original = 'Symbol.for("react.transitional.element")';
const replacement = 'Symbol.for("react.element")';

const count = (
  content.match(/Symbol\.for\("react\.transitional\.element"\)/g) || []
).length;
if (count === 0) {
  console.error(
    'patch.js: WARNING - no occurrences of Symbol.for("react.transitional.element") found in dist. Patch may be out of date.',
  );
  process.exit(1);
}

content = content.replaceAll(original, replacement);
fs.writeFileSync(distFile, content);
console.log(
  `patch.js: replaced ${count} occurrence(s) of Symbol.for("react.transitional.element") → Symbol.for("react.element")`,
);
