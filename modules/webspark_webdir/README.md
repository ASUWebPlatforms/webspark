# Webspark Web Directory (webspark_webdir) module

This module provides a web directory block that pulls data from the ASU Directory and displays it in a block via the Unity Design System's `app-webdir-ui` React component.

It also provides a standalone local profile entity type (`asu_profile`) that can be used to create local directory entries that may or may not be pulled from the ASU Directory. This is useful for creating directory entries and listings for departments that may have affiliates or employees who are not included in the ASU Directory.

## Installation

1. Enable the module via Drush:
   ```
   drush en webspark_webdir -y
   ```
2. Configure the block:
   - Using Layout Builder, find the "Web Directory" custom block and place it in a section of your choice.
   - Configure the block settings as needed.
3. (Optional) Create local profile entries:
   - Use layout builder to add a "Profile List" block to a page and configure it to display local profiles that can be interspersed with profiles pulled from the ASU Directory in a grid or list view.

## Testing

This module contains Kernel and Unit tests for the ASU Profile entity type. To run all tests, use the following command in your local DDEV environment:

```
ddev exec "SIMPLETEST_DB=mysql://db:db@db:3306/db vendor/bin/phpunit -c docroot/core --group webspark_webdir docroot/profiles/contrib/webspark/modules/webspark_webdir/tests/"
```

To run only Unit tests (no database required):

```
ddev exec vendor/bin/phpunit -c docroot/core --testsuite unit --group webspark_webdir docroot/profiles/contrib/webspark/modules/webspark_webdir/tests/src/Unit/
```

To run only Kernel tests:

```
ddev exec "SIMPLETEST_DB=mysql://db:db@db:3306/db vendor/bin/phpunit -c docroot/core --testsuite kernel --group webspark_webdir docroot/profiles/contrib/webspark/modules/webspark_webdir/tests/src/Kernel/"
```
