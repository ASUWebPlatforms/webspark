# Webspark ckeditor plugins module

## Description

Webspark ckeditor plugins module comes with a number of plugins for the ckeditor that
add or alter the functionalities of the rich text editor when creating new
content.

TODO: Currently the Webspark CKEditor Plugins module supports CKEditor 4 and 5 versions
of plugins. When we move to Drupal 10, the CKEditor 4 plugins can be removed, and this
README can be updated to be version 5 specific. The document linked in the section
below will be helpful in distinguishing between the 4 versions of plugins when it is
time to clean up.

## CKEditor 5 Plugins

Architecture of CKEditor 4 and 5 plugins are described in the
https://docs.google.com/document/d/1gRWqWQ4xy_V_GUUIX2zs903IG7Ku0pP6A4YAf17BXkU/edit
document from the WS2-1452 effort.

The purpose of each of our version 5 plugins is identical to the verion 4 instances,
though the details below may vary some.

## CKEditor 4 Plugins

### 1. WebsparkAdvancedImage

#### 1.1 Description

This alters the existing CKEditor image2 widget plugin, which is already altered by the Drupal Image plugin.

#### 1.2. Functionalities

- Allow for the image margins to be set
- Allow for rounded-corners to be applied to the image

#### 1.3. How to use

When the user inserts a new image in the CKEditor, there are several options available for the margins in the form of drop-down lists for setting margins on the image.
In the Extra section we have an option (checkbox) to make the image round

### 2. WebsparkBlockQuote

#### 2.1 . Description

Adds an icon to the ckeditor that creates a webspark block quote.

#### 2.2. Functionalities

- Webspark block quote adds a template for a quote. The template contains a div with uds-blockquote class, font awesome specific quotation icons and citation specific tags.
- Add the content, name and description for the quote.
- Edit the content, name and desription for an existing qoute.
- #### 2.3. How to use
  The icon has to added in the toolbar. Check this in the /admin/config/content/formats
  When clicking on the icon, the quote popup will prompt. By summiting the popup, the structure will be generated in the text editor. You can edit and existing one by selecting the quote in text editor and click on the icon.

### 3. WebsparkButton

#### 3.1 . Description

Adds an icon to the ckeditor that creates a webspark button.

#### 3.2. Functionalities

- The webspark button is a span tag inside a \<a\> tag with a class "btn".
- You can choose the style of the button
- It also has the context menu for changing the styles.

#### 3.3. How to use

The icon has to added in the toolbar. Check this in the /admin/config/content/formats
Add the button from the toolbar, fill the fields and save.
Right click to change the options.

### 4. WebsparkDivider

#### 4.1 . Description

Adds an icon to the ckeditor that creates a webspark divider.

#### 4.2. Functionality

Adds a hr tag with a class "copy-divider".

#### 4.3. How to use

The icon has to added in the toolbar. Check this in the /admin/config/content/formats
Click on the button to add the divider.

### 5. WebsparkHighlightedHeading

#### 5.1 . Description

Adds an icon to the CKEditor that inserts a Highlighted Heading.

#### 5.2 . Functionalities

- Allows headings (H1, H2, H3, H4) to be created.
- Allows highlight to be applied to the headings (Gold, Grey 7, White)

#### 5.3 . How to use

A highlighted heading can be inserted using the icon in the toolbar. When clicked, the text, color and heading type options will be available to be set. In order to edit an existing one, one needs to double-click the text inside the editor.

### 6. WebsparkLead

#### 6.1 . Description

Adds an icon to the CKEditor that adds a Lead element.

#### 6.2 . Functionalities

- Adds a paragraph with the class "lead".

#### 6.3 . How to use

A lead element can be added by first selecting the text inside the editor and then press the lead icon in the toolbar.

### 7. WebsparkListStyle

#### 7.1 Description

This plugin alters the functionality of the ordered and unordered lists.

#### 7.2 Functionalities

- Adds the required classes for the ASU
- Adds a context menu to be able to change the style
- On SHIFT+ENTER a "list item description" in the form of "\<span\>" is generated

#### 7.2 How to use

Once the module is installed and the unordered list or ordered list icons are
on the ckeditor toolbar, the plugin modifications appear when you click on these
icons or if you right click on an existing list inside the ckeditor.

#### 7.3 How to create icon list

To create an icon list

- Create an unordered list.
- Right click on the list and select one of the Icon List options
- Click on the begining of the list item
- Click on the icon named "Font Awesome" (the flag shaped) and choose the icon

### 8. WebsparkMediaAlter

#### 8.1 Description

