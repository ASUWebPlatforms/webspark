# Introduction

Webspark Views adds a custom Views style plugin that renders node results as a card grid. It gives site builders a structured way to map content fields into a reusable card layout with optional image, body, and CTA elements.

The format is designed for a single content type view that uses the Fields row plugin. It can map a media image field, a text body field, and a link field into the supplied card template.

## How to enable

Enable the module from the "extend" admin area or with Drush:

```bash
drush en webspark_views -y
drush cr
```

Ensure to clear the site cache after installation.

## How to use

1. Create or edit a view that lists content nodes.
2. Add a `Content: Type` filter and restrict the view to exactly one content type.
3. Set the display row style to `Fields`.
4. In the Views style settings, choose `Default Cards Style`.
5. Configure the card options:
   - `Columns` controls the desktop grid density.
   - `Button Color` controls the CTA button class.
   - `Card body text format` controls how the body text is filtered and sanitized.
   - `Map fields to card elements` connects node fields to the card image, body, and CTA.

### Field mappings

The style only offers fields that match the expected data type for the selected content type.

- `Media image field`: choose an entity reference field that points to Media.
- `Card body`: choose a text field. If the field has a summary, the summary is used first; otherwise the full field value is used.
- `CTA`: choose a link field. The template is built to render card buttons from that field.

### Rendering behavior

- Card body content is filtered through the selected text format and then trimmed to 500 characters.
- If the chosen text format is missing or disabled, the plugin falls back to `Minimal Format`.
- The template uses the view name and the mapped field values to render the card markup.
- The view must stay restricted to a single content type; the plugin validates this and will refuse incompatible configurations.

## Example setup

For an `article` content view, a typical setup would look like this:

- Content type: 'Article'
- Format: 'Default Cards Style'
- Format shows: 'Fields'
- Mappings:
  - Media image mapping: 'Hero Image'
  - Card body field: 'Byline' or 'Body'
  - CTA field: NA (Articles do not have a CTA field by default)

## Notes

- The module currently supports the supplied default card template only.

## Todo

- Goal is to support all card types provided by Unity.
