/**
 * @license Copyright (c) 2003-2023, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */
/**
 * @module table/tablecellwsproperties/ui/tablecellwspropertiesview
 */
import {
  FocusCycler,
  submitHandler,
  View,
  ViewCollection,
} from "ckeditor5/src/ui";
import { KeystrokeHandler, FocusTracker } from "ckeditor5/src/utils";
import { IconCheck, IconCancel } from "ckeditor5/src/icons";
import "@ckeditor/ckeditor5-table/theme/tableform.css";
import "@ckeditor/ckeditor5-table/theme/tablecellproperties.css";
import {
  createButton,
  createContainer,
  createRow,
  createSelect,
} from "../../utils/utils";

/**
 * The class representing a table cell properties form, allowing users to customize
 * certain style aspects of a table cell, for instance, border, padding, text alignment, etc..
 */
export default class TableCellWsPropertiesView extends View {
  constructor(locale, options) {
    super(locale);

    const { t } = locale;

    this.focusTracker = new FocusTracker();
    this.keystrokes = new KeystrokeHandler();

    this.classSelect = createSelect(
      t("Cell type"),
      this._getPropertiesOptions(t),
      locale,
    );
    this.classWidthSelect = createSelect(
      t("Width"),
      this._getPropertiesWidthOptions(t),
      locale,
    );
    this.classAlignHorizontalSelect = createSelect(
      t("Align horizontal"),
      this._getPropertiesAlignHorizontalOptions(t),
      locale,
    );
    this.classAlignVerticalSelect = createSelect(
      t("Align vertical"),
      this._getPropertiesAlignVerticalOptions(t),
      locale,
    );

    this.saveButtonView = createButton(
      t("Save"),
      IconCheck,
      "ck-button-save",
      locale,
    );
    this.saveButtonView.type = "submit";

    this.cancelButtonView = createButton(
      t("Cancel"),
      IconCancel,
      "ck-button-cancel",
      locale,
    );

    this.cancelButtonView.delegate("execute").to(this, "cancel");

    this._focusables = new ViewCollection();

    this._focusCycler = new FocusCycler({
      focusables: this._focusables,
      focusTracker: this.focusTracker,
      keystrokeHandler: this.keystrokes,
      actions: {
        focusPrevious: "shift + tab",
        focusNext: "tab",
      },
    });

    this.setTemplate({
      tag: "form",
      attributes: {
        class: ["ck", "ck-webspark-form"],
        tabindex: "-1",
      },
      children: [
        createRow(this.classSelect),
        createRow(this.classWidthSelect),
        createRow(this.classAlignHorizontalSelect),
        createRow(this.classAlignVerticalSelect),
        createContainer(
          [this.saveButtonView, this.cancelButtonView],
          ["ck-webspark-form-buttons"],
        ),
      ],
    });
  }

  _getPropertiesOptions(t) {
    return [
      {
        value: "td",
        title: t("Data"),
      },
      {
        value: `th`,
        title: t("Header"),
      },
      {
        value: `indent`,
        title: t("Padded header"),
      },
      {
        value: `normal`,
        title: t("Normal text header"),
      },
    ];
  }

  // Use Bootstrap classes for width
  _getPropertiesWidthOptions(t) {
    return [
      {
        value: " ", // If empty, class "Default" gets applied. This is stripped.
        title: t("Default"),
      },
      {
        value: `w-auto`,
        title: t("Auto"),
      },
      {
        value: `w-25`,
        title: t("25%"),
      },
      {
        value: `w-50`,
        title: t("50%"),
      },
      {
        value: `w-75`,
        title: t("75%"),
      },
      {
        value: `w-100`,
        title: t("100%"),
      },
    ];
  }

  // Use Bootstrap classes for horizontal alignment
  _getPropertiesAlignHorizontalOptions(t) {
    return [
      {
        value: " ", // If empty, class "Default" gets applied. This is stripped.
        title: t("Default"),
      },
      {
        value: `text-start`,
        title: t("Left"),
      },
      {
        value: `text-center`,
        title: t("Center"),
      },
      {
        value: `text-end`,
        title: t("Right"),
      },
    ];
  }

  // Use Bootstrap classes for vertical alignment
  _getPropertiesAlignVerticalOptions(t) {
    return [
      {
        value: " ", // If empty, class "Default" gets applied. This is stripped.
        title: t("Default"),
      },
      {
        value: `align-baseline`,
        title: t("Baseline"),
      },
      {
        value: `align-top`,
        title: t("Top"),
      },
      {
        value: "align-middle",
        title: t("Middle"),
      },
      {
        value: `align-bottom`,
        title: t("Bottom"),
      },
      {
        value: `align-text-bottom`,
        title: t("Text bottom"),
      },
      {
        value: `align-text-top`,
        title: t("Text top"),
      },
    ];
  }

  render() {
    super.render();

    submitHandler({
      view: this,
    });

    // TODO: Check why focus isn't working for a custom view
    const childViews = [
      this.classSelect.children[1],
      this.classWidthSelect.children[1],
      this.classAlignHorizontalSelect.children[1],
      this.classAlignVerticalSelect.children[1],

      this.saveButtonView,
      this.cancelButtonView,
    ];

    childViews.forEach((v) => {
      // Register the view as focusable.
      this._focusables.add(v);

      // Register the view in the focus tracker.
      this.focusTracker.add(v.element);
    });

    // Start listening for the keystrokes coming from #element.
    this.keystrokes.listenTo(this.element);

    const stopPropagation = (data) => data.stopPropagation();

    // Since the form is in the dropdown panel which is a child of the toolbar, the toolbar's
    // keystroke handler would take over the key management in the URL input. We need to prevent
    // this ASAP. Otherwise, the basic caret movement using the arrow keys will be impossible.
    this.keystrokes.set("arrowright", stopPropagation);
    this.keystrokes.set("arrowleft", stopPropagation);
    this.keystrokes.set("arrowup", stopPropagation);
    this.keystrokes.set("arrowdown", stopPropagation);
  }

  destroy() {
    super.destroy();

    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }

  focus() {
    this._focusCycler.focusFirst();
  }

  get classselect() {
    return this.classSelect.children[1].value;
  }

  set classselect(classselect) {
    this.classSelect.children[1].value = classselect;
  }

  get classwidthselect() {
    return this.classWidthSelect.children[1].value;
  }

  set classwidthselect(classwidthselect) {
    this.classWidthSelect.children[1].value = classwidthselect;
  }

  get classalignhorizontalselect() {
    return this.classAlignHorizontalSelect.children[1].value;
  }

  set classalignhorizontalselect(classalignhorizontalselect) {
    this.classAlignHorizontalSelect.children[1].value =
      classalignhorizontalselect;
  }

  get classalignverticalselect() {
    return this.classAlignVerticalSelect.children[1].value;
  }

  set classalignverticalselect(classalignverticalselect) {
    this.classAlignVerticalSelect.children[1].value = classalignverticalselect;
  }

  setValues(values) {
    this.classselect = values?.classselect;
    this.classwidthselect = values?.classwidthselect;
    this.classalignhorizontalselect = values?.classalignhorizontalselect;
    this.classalignverticalselect = values?.classalignverticalselect;
  }

  isValid() {
    return true;
  }
}
