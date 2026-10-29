/* eslint-disable no-script-url, global-require, no-useless-escape, import/no-extraneous-dependencies */
/**
 * @file
 * Sanitizer unit tests — §23.6.a (12 cases).
 *
 * node --test sanitizer.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv } = require('./helpers/jsdom-env');

// ---------------------------------------------------------------------------
// 1. sanitize_strips_img_onerror
// ---------------------------------------------------------------------------
test('sanitize_strips_img_onerror', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const result = sanitizeHtml('<img src="x" onerror="alert(1)">');
  assert.ok(!result.includes('onerror'), `onerror present in: ${result}`);
});

// ---------------------------------------------------------------------------
// 2. sanitize_strips_script_tag
// ---------------------------------------------------------------------------
test('sanitize_strips_script_tag', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const result = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
  assert.ok(result.includes('<p>ok</p>'), `<p>ok</p> missing from: ${result}`);
  assert.ok(
    !result.toLowerCase().includes('<script'),
    `<script> present in: ${result}`,
  );
});

// ---------------------------------------------------------------------------
// 3. sanitize_strips_javascript_href
// ---------------------------------------------------------------------------
test('sanitize_strips_javascript_href', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const result = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
  assert.ok(
    !result.includes('javascript:'),
    `javascript: present in: ${result}`,
  );
});

// ---------------------------------------------------------------------------
// 4. sanitize_strips_data_text_html_href
// ---------------------------------------------------------------------------
test('sanitize_strips_data_text_html_href', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const result = sanitizeHtml(
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  );
  assert.ok(!result.includes('data:'), `data: URI present in: ${result}`);
});

// ---------------------------------------------------------------------------
// 5. sanitize_strips_vbscript_href
// ---------------------------------------------------------------------------
test('sanitize_strips_vbscript_href', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const result = sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>');
  assert.ok(!result.includes('vbscript:'), `vbscript: present in: ${result}`);
});

// ---------------------------------------------------------------------------
// 6. sanitize_strips_svg_onload
// ---------------------------------------------------------------------------
test('sanitize_strips_svg_onload', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const result = sanitizeHtml('<svg onload="alert(1)"><circle/></svg>');
  assert.ok(
    !result.toLowerCase().includes('<svg'),
    `<svg> present in: ${result}`,
  );
  assert.ok(!result.includes('onload'), `onload present in: ${result}`);
});

// ---------------------------------------------------------------------------
// 7. sanitize_strips_iframe
// ---------------------------------------------------------------------------
test('sanitize_strips_iframe', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const result = sanitizeHtml('<iframe src="//evil.example.com"></iframe>');
  assert.ok(
    !result.toLowerCase().includes('<iframe'),
    `<iframe> present in: ${result}`,
  );
});

// ---------------------------------------------------------------------------
// 8. sanitize_preserves_benign_anchor
// ---------------------------------------------------------------------------
test('sanitize_preserves_benign_anchor', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const result = sanitizeHtml('<a href="https://asu.edu">x</a>');
  assert.ok(
    result.includes('href="https://asu.edu"') ||
      result.includes("href='https://asu.edu'"),
    `href missing from: ${result}`,
  );
  assert.ok(result.includes('>x<'), `link text missing from: ${result}`);
});

// ---------------------------------------------------------------------------
// 9. sanitize_preserves_markdown_list_code_image
// ---------------------------------------------------------------------------
test('sanitize_preserves_markdown_list_code_image', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const input = '<ul><li><code>x</code></li></ul><img src="/a.png" alt="a">';
  const result = sanitizeHtml(input);
  assert.ok(result.includes('<ul>'), `<ul> missing from: ${result}`);
  assert.ok(result.includes('<li>'), `<li> missing from: ${result}`);
  assert.ok(result.includes('<code>'), `<code> missing from: ${result}`);
  assert.ok(result.includes('<img'), `<img> missing from: ${result}`);
  assert.ok(
    result.includes('src="/a.png"') || result.includes("src='/a.png'"),
    `src missing from: ${result}`,
  );
});

// ---------------------------------------------------------------------------
// 10. sanitize_preserves_headings_and_blockquote
// ---------------------------------------------------------------------------
test('sanitize_preserves_headings_and_blockquote', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const input = '<h2>t</h2><blockquote><p>b</p></blockquote>';
  const result = sanitizeHtml(input);
  assert.ok(result.includes('<h2>'), `<h2> missing from: ${result}`);
  assert.ok(
    result.includes('<blockquote>'),
    `<blockquote> missing from: ${result}`,
  );
  assert.ok(result.includes('<p>'), `<p> missing from: ${result}`);
});

// ---------------------------------------------------------------------------
// 11. sanitize_forces_rel_on_target_blank
// ---------------------------------------------------------------------------
test('sanitize_forces_rel_on_target_blank', () => {
  const { AsuSparkles } = buildEnv();
  const { sanitizeHtml } = AsuSparkles._test;
  const result = sanitizeHtml('<a href="https://x.com" target="_blank">x</a>');
  assert.ok(result.includes('rel='), `rel missing from: ${result}`);
  assert.ok(
    result.includes('noopener') && result.includes('noreferrer'),
    `rel value wrong in: ${result}`,
  );
});

// ---------------------------------------------------------------------------
// 13–20. fallback_obfuscated_scheme_bypass (FIX 1 RED)
//
// The fallback scrubber must reject tab/newline/control-char-obfuscated URL
// schemes. Before testing against the denylist the value is normalized:
// strip all ASCII whitespace + control chars (\x00-\x1F), lowercase, then
// check startsWith('javascript:')|startsWith('vbscript:')|startsWith('data:').
//
// These tests run the fallback path explicitly (DOMPurify absent) by building
// a second env with no DOMPurify and calling fallbackSanitize directly.
// ---------------------------------------------------------------------------

/**
 * Helper: build a fallback-only env (DOMPurify absent).
 */