This plugin adds extra styles to the remote video media by executing a JS script.

#### 8.2 Functionalities

Applies styles to the remote video by executing a script on "saveSnapshot" event.

### 9. WebsparkTable

#### 9.1 Description

The webspark table plugin replaces the default table that comes with the
ckeditor to match webspark needs.

#### 9.2 Functionalities

- Adds the required classes on the table and inside the table for the ASU
- Adds the option to change those classes on the context menu
- **Requires a descriptive `<caption>`** when inserting a table. Insertion is
  blocked until a non-empty caption is provided; the validation trims the value
  so whitespace-only captions (e.g. `&nbsp;` or a single space) are also
  rejected. See the _Accessible tables_ section below.

#### 9.2 How to use

The new icon needs to be added in the specific format :
/admin/config/content/formats
If the icon is added, you can click on it in the ckeditor. Another way to
interact with the plugin is through the context menu, by right-clicking on
an existing table inside the text editor.

#### 9.3 Difficulties

There was no way to alter the default table, so the current plugin copies a lot
from the ckeditor table code.

## Additional info

These plugins are built on the ckeditor version 4.

## Requirements

Drupal 8.x. or Drupal 9.x

## Accessible tables

Accessibility remediation for basic and fixed Bootstrap tables, aligned with
WCAG 2.2 Level A and AA. The work spans two places: the **table caption
requirement** lives in this module (the WebsparkTable plugin), and the **fixed
(horizontally scrollable) table keyboard/scroll behavior** lives in the
Renovation theme.

### What is enforced by this module (WebsparkTable plugin)

- **Caption is required.** When inserting a table, the form validator rejects an
  empty caption and an editor cannot save without one
  (`src/table/websparktableui.js`). The check uses `caption.trim()` so a
  whitespace-only value (`" "`, `&nbsp;`) is treated as empty — an empty caption
  gives assistive technology nothing to announce.
- **Validation errors target the correct field.** Row, column, and caption
  validation messages are routed to their own inputs in the form
  (`src/table/websparktableview.js`).

> After editing files under `js/ckeditor5_plugins/`, rebuild the bundle with
> `npm run build` (from the module root) so `js/build/websparkPlugin.js` is
> regenerated, then clear the Drupal cache.

### What lives in the Renovation theme (fixed tables)

The fixed-table scroll controls are generated and styled in
`profiles/contrib/webspark/themes/renovation/src/components/tables/`
(`tables.js` and `_tables.scss`). For reference, that work provides:

- Scroll controls reachable by keyboard — hidden with `opacity` (revealed on
  hover **or** `:focus-within`), never `display: none`, so the buttons stay in
  the tab order (WCAG 2.1.1).
- `aria-controls` on each scroll button pointing to the scrollable region, and
  `aria-hidden` on the decorative icons.
- Native `disabled` state on the Previous/Next buttons at the scroll boundaries,
  kept in sync with scroll position.
- Support for multiple fixed tables per page (idempotent wrapping).

### Editor guidance

When building tables with the Webspark table tool:

- **Always provide a descriptive caption** that states the table's purpose and
  context (e.g. "University Enrollment by Campus, Fall 2020–Fall 2024").
- **Keep row-header cells concise.** A `<th scope="row">` should contain only the
  short row label. Move instructional text, links, or demo content into a normal
  cell or into body copy outside the table.
- **Do not rely on visual indentation alone to convey grouping.** The `indent`
  styling is decorative; if rows form a hierarchy, also express it in the label
  text (e.g. "Tempe campus") or with an explicit group heading so screen-reader
  users get the same information.

> Note: the caption requirement applies to **newly inserted** tables only.
> Tables authored before this change may still have an empty or missing caption
> and need to be remediated in content.

### Testing checklist

- Keyboard-only navigation: Tab reaches the fixed-table scroll buttons; they
  scroll the table and expose `disabled` at the boundaries.
- Browser zoom at 200% and mobile widths: content is not clipped and focus stays
  visible.
- Screen reader (NVDA / VoiceOver / JAWS): caption, column headers
  (`th scope="col"`), and row headers (`th scope="row"`) are announced; scroll
  controls are announced meaningfully.
- Contrast meets WCAG AA (4.5:1 text, 3:1 large text); verify a visible focus
  indicator.

### Applicable WCAG criteria

- 1.3.1 Information and Relationships (A)
- 1.3.2 Meaningful Sequence (A)
- 2.1.1 Keyboard (A)
- 2.4.3 Focus Order (A)
- 1.4.3 Contrast (Minimum) (AA)
- 2.4.6 Headings and Labels (AA)
