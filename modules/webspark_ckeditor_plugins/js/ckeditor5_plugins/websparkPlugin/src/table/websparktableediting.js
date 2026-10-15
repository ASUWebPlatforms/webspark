import {
  PlainTableOutput,
  Table,
  TableCaption,
  TableCellProperties,
  TableProperties,
  TableToolbar,
  TableUtils,
  TableSelection,
  TableClipboard,
  TableMouse,
  TableKeyboard,
 
} from "@ckeditor/ckeditor5-table";
import TableCellWsProperties from "../tablecellwsproperties/tablecellwsproperties";
import { Plugin } from "ckeditor5/src/core";
import { Widget, toWidget } from "ckeditor5/src/widget";
import InsertWebsparkTableCommand from "./inserttablecommand";

export default class WebsparkTableEditing extends Plugin {
  static get requires() {
    return [
      Table,
      TableUtils,
      TableToolbar,
      PlainTableOutput,
      TableCaption,
      // TODO: Revisit the issue with the Color constructor not being a function after the CKEditor5 update for Drupal.
      // TableProperties,
      // TableCellProperties,
      TableSelection,
      TableClipboard,
      TableMouse,
      TableKeyboard,
      Widget,
      TableCellWsProperties,
    ];
  }

  init() {
    this._defineSchema();
    this._defineConverters();
    this._fixTypeAroundForWrappedTable();
    this.editor.commands.add(
      "insertWebsparkTable",
      new InsertWebsparkTableCommand(this.editor)
    );
  }

  /**
   * Fixes the CKEditor "type-around" arrows (Insert paragraph before/after
   * block) for the Webspark table.
   *
   * The Webspark table nests the native `table` widget inside a `websparkTable`
   * wrapper (isObject, allowChildren: ["table"]). The core WidgetTypeAround
   * plugin attaches its arrow buttons to the INNER `table` widget and inserts
   * the paragraph at a position adjacent to that inner table -- i.e. INSIDE the
   * wrapper. Because the wrapper only allows a `table` child, `insertParagraph`
   * at that position is schema-invalid and the command is silently disabled, so
   * the arrows do nothing.
   *
   * We do NOT allow paragraphs inside the wrapper (that would emit a stray
   * `<p>` inside the `.uds-table` div, which is not valid for the UDS design
   * system). Instead we intercept the shared `insertParagraph` command -- the
   * single choke point used by all four type-around triggers (button click,
   * Enter, typing, and the fake-caret) -- and, when its target position lands
   * inside a `websparkTable` next to the wrapped `table`, we remap the position
   * to be a sibling of the WRAPPER in the outer ($root/$block) context. The
   * paragraph then lands outside `.uds-table`, producing clean markup:
   * `<div class="uds-table">...</div><p></p>`.
   *
   * FRAGILITY NOTE: this couples to CKEditor internals that have no public
   * opt-out API for per-widget type-around (see
   * https://github.com/ckeditor/ckeditor5/issues/7583). It relies on:
   *   1. `WidgetTypeAround._insertParagraph()` executing the public
   *      `insertParagraph` command with a `position` option (stable since the
   *      feature's introduction), and
   *   2. the model shape `websparkTable > table`.
   * If a future CKEditor upgrade changes how type-around performs its insertion
   * (e.g. stops routing through the `insertParagraph` command, or changes the
   * `position` option), the arrows will regress to no-ops (not a crash) and
   * this method must be revisited. A model-shape change to the wrapper likewise
   * requires updating the guard below. Pinned to @ckeditor/ckeditor5-table
   * ~47.6 at time of writing.
   */
  _fixTypeAroundForWrappedTable() {
    const editor = this.editor;
    const insertParagraph = editor.commands.get("insertParagraph");

    if (!insertParagraph) {
      return;
    }

    // Run before the command executes so we can rewrite the target position.
    insertParagraph.on(
      "execute",
      (evt, args) => {
        const options = args[0];

        if (!options || !options.position) {
          return;
        }

        const position = options.position;
        const model = editor.model;

        // The type-around button is attached to the inner `table` widget, so
        // the requested insertion position sits inside a `websparkTable`
        // wrapper, immediately before or after that `table` child. Detect
        // exactly that case; leave every other insertParagraph call untouched.
        const parent = position.parent;

        if (!parent || parent.name !== "websparkTable") {
          return;
        }

        // Determine whether the caret is before or after the wrapped table so
        // we can preserve the user's intended direction on the wrapper.
        const nodeAfter = position.nodeAfter;
        const nodeBefore = position.nodeBefore;
        const isBeforeTable =
          nodeAfter && nodeAfter.is("element", "table");
        const isAfterTable =
          nodeBefore && nodeBefore.is("element", "table");

        if (!isBeforeTable && !isAfterTable) {
          return;
        }

        // Remap: insert the paragraph as a sibling of the wrapper in the outer
        // context, not inside it.
        const remapped = isBeforeTable
          ? model.createPositionBefore(parent)
          : model.createPositionAfter(parent);

        // Only remap when the outer context actually allows a paragraph there;
        // otherwise leave the original (the command will disable itself as
        // before, which is no worse than today's behaviour).
        if (!model.schema.checkChild(remapped, "paragraph")) {
          return;
        }

        // NOTE: The decorated `insertParagraph` command reads its options from
        // the event `args` array. Mutating `options.position` in place is NOT
        // picked up by the underlying execute -- the argument element must be
        // REASSIGNED. Replace args[0] with a new options object carrying the
        // remapped position (preserving any other option such as `attributes`).
        args[0] = Object.assign({}, options, { position: remapped });
      },
      { priority: "high" }
    );
  }

  _defineSchema() {
    const schema = this.editor.model.schema;

    schema.register("websparkTable", {
      isObject: true,
      allowWhere: "$block",
      allowChildren: ["table"],
      allowAttributes: ["type"],
    });
  }

  _defineConverters() {
    const { conversion } = this.editor;

    conversion.for("upcast").elementToElement({
      view: {
        name: "div",
        classes: ["uds-table"],
        attribute: { type: true },
      },
      model: (viewElement, { writer }) => {
        const classes = viewElement.getAttribute("class");
        const type = classes.includes("-fixed") ? "fixed" : "default";

        return writer.createElement("websparkTable", {
          type,
        });
      },
    });

    conversion.for("dataDowncast").elementToElement({
      model: "websparkTable",
      view: (modelElement, { writer }) => {
        let _class = "uds-table";

        if (modelElement.getAttribute("type") === "fixed") {
          _class += ` uds-table-fixed`;
        }

        return writer.createContainerElement("div", {
          class: _class,
        });
      },
    });

    conversion.for("editingDowncast").elementToElement({
      model: "websparkTable",
      view: (modelElement, { writer }) => {
        const wrapper = writer.createContainerElement("div");

        return toWidget(wrapper, writer, { label: "Webspark Table" });
      },
    });
  }
}