function buildFallbackEnv() {
  const { JSDOM } = require('jsdom');
  const fs = require('fs');
  const path = require('path');
  const MODULE_ROOT = path.resolve(__dirname, '../../');
  const SPARKLES_JS = path.join(MODULE_ROOT, 'js/asu-sparkles.js');

  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://techtestai.asu.ddev.site/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.Drupal = {
    t: (s) => s,
    behaviors: {},
    Html: { getUniqueId: (b) => `${b}-1` },
    AsuSparkles: null,
  };
  window.drupalSettings = {
    path: { baseUrl: '/' },
    ai_deepchat: { assistant_id: 'a', thread_id: 't' },
  };
  window.once = function () {
    return [];
  };
  window.once.remove = function () {
    return [];
  };
  window.fetch = function () {
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({}),
    });
  };
  // Explicitly do NOT install DOMPurify.
  const source = fs.readFileSync(SPARKLES_JS, 'utf8');
  window.eval(source);
  return window.Drupal.AsuSparkles._test.fallbackSanitize;
}

test('fallback_strips_tab_obfuscated_javascript_href', () => {
  const fallback = buildFallbackEnv();
  const result = fallback('<a href="java\tscript:alert(1)">x</a>');
  assert.ok(
    !result.includes('javascript:') && !result.includes('java\tscript:'),
    `tab-obfuscated javascript: must be stripped; got: ${result}`,
  );
});

test('fallback_strips_newline_obfuscated_javascript_href', () => {
  const fallback = buildFallbackEnv();
  const result = fallback('<a href="java\nscript:alert(1)">x</a>');
  assert.ok(
    !result.includes('javascript:') && !result.includes('java\nscript:'),
    `newline-obfuscated javascript: must be stripped; got: ${result}`,
  );
});

test('fallback_strips_leading_space_javascript_href', () => {
  const fallback = buildFallbackEnv();
  const result = fallback('<a href=" javascript:alert(1)">x</a>');
  assert.ok(
    !result.includes('javascript:'),
    `leading-space javascript: must be stripped; got: ${result}`,
  );
});

test('fallback_strips_mixed_case_javascript_href', () => {
  const fallback = buildFallbackEnv();
  const result = fallback('<a href="JaVaScript:alert(1)">x</a>');
  assert.ok(
    !result.toLowerCase().includes('javascript:'),
    `mixed-case javascript: must be stripped; got: ${result}`,
  );
});

test('fallback_strips_vbscript_href', () => {
  const fallback = buildFallbackEnv();
  const result = fallback('<a href="vbscript:msgbox(1)">x</a>');
  assert.ok(
    !result.includes('vbscript:'),
    `vbscript: must be stripped; got: ${result}`,
  );
});

test('fallback_strips_data_text_html_href', () => {
  const fallback = buildFallbackEnv();
  const result = fallback('<a href="data:text/html,<h1>x</h1>">x</a>');
  assert.ok(
    !result.includes('data:'),
    `data:text/html must be stripped; got: ${result}`,
  );
});

test('fallback_preserves_https_href', () => {
  const fallback = buildFallbackEnv();
  const result = fallback('<a href="https://asu.edu">ok</a>');
  assert.ok(
    result.includes('https://asu.edu'),
    `https: URL must be preserved; got: ${result}`,
  );
});

test('fallback_preserves_mailto_and_relative_href', () => {
  const fallback = buildFallbackEnv();
  const r1 = fallback('<a href="mailto:test@asu.edu">mail</a>');
  assert.ok(r1.includes('mailto:'), `mailto: must be preserved; got: ${r1}`);
  const r2 = fallback('<a href="#section">jump</a>');
  assert.ok(
    r2.includes('href="#section"') || r2.includes("href='#section'"),
    `relative/hash href must be preserved; got: ${r2}`,
  );
});

