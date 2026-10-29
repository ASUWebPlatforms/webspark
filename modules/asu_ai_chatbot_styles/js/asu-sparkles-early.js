/**
 * @file
 * Marks the restored ASU sparkles chat state before the first paint.
 *
 * Mirrors ai_chatbot's toolbar-chatbot-early.js / the asu_ai_chatbot_floating
 * early script: if the visitor previously compacted the widget,
 * suppress the open/expand transition on load (including when the block
 * arrives in a late BigPipe chunk). asu-sparkles.js removes the class after
 * the window load event, once the restored state has painted, so
 * user-initiated transitions animate normally.
 */
(function () {
  'use strict';

  try {
    var state = window.localStorage.getItem('Drupal.asuSparkles.state');
    if (!state || state === 'collapsed') {
      return;
    }
  } catch (e) {
    // localStorage unavailable; nothing to restore.
    return;
  }

  document.documentElement.classList.add('asu-sparkles-restoring');

  window.addEventListener(
    'load',
    function () {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          document.documentElement.classList.remove('asu-sparkles-restoring');
        });
      });
    },
    { once: true },
  );
})();
