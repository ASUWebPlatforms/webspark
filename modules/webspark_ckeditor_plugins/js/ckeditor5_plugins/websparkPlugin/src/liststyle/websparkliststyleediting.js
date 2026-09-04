/**
 * @file This is what CKEditor refers to as a master (glue) plugin. Its role is
 * just to load the “editing” and “UI” components of this Plugin. Those
 * components could be included in this file, but
 *
 * I.e, this file's purpose is to integrate all the separate parts of the plugin
 * before it's made discoverable via index.js.
 */

import { Plugin } from 'ckeditor5/src/core';
import { ContextualBalloon } from 'ckeditor5/src/ui';
import InsertWebsparkListStyleCommand from './insertliststylecommand';
import { Widget } from 'ckeditor5/src/widget';
import { first } from 'ckeditor5/src/utils';
import { _getSibling, _initUdsListClass, _test } from './utils';

/**
 * View element custom property holding the author's original start value.
 *
 * @type {string}
 */
const AUTHORED_START = 'websparkAuthoredListStart';
//
export default class WebsparkListStyleEditing extends Plugin {
  static get requires() {
    return [Widget, ContextualBalloon];
  }

  /**
   * @inheritdoc
   */
  static get pluginName() {
    return 'WebsparkListStyleEditing';
  }

  constructor(editor) {
    super(editor);
  }

  init() {
    const editor = this.editor;
    const { model } = this.editor;
    editor.commands.add(
      'insertliststyle',
      new InsertWebsparkListStyleCommand(editor),
    );

    editor.commands.add('bulletedListOld', editor.commands.get('bulletedList'));
    const customBulletedListCommand = {
      execute: function (value) {
        // Call the original bulletedList command.
        editor.execute('bulletedListOld', value);
        _initUdsListClass(model);
      },
    };
    // Register custom commands.
    editor.commands.add('bulletedList', customBulletedListCommand);
    editor.commands.get('bulletedList').isEnabled = true;

    editor.commands.add('numberedListOld', editor.commands.get('numberedList'));
    const customNumberedListCommand = {
      execute: function (value) {
        // Call the original numberedList command.
        editor.execute('numberedListOld', value);
        _initUdsListClass(model);
      },
    };
    // Register custom commands.
    editor.commands.add('numberedList', customNumberedListCommand);
    editor.commands.get('numberedList').isEnabled = true;

    // Give reversed lists an explicit start attribute in the editing view.
    //
    // The numbers shown in the editor are drawn by the UDS styles through
    // li::before and counter(list-item), not by native list markers. When an
    // <ol reversed> carries no start attribute the browser has to derive the
    // counter's initial value at layout time from the number of items, and
    // Chromium resolves that incorrectly when the value is read from generated
    // content. Stating it explicitly removes the computation, which is the same
    // fix the webspark_reversed_list_start filter applies to rendered pages.
    //
    // This is an editing view post-fixer on purpose, so `start` never reaches
    // the saved data. Keeping it out of the data avoids a stale start value
    // when items are added or removed later: the count is recomputed here on
    // every render, and recomputed server side on output.
    editor.editing.view.document.registerPostFixer((writer) =>
      this._fixReversedListStart(writer),
    );

    // Chromium does not recompute a list counter when `reversed` or `start`
    // change on an already rendered DOM. The attributes land correctly in the
    // model, the view and the DOM, but the numbers drawn by li::before keep
    // their previous values. Taking the list out of layout and back in forces
    // the recomputation.
    //
    // This is driven by specific triggers rather than by every render because
    // reading offsetHeight forces a synchronous layout, which would be costly
    // on each keystroke.
    ['listReversed', 'listStart'].forEach((commandName) => {
      const command = editor.commands.get(commandName);

      if (command) {
        this.listenTo(
          command,
          'execute',
          () => {
            this._scheduleCounterReflow();
          },
          { priority: 'low' },
        );
      }
    });
  }

  /**
   * Writes an explicit start attribute onto reversed lists in the editing view.
   *
   * The value is the highest number of the sequence the author chose. CKEditor
   * downcasts `listStart` straight into `start` with no adjustment for
   * `reversed`, so a three item list set to "start at 5" arrives here as
   * <ol reversed start="5">. The numbers the author picked are 5, 6 and 7, so
   * the reversed sequence begins at 7.
   *
   * The author's value is stashed in a custom property on first sight, because
   * once `start` has been overwritten there is no way to tell our value from
   * theirs on the next pass. Custom properties live on the view element only
   * and are never rendered to the DOM. When CKEditor recreates the element the
   * property goes with it, which is correct: the fresh element again carries
   * only the author's value.
   *
   * @param {module:engine/view/downcastwriter~DowncastWriter} writer
   *   The view writer provided by the post-fixer.
   *
   * @return {boolean}
   *   TRUE when the view was changed, which triggers another post-fixer pass.
   */
  _fixReversedListStart(writer) {
    const root = this.editor.editing.view.document.getRoot();

    if (!root) {
      return false;
    }

    let changed = false;

    for (const { item } of writer.createRangeIn(root)) {
      if (!item.is('element', 'ol') || !item.hasAttribute('reversed')) {
        continue;
      }

      let count = 0;

      for (const child of item.getChildren()) {
        if (child.is('element', 'li')) {
          count++;
        }
      }

      if (!count) {
        continue;
      }

      let first = item.getCustomProperty(AUTHORED_START);

      if (first === undefined) {
        // An absent start attribute means the sequence begins at 1.
        first = item.hasAttribute('start')
          ? Number(item.getAttribute('start'))
          : 1;
        writer.setCustomProperty(AUTHORED_START, first, item);
      }

      const highest = String(first + count - 1);

      // Comparing before writing keeps the post-fixer from looping.
      if (item.getAttribute('start') !== highest) {
        writer.setAttribute('start', highest, item);
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Queues a single counter reflow for the next animation frame.
   *
   * Coalescing matters because one user action can fire several triggers, and
   * the reflow must run after CKEditor has written the DOM.
   */
  _scheduleCounterReflow() {
    if (this._reflowScheduled || typeof window === 'undefined') {
      return;
    }

    this._reflowScheduled = true;

    window.requestAnimationFrame(() => {
      this._reflowScheduled = false;
      this._forceCounterReflow();
    });
  }

  /**
   * Forces Chromium to recompute list counters in the editing view.
   *
   * Every ordered list is touched, not only the reversed ones, because
   * switching a list back to ascending needs the same recomputation and no
   * longer matches a [reversed] selector.
   */
  _forceCounterReflow() {
    const domRoot = this.editor.editing.view.getDomRoot();

    if (!domRoot) {
      return;
    }

    domRoot.querySelectorAll('ol').forEach((ol) => {
      const previous = ol.style.display;

      ol.style.display = 'none';
      // Reading a layout property between the two writes is what forces the
      // element out of layout. The value itself is not used.
      void ol.offsetHeight;

      if (previous) {
        ol.style.display = previous;
      } else {
        ol.style.removeProperty('display');
      }

      // Leave the DOM exactly as it was found, so the editor's renderer has
      // nothing to reconcile.
      if (ol.getAttribute('style') === '') {
        ol.removeAttribute('style');
      }
    });
  }
}
