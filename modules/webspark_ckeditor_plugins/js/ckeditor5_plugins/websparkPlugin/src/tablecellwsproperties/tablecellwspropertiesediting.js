/**
 * @license Copyright (c) 2003-2023, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */
/**
 * @module table/tablecellwsproperties/tablecellwspropertiesediting
 */
import { Plugin } from 'ckeditor5/src/core';
import { TableEditing } from '@ckeditor/ckeditor5-table/src/tableediting';
import TableCellWsClassCommand from './tablecellwsclasscommand';

function markerConversion(conversion) {
  // Upcast: Set attributes on tableCell without destroying native table upcasting
  conversion.for('upcast').add((dispatcher) => {
    dispatcher.on(
      'element:td',
      (evt, data, conversionApi) => {
        upcastCellAttributes(data, conversionApi, false);
      },
      { priority: 'low' },
    );

    dispatcher.on(
      'element:th',
      (evt, data, conversionApi) => {
        upcastCellAttributes(data, conversionApi, true);
      },
      { priority: 'low' },
    );
  });

  function upcastCellAttributes(data, conversionApi, isTh) {
    const viewElement = data.viewItem;
    const modelElement = data.modelRange
      ? data.modelRange.start.nodeAfter
      : null;

    if (!modelElement || modelElement.name !== 'tableCell') {
      return;
    }

    const classes = viewElement.hasClass
      ? Array.from(viewElement.getClassNames())
      : [];

    // Also check the class attribute directly
    const classAttr = viewElement.getAttribute('class');
    const allClasses = classAttr ? classAttr.split(/\s+/) : classes;

    // Define the allowed classes for each attribute type
    const allowedCellTypes = ['normal', 'indent'];
    const allowedWidthClasses = ['w-auto', 'w-25', 'w-50', 'w-75', 'w-100'];
    const allowedHorizontalAlignment = [
      'text-start',
      'text-center',
      'text-end',
    ];
    const allowedVerticalAlignment = [
      'align-baseline',
      'align-top',
      'align-middle',
      'align-bottom',
      'align-text-top',
      'align-text-bottom',
    ];

    const { writer } = conversionApi;

    // Only set cellType if it's a custom type like 'normal' or 'indent'
    const foundCellType = allClasses.find((cls) =>
      allowedCellTypes.includes(cls),
    );
    if (foundCellType) {
      writer.setAttribute('cellType', foundCellType, modelElement);
    }

    // Check for horizontal alignment.
    const foundHorizontalAlignment = allClasses.find((cls) =>
      allowedHorizontalAlignment.includes(cls),
    );
    if (foundHorizontalAlignment) {
      writer.setAttribute(
        'alignHorizontal',
        foundHorizontalAlignment,
        modelElement,
      );
    }

    // Check for vertical alignment.
    const foundVerticalAlignment = allClasses.find((cls) =>
      allowedVerticalAlignment.includes(cls),
    );
    if (foundVerticalAlignment) {
      writer.setAttribute(
        'alignVertical',
        foundVerticalAlignment,
        modelElement,
      );
    }

    // Check for width classes - only allow specific classes
    const foundWidthClass = allClasses.find((cls) =>
      allowedWidthClasses.includes(cls),
    );
    if (foundWidthClass) {
      writer.setAttribute('width', foundWidthClass, modelElement);
    }
  }

  // For the editing view (with contenteditable)
  conversion.for('editingDowncast').elementToElement({
    model: {
      name: 'tableCell',
      attributes: ['cellType', 'width', 'alignHorizontal', 'alignVertical'],
    },
    view: (modelElement, { writer }) => {
      // Build class names from attributes
      const classNames = [
        modelElement.getAttribute('width'),
        modelElement.getAttribute('alignHorizontal'),
        modelElement.getAttribute('alignVertical'),
      ]
        .filter(Boolean)
        .filter((value) => value !== 'td' && value !== 'th')
        .join(' ');

      const cellType = modelElement.getAttribute('cellType');

      if (cellType === 'indent' || cellType === 'normal') {
        return writer.createEditableElement(
          'th',
          {
            contenteditable: 'true',
            class:
              `ck-editor__editable ck-editor__nested-editable ${cellType} ${classNames}`.trim(),
            role: 'textbox',
          },
          [],
        );
      }

      // Let native editingDowncast create the regular th/td element. The
      // width / alignHorizontal / alignVertical classes are added onto that
      // native element by the attributeToAttribute converters registered
      // below, so they render in the editing view for every cell -- not only
      // for the indent/normal cases handled above.
      return null;
    },
    converterPriority: 'low',
  });

  // Reflect the custom class attributes in the EDITING view by adding the
  // class onto whatever cell element the native table editing downcast
  // produces. Using attributeToAttribute (rather than elementToElement) means
  // we do not fight CKEditor's native cell element creation -- we only
  // decorate it. Without these, cells that carry only width/alignment (i.e.
  // not an indent/normal cellType) upcast into the model correctly and
  // downcast to the data view on save, but never show their classes on the
  // editing canvas. mapValue is identity because the model attribute value is
  // already the exact Bootstrap class string (e.g. 'w-50', 'text-center').
  ['width', 'alignHorizontal', 'alignVertical'].forEach((attributeName) => {
    conversion.for('editingDowncast').attributeToAttribute({
      model: {
        name: 'tableCell',
        key: attributeName,
      },
      view: (attributeValue) => {
        if (
          !attributeValue ||
          attributeValue === 'td' ||
          attributeValue === 'th'
        ) {
          return null;
        }
        return {
          key: 'class',
          value: [attributeValue],
        };
      },
      converterPriority: 'low',
    });
  });

  // For the data view (without contenteditable)
  conversion.for('dataDowncast').elementToElement({
    model: {
      name: 'tableCell',
      attributes: ['cellType', 'width', 'alignHorizontal', 'alignVertical'],
    },
    view: (modelElement, { writer }) => {
      // Build class names array - only include attributes that are actually set
      const classNames = [
        modelElement.getAttribute('width'),
        modelElement.getAttribute('alignHorizontal'),
        modelElement.getAttribute('alignVertical'),
      ]
        .filter(Boolean)
        .filter((value) => value !== 'td' && value !== 'th')
        .join(' ');

      const attributes = {};
      // Only add class attribute if there are actual classes to add
      if (classNames.trim()) {
        attributes.class = classNames.trim();
      }

      const cellType = modelElement.getAttribute('cellType');

      // Check if cell belongs to a header row/column.
      const isHeadingCell = () => {
        const row = modelElement.parent;
        const table = row ? row.parent : null;
        if (!table || table.name !== 'table') {
          return false;
        }

        const rowIndex = table.getChildIndex(row);
        const headingRows = table.getAttribute('headingRows') || 0;
        if (rowIndex < headingRows) {
          return true;
        }

        const cellIndex = row.getChildIndex(modelElement);
        const headingColumns = table.getAttribute('headingColumns') || 0;
        if (cellIndex < headingColumns) {
          return true;
        }

        return false;
      };

      // Determine tag name. Custom cellType wins, otherwise check headingRows/Columns.
      let isTh = false;
      if (cellType === 'th' || cellType === 'indent' || cellType === 'normal') {
        isTh = true;
      } else if (cellType === 'td') {
        isTh = false;
      } else {
        isTh = isHeadingCell();
      }

      if (isTh) {
        if (cellType === 'indent' || cellType === 'normal') {
          attributes.class = `${cellType} ${attributes.class || ''}`.trim();
        }
        return writer.createContainerElement('th', attributes);
      }
      return writer.createContainerElement('td', attributes);
    },
    converterPriority: 'highest', // Use highest priority to override other converters
  });

  // Clean up GHS (General HTML Support) attributes when custom attributes are
  // set. This prevents class conflicts between GHS and custom attributes
  conversion.for('upcast').add((dispatcher) => {
    dispatcher.on(
      'element:td',
      (evt, data, conversionApi) => {
        const modelElement = data.modelRange
          ? data.modelRange.start.nodeAfter
          : null;
        if (!modelElement || modelElement.name !== 'tableCell') {
          return;
        }

        // If we have custom attributes, remove class from GHS attributes
        if (
          modelElement.getAttribute('width') ||
          modelElement.getAttribute('alignHorizontal') ||
          modelElement.getAttribute('alignVertical')
        ) {
          conversionApi.writer.removeAttribute(
            'htmlTdAttributes',
            modelElement,
          );
        }
      },
      { priority: 'low' },
    );
  });

  conversion.for('upcast').add((dispatcher) => {
    dispatcher.on(
      'element:th',
      (evt, data, conversionApi) => {
        const modelElement = data.modelRange
          ? data.modelRange.start.nodeAfter
          : null;
        if (!modelElement || modelElement.name !== 'tableCell') {
          return;
        }

        // If we have custom attributes, remove class from GHS attributes
        if (
          modelElement.getAttribute('width') ||
          modelElement.getAttribute('alignHorizontal') ||
          modelElement.getAttribute('alignVertical') ||
          modelElement.getAttribute('cellType') === 'normal' ||
          modelElement.getAttribute('cellType') === 'indent'
        ) {
          conversionApi.writer.removeAttribute(
            'htmlThAttributes',
            modelElement,
          );
        }
      },
      { priority: 'low' },
    );
  });
}

export default class TableCellWsPropertiesEditing extends Plugin {
  /**
   * @inheritDoc
   */
  static get pluginName() {
    return 'TableCellWsPropertiesEditing';
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
    model.schema.extend('tableCell', {
      allowAttributes: [
        'cellType',
        'width',
        'alignHorizontal',
        'alignVertical',
      ],
    });

    editor.commands.add(
      'tableCellWsClass',
      new TableCellWsClassCommand(editor),
    );
    markerConversion(conversion);
  }
}