// ---------------------------------------------------------------------------
// 12. fallback_scrubber_neutralizes_core_vectors
//     Run with DOMPurify deleted (fallback scrubber path).
// ---------------------------------------------------------------------------
test('fallback_scrubber_neutralizes_core_vectors', () => {
  // Build a fresh env without DOMPurify by using the jsdom-env helper but
  // then testing fallbackSanitize directly (which is exported in _test).
  // We build a second env that never had DOMPurify to test the fallback path.
  const { JSDOM } = require('jsdom');
  const fs = require('fs');
  const path = require('path');
  // Resolve the module root from this test file's location.
  const MODULE_ROOT = path.resolve(__dirname, '../../');
  const SPARKLES_JS = path.join(MODULE_ROOT, 'js/asu-sparkles.js');

  const dom2 = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://techtestai.asu.ddev.site/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom2.window;
  win.Drupal = {
    t: (s) => s,
    behaviors: {},
    Html: { getUniqueId: (b) => `${b}-1` },
    AsuSparkles: null,
  };
  win.drupalSettings = {
    path: { baseUrl: '/' },
    ai_deepchat: { assistant_id: 'a', thread_id: 't' },
  };
  win.once = function (id, sel, ctx) {
    return [];
  };
  win.once.remove = function () {
    return [];
  };
  win.fetch = function () {
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({}),
    });
  };
  // Explicitly do NOT install DOMPurify (testing fallback scrubber path)
  const source = fs.readFileSync(SPARKLES_JS, 'utf8');
  win.eval(source);

  const { fallbackSanitize } = win.Drupal.AsuSparkles._test;

  // Case 1: img onerror
  const r1 = fallbackSanitize('<img src="x" onerror="alert(1)">');
  assert.ok(!r1.includes('onerror'), `fallback case 1 onerror: ${r1}`);

  // Case 2: script tag
  const r2 = fallbackSanitize('<p>ok</p><script>alert(1)<\/script>');
  assert.ok(
    !r2.toLowerCase().includes('<script'),
    `fallback case 2 script: ${r2}`,
  );

  // Case 3: javascript href
  const r3 = fallbackSanitize('<a href="javascript:alert(1)">x</a>');
  assert.ok(
    !r3.includes('javascript:'),
    `fallback case 3 javascript href: ${r3}`,
  );

  // Case 6: svg onload
  const r6 = fallbackSanitize('<svg onload="alert(1)"><circle/></svg>');
  assert.ok(!r6.toLowerCase().includes('<svg'), `fallback case 6 svg: ${r6}`);
  assert.ok(!r6.includes('onload'), `fallback case 6 onload: ${r6}`);
});

// ---------------------------------------------------------------------------
// FIX B — NUL / U+FFFD scheme obfuscation (Rev 10 cycle 3)
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-script-url
test('nul_obfuscated_scheme_stripped', () => {
  const fallback = buildFallbackEnv();
  // The HTML parser turns \x00 into U+FFFD; both must be caught.
  const r1 = fallback('<a href="java\u0000script:alert(1)">x</a>');
  assert.ok(
    !r1.includes('javascript:') && !r1.includes('java'),
    `NUL-obfuscated java\\u0000script: must be stripped; got: ${r1}`,
  );
  const r2 = fallback('<a href="java\uFFFDscript:alert(1)">x</a>');
  assert.ok(
    !r2.includes('javascript:') && !r2.includes('java'),
    `U+FFFD java\\uFFFDscript: must be stripped; got: ${r2}`,
  );
});

// ---------------------------------------------------------------------------
// FIX C — additional fallback vectors / attributes (Rev 10 cycle 3)
// ---------------------------------------------------------------------------

test('fallback_strips_xlink_href_javascript', () => {
  const fallback = buildFallbackEnv();
  // xlink:href with javascript: scheme must be stripped.
  const result = fallback('<svg><use xlink:href="javascript:alert(1)"/></svg>');
  assert.ok(
    !result.includes('javascript:'),
    `xlink:href javascript: must be stripped; got: ${result}`,
  );
});

test('fallback_strips_uppercase_JAVASCRIPT', () => {
  const fallback = buildFallbackEnv();
  const result = fallback('<a href="JAVASCRIPT:alert(1)">x</a>');
  assert.ok(
    !result.toLowerCase().includes('javascript:'),
    `uppercase JAVASCRIPT: must be stripped; got: ${result}`,
  );
});

test('fallback_strips_trailing_space_javascript', () => {
  const fallback = buildFallbackEnv();
  // "javascript: " trailing space after the scheme colon.
  const result = fallback('<a href="javascript: alert(1)">x</a>');
  assert.ok(
    !result.includes('javascript:'),
    `trailing-space javascript: must be stripped; got: ${result}`,
  );
});

test('fallback_strips_data_text_html_src', () => {
  const fallback = buildFallbackEnv();
  // data:text/html on src attribute must also be stripped.
  const result = fallback('<img src="data:text/html,<h1>x</h1>">');
  assert.ok(
    !result.includes('data:'),
    `data:text/html on src must be stripped; got: ${result}`,
  );
});

test('fallback_preserves_relative_path_href', () => {
  const fallback = buildFallbackEnv();
  // Relative path href (no scheme) must survive sanitization.
  const result = fallback('<a href="path/x">link</a>');
  assert.ok(
    result.includes('path/x'),
    `relative path/x href must be preserved; got: ${result}`,
  );
});
