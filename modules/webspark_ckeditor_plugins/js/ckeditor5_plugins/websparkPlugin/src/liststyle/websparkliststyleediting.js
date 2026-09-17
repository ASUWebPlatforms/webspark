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
import { _initUdsListClass } from './utils';

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

    const bulletedList = editor.commands.get('bulletedList');
    const numberedList = editor.commands.get('numberedList');

    // Expose the core list commands under their historical alias names. These
    // are read for their observable `value` by websparkliststyleui.js,
    // utils.js and insertliststylecommand.js, so they must stay the real
    // Command instances.
    //
    // Note what is deliberately not done here any more: the core
    // `bulletedList` and `numberedList` commands are no longer replaced with
    // plain wrapper objects. Anything that subscribes to those commands looks
    // them up by name, for example ListPropertiesEditing:
    //
    //   this.listenTo( editor.commands.get( 'numberedList' ), '_executeCleanup', … )
    //
    // Registering an object that is not a Command breaks such subscriptions and
    // strips the observable `value` / `isEnabled` that list UI binds to. The
    // previous code also pinned `isEnabled` to TRUE, which defeated state
    // tracking on the toolbar buttons entirely.
    editor.commands.add('bulletedListOld', bulletedList);
    editor.commands.add('numberedListOld', numberedList);

    // `Command#execute` is a decorated method, so a low priority listener runs
    // after the command body has finished. Applying the uds-list class here
    // keeps it inside the command's own batch, so it remains a single undo
    // step, without shadowing the command.
    this.listenTo(
      bulletedList,
      'execute',
      () => {
        _initUdsListClass(model);
      },
      { priority: 'low' },
    );

    this.listenTo(
      numberedList,
      'execute',
      () => {
        _initUdsListClass(model);
      },
      { priority: 'low' },
    );

    // Normalise the htmlSpan attributes around soft breaks.
    //
    // This logic used to live in InsertWebsparkListStyleCommand#refresh(),
    // where it wrote to model nodes through private properties (`_attrs`,
    // `_children._nodes`) while the model was still dispatching the change
    // event that triggered the refresh. Those writes bypassed the writer, so
    // the differ never recorded them, and mutating nodes mid-dispatch can
    // suppress the reconversion of the surrounding list.
    //
    // A post-fixer is the supported place for this: it runs inside the change
    // block, uses a writer, and its changes are converted normally.
    model.document.registerPostFixer((writer) =>
      this._fixSoftBreakSpans(writer),
    );

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
   * Keeps htmlSpan attributes consistent within changed list blocks.
   *
   * Iterate over the child nodes of each changed list block.
   * If the child node is the first child, remove the 'htmlSpan' attribute.
   * If the child node is a 'softBreak', get the next child node.
   * If the next child node exists, add a new 'htmlSpan' attribute to it.
   * This ensures that each 'softBreak' node has a corresponding 'htmlSpan'
   * attribute.
   *
   * @param {module:engine/model/writer~Writer} writer
   *   The model writer provided by the post-fixer.
   *
   * @return {boolean}
   *   TRUE when the model was changed, which re-runs the post-fixer chain.
   */
  _fixSoftBreakSpans(writer) {
    const model = this.editor.model;
    const differ = model.document.differ;
    const blocks = new Set();

    const collect = (node) => {
      if (node && node.is('element') && node.hasAttribute('listType')) {
        blocks.add(node);
      }
    };

    // Only inspect the list blocks touched by this change, rather than walking
    // the whole document on every keystroke.
    //
    // Each change has to be read from two angles, because the differ describes
    // a change in terms of the element it happened *in*, not the element it
    // happened *to*:
    //
    //  - Something changed inside a list block. Typing in an item reports an
    //    insert whose position sits in that block; styling a word reports an
    //    attribute change whose range sits in that block. The block is the
    //    position's or range's parent.
    //  - Something changed about a list block itself. Turning a paragraph into
    //    a list item sets listType, listIndent and listItemId on the paragraph,
    //    and refreshes it so the <li> is reconverted. Differ#_markAttribute()
    //    records an attribute change against the changed node's *parent*, with
    //    a range that starts immediately before the node, and a refresh is
    //    reported as a remove plus an insert at the node's own position. In all
    //    of those the parent is the root, or a container such as a blockquote,
    //    so the block is the node at the position instead.
    //
    // Reading only the parent is what let the reported bug through: clicking
    // "Bulleted list" on an existing paragraph produced no change whose parent
    // was a list block, so the new item was never normalised and kept the
    // author's leading <span> while its continuation line got none.
    for (const change of differ.getChanges()) {
      if (change.type === 'insert' || change.type === 'remove') {
        collect(change.position.parent);
        collect(change.position.nodeAfter);
      } else if (change.type === 'attribute') {
        collect(change.range.start.parent);
        collect(change.range.start.nodeAfter);
      }
    }

    // Collect first, apply second: setting an attribute on a text node can
    // split or merge text nodes and invalidate an in-flight iteration.
    const toRemove = [];
    const toSet = [];

    for (const block of blocks) {
      const children = Array.from(block.getChildren());

      children.forEach((child, index) => {
        if (index === 0 && child.hasAttribute('htmlSpan')) {
          toRemove.push(child);
        }

        if (child.is('element', 'softBreak')) {
          const next = children[index + 1];

          if (next && !next.hasAttribute('htmlSpan')) {
            toSet.push(next);
          }
        }
      });
    }

    // If the current node is the first node, remove the 'htmlSpan' attribute
    // so that typing at the start of a block does not inherit it.
    const selection = model.document.selection;
    let clearSelectionAttribute = false;

    if (
      selection.hasAttribute('htmlSpan') &&
      selection.anchor &&
      selection.anchor.index === 0
    ) {
      clearSelectionAttribute = true;
    }

    if (!toRemove.length && !toSet.length && !clearSelectionAttribute) {
      return false;
    }

    toRemove.forEach((node) => writer.removeAttribute('htmlSpan', node));
    toSet.forEach((node) => writer.setAttribute('htmlSpan', {}, node));

    if (clearSelectionAttribute) {
      writer.removeSelectionAttribute('htmlSpan');
    }

    return true;
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
