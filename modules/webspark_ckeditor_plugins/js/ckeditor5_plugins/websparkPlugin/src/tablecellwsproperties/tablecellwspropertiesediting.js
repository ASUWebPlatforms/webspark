/**
 * @license Copyright (c) 2003-2023, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */
/**
 * @module table/tablecellwsproperties/tablecellwspropertiesediting
 */
import { Plugin } from "ckeditor5/src/core";
import TableEditing from "@ckeditor/ckeditor5-table/src/tableediting";
import TableCellWsClassCommand from "./tablecellwsclasscommand";

function markerConversion(conversion) {
  conversion.for("upcast").elementToElement({
    view: {
      name: /^(td|th)$/,
    },
    model: (viewElement, { writer }) => {
      const classes = viewElement.hasClass
        ? Array.from(viewElement.getClassNames())
        : [];

      // Also check the class attribute directly
      const classAttr = viewElement.getAttribute("class");
      const allClasses = classAttr ? classAttr.split(/\s+/) : classes;

      // Define the allowed classes for each attribute type
      const allowedCellTypes = ["normal", "indent"];
      const allowedWidthClasses = ["w-auto", "w-25", "w-50", "w-75", "w-100"];
      const allowedHorizontalAlignment = [
        "text-start",
        "text-center",
        "text-end",
      ];
      const allowedVerticalAlignment = [
        "align-baseline",
        "align-top",
        "align-middle",
        "align-bottom",
        "align-text-top",
        "align-text-bottom",
      ];

      // Determine cellType - only allow specific values
      let cellType = viewElement.name; // default to td or th
      const foundCellType = allClasses.find((cls) =>
        allowedCellTypes.includes(cls),
      );
      if (foundCellType) {
        cellType = foundCellType;
      }

      const attributes = { cellType };

      // Check for horizontal alignment - only allow specific classes
      const foundHorizontalAlignment = allClasses.find((cls) =>
        allowedHorizontalAlignment.includes(cls),
      );
      if (foundHorizontalAlignment) {
        attributes.alignHorizontal = foundHorizontalAlignment;
      }

      // Check for vertical alignment - only allow specific classes
      const foundVerticalAlignment = allClasses.find((cls) =>
        allowedVerticalAlignment.includes(cls),
      );
      if (foundVerticalAlignment) {
        attributes.alignVertical = foundVerticalAlignment;
      }

      // Check for width classes - only allow specific classes
      const foundWidthClass = allClasses.find((cls) =>
        allowedWidthClasses.includes(cls),
      );
      if (foundWidthClass) {
        attributes.width = foundWidthClass;
      }

      return writer.createElement("tableCell", attributes);
    },
    converterPriority: "highest",
  });

  // For the editing view (with contenteditable)
  conversion.for("editingDowncast").elementToElement({
    model: {
      name: "tableCell",
      attributes: ["cellType", "width", "alignHorizontal", "alignVertical"],
    },
    view: (modelElement, { writer }) => {
      // Build class names from attributes
      const classNames = [
        modelElement.getAttribute("width"),
        modelElement.getAttribute("alignHorizontal"),
        modelElement.getAttribute("alignVertical"),
      ]
        .filter(Boolean)
        .filter((value) => value !== "td" && value !== "th")
        .join(" ");

      switch (modelElement.getAttribute("cellType")) {
        case "th":
          return writer.createEditableElement(
            "th",
            {
              contenteditable: "true",
              class:
                `ck-editor__editable ck-editor__nested-editable ${classNames}`.trim(),
              role: "textbox",
            },
            [],
          );
        case "td":
          return writer.createEditableElement(
            "td",
            {
              contenteditable: "true",
              class:
                `ck-editor__editable ck-editor__nested-editable ${classNames}`.trim(),
              role: "textbox",
            },
            [],
          );
        case "indent":
        case "normal":
          return writer.createEditableElement(
            "th",
            {
              contenteditable: "true",
              class:
                `ck-editor__editable ck-editor__nested-editable ${modelElement.getAttribute("cellType")} ${classNames}`.trim(),
              role: "textbox",
            },
            [],
          );
        default:
        // do nothing
      }
    },
    converterPriority: "highest", // Ensure this converter has a high priority
  });

  // For the data view (without contenteditable)
  conversion.for("dataDowncast").elementToElement({
    model: {
      name: "tableCell",
      attributes: ["cellType", "width", "alignHorizontal", "alignVertical"],
    },
    view: (modelElement, { writer }) => {
      // Build class names array - only include attributes that are actually set
      const classNames = [
        modelElement.getAttribute("width"),
        modelElement.getAttribute("alignHorizontal"),
        modelElement.getAttribute("alignVertical"),
      ]
        .filter(Boolean)
        .filter((value) => value !== "td" && value !== "th")
        .join(" ");

      const attributes = {};
      // Only add class attribute if there are actual classes to add
      if (classNames.trim()) {
        attributes.class = classNames.trim();
      }

      const cellType = modelElement.getAttribute("cellType");

      switch (cellType) {
        case "th":
          return writer.createContainerElement("th", attributes);
        case "td":
          return writer.createContainerElement("td", attributes);
        case "indent":
        case "normal":
          return writer.createContainerElement("th", {
            class: `${cellType} ${attributes.class || ""}`.trim(),
          });
        default:
          // Fallback to td with no attributes
          return writer.createContainerElement("td", attributes);
      }
    },
    converterPriority: "highest", // Use highest priority to override other converters
  });

  // Clean up GHS (General HTML Support) attributes when custom attributes are
  // set. This prevents class conflicts between GHS and custom attributes
  conversion.for("upcast").add((dispatcher) => {
    dispatcher.on(
      "element:td",
      (evt, data, conversionApi) => {
        const modelElement = data.modelRange.start.nodeAfter;
        if (!modelElement || modelElement.name !== "tableCell") {
          return;
        }

        // If we have custom attributes, remove class from GHS attributes
        if (
          modelElement.getAttribute("width") ||
          modelElement.getAttribute("alignHorizontal") ||
          modelElement.getAttribute("alignVertical")
        ) {
          conversionApi.writer.removeAttribute(
            "htmlTdAttributes",
            modelElement,
          );
        }
      },
      { priority: "low" },
    );
  });

  conversion.for("upcast").add((dispatcher) => {
    dispatcher.on(
      "element:th",
      (evt, data, conversionApi) => {
        const modelElement = data.modelRange.start.nodeAfter;
        if (!modelElement || modelElement.name !== "tableCell") {
          return;
        }

        // If we have custom attributes, remove class from GHS attributes
        if (
          modelElement.getAttribute("width") ||
          modelElement.getAttribute("alignHorizontal") ||
          modelElement.getAttribute("alignVertical") ||
          modelElement.getAttribute("cellType") === "normal" ||
          modelElement.getAttribute("cellType") === "indent"
        ) {
          conversionApi.writer.removeAttribute(
            "htmlThAttributes",
            modelElement,
          );
        }
      },
      { priority: "low" },
    );
  });
}

export default class TableCellWsPropertiesEditing extends Plugin {
  /**
   * @inheritDoc
   */
  static get pluginName() {
    return "TableCellWsPropertiesEditing";
  }

  /**
   * @inheritDoc
   */
  static get requires() {
    return [TableEditing];
  }

  /**
   * @inheritDoc
   */
  init() {
    const { editor } = this;
    const { conversion, model } = editor;

    // Register schema for table cell custom attributes
    model.schema.extend("tableCell", {
      allowAttributes: [
        "cellType",
        "width",
        "alignHorizontal",
        "alignVertical",
      ],
    });

    editor.commands.add(
      "tableCellWsClass",
      new TableCellWsClassCommand(editor),
    );
    markerConversion(conversion);
  }
}
