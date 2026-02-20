/**
 * @license Copyright (c) 2003-2023, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */
import TableCellPropertyCommand from "@ckeditor/ckeditor5-table/src/tablecellproperties/commands/tablecellpropertycommand";
import { first } from "ckeditor5/src/utils";

/**
 * The table cell command.
 *
 * The command is registered by the {@link module:table/tablecellproperties/tablecellpropertiesediting~TableCellPropertiesEditing} as
 * the `'tableCellWsClass'` editor command.
 *
 */
export default class TableCellWsClassCommand extends TableCellPropertyCommand {
  /**
   * Creates a new `TableCellWsClassCommand` instance.
   *
   * @param editor An editor in which this command will be used.
   * @param defaultValue The default value of the attribute.
   */

  /**
   * Refreshes the editor.
   *
   * @param {type} None - This function does not accept any parameters.
   * @return {type} None - This function does not return any value.
   */
  refresh() {
    let cell = first(this.editor.model.document.selection.getSelectedBlocks());
    this.isEnabled = cell;
    if (cell && cell.parent) {
      cell = cell.parent;
      this.value = Object.fromEntries(cell.getAttributes());
    }
  }

  /**
   * Executes the function.
   *
   * @param {Object} options - The options object containing attribute values.
   * @param {string} options.cellType - The cell type value.
   * @param {string} options.width - The width class value.
   * @param {string} options.alignHorizontal - The horizontal alignment class value.
   * @param {string} options.alignVertical - The vertical alignment class value.
   */
  execute(options = {}) {
    const { model } = this.editor;
    model.change((writer) => {
      let cell = first(
        this.editor.model.document.selection.getSelectedBlocks(),
      );
      if (cell && cell.parent) {
        cell = cell.parent;

        // Only set attributes that are provided
        if (options.cellType !== undefined) {
          writer.setAttribute("cellType", options.cellType, cell);
        }
        if (options.width !== undefined) {
          if (options.width) {
            writer.setAttribute("width", options.width, cell);
          } else {
            writer.removeAttribute("width", cell);
          }
        }
        if (options.alignHorizontal !== undefined) {
          if (options.alignHorizontal) {
            writer.setAttribute(
              "alignHorizontal",
              options.alignHorizontal,
              cell,
            );
          } else {
            writer.removeAttribute("alignHorizontal", cell);
          }
        }
        if (options.alignVertical !== undefined) {
          if (options.alignVertical) {
            writer.setAttribute("alignVertical", options.alignVertical, cell);
          } else {
            writer.removeAttribute("alignVertical", cell);
          }
        }

        // Clear GHS attributes to prevent conflicts with custom attributes
        // Determine which GHS attribute to clear based on cellType
        const cellType = options.cellType || cell.getAttribute("cellType");
        if (cellType === "td") {
          writer.removeAttribute("htmlTdAttributes", cell);
        } else {
          writer.removeAttribute("htmlThAttributes", cell);
        }
      }
    });
  }
}
