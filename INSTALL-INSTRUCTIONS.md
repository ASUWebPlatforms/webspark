# Instructions

These instructions will work for new installs on a Vanilla Drupal site as well as for updating an existing Webspark site. We are consolidating the Webspark profile into a single package to simplify maintenance and updates going forward. This means that some small adjustments may be necessary to bring your codebase into compliance with these changes.

## Delete the existing webspark profile (if it exists)
Delete the existing webspark profile folder located at `docroot/profiles/webspark`. You can do this with `rm -rf docroot/profiles/webspark` from your terminal.

## Delete the existing webspark modules and theme (if they exist)
Delete the existing webspark modules and theme folders:
- `rm -rf docroot/modules/webspark`
- `rm -rf docroot/themes/webspark`

## Temporarily remove root required dependencies
- In order to properly install the consolidated webspark profile, you will need to TEMPORARILY remove all of the required packages from your root `composer.json` file.
- We recommend copying the entire `require` section from your root `composer.json` file and pasting it into a temporary text file for safekeeping. You will need to reference this later when moving non-Webspark packages to the `custom-dependencies` folder.
- After you have removed the `require` section from your root `composer.json` file, save the file.

## Delete the composer.lock file
To avoid dependency clashes, remove the root-level composer.lock file.

## Temporarily remove patches
- The `composer.patches.json` file at the root of your repository needs to be adjusted. Compare it with the version located in `docroot/profiles/contrib/webspark/sample-webspark-dependencies/patches.webspark.json` and remove any of the items that exist in that file from the root `composer.patches.json` file.
- Then, take what is remaining, copy it, and paste it into a temporary text file.
- Your root `composer.patches.json` file should basically be empty now, leaving only the following content:
```json
{
  "patches": {}
}
```


## Get the required composer packages
Install the necessary composer packages by running the following command in your terminal:
```
ddev composer require asuwebplatforms/webspark:^2.17.0 wikimedia/composer-merge-plugin:^2.1.0
```

## Add custom-dependencies directory (if it doesn't exist)
- If your repository does not already have a `custom-dependencies` directory at the root level, you will need to create it. You can do so by copying the `sample-custom-dependencies` directory from this profile and pasting it into the root of your repository. Then, rename the copied directory from `sample-custom-dependencies` to `custom-dependencies`.
- If you already have a `custom-dependencies` directory, you should ensure that its contents include everything that is in the `sample-custom-dependencies` directory, making adjustments as necessary.
  - If you have a `scripts` directory in your existing `custom-dependencies` folder, please delete it.
  - If you have a `patches` directory in your existing `custom-dependencies` folder, you can keep it, if it has local patch files that you need for your site.

For more information about the `custom-dependencies` folder and its purpose, please refer to the README file located within that directory.

## Add webspark-dependencies directory
- If your repository contains an `upstream-configuration` directory at the root level, you will need to delete it. This directory is no longer needed with the newly consolidated webspark profile (as of Webspark 2.17.0).
- Copy the `sample-webspark-dependencies` directory from this profile and paste it into the root of your repository.
- Rename the copied directory from `sample-webspark-dependencies` to `webspark-dependencies`.
- Edit the namespace declarations in the two PHP files within the `scripts` directory to be `WebsparkCustomScripts` instead of `SampleWebsparkCustomScripts` and save them.

For more information about the `webspark-dependencies` folder and its purpose, please refer to the README file located within that directory.

## Re-add patches
Compare what you saved into a temporary text file with what exists in `custom-dependencies/patches.custom.json`, making sure that the `custom-dependencies/patches.custom.json` file contains all of the patches unique to your site.

From this point on, the root `composer.patches.json` file will be dynamically populated via a composer script that combines the patches in your custom-dependencies `patches.custom.json` file and the webspark profile's `patches.webspark.json` file when you run `composer update` or `composer install`.

## Adjust your composer.json
You will need to adjust your root `composer.json` file to ONLY have three items in its `require` section, as seen below. To accomplish this, you will need to move some items to the new `custom-dependencies` folder as described in the next section.
```json
    "require": {
        "asu/custom-dependencies": "*",
        "asuwebplatforms/webspark": "^2.17.0",
        "wikimedia/composer-merge-plugin": "^2.1.0",
    },
```

## Move non-Webspark composer packages to the custom-dependencies composer.json file
- Compare the `require` items you pasted into a temporary text file from the root composer.json file with composer.json file located in `docroot/profiles/contrib/webspark/composer.json` and remove any items in your temporary file that duplicate what is in the profile.
- Any remaining items, other than the three indicated above in the `require` section, will need to be moved into the appropriate `composer.json` file in the `custom-dependencies` folder.

## Update your root composer.json's extra, autoload, scripts, and repositories sections
For the Webspark profile to work properly, you will need to ensure that the following sections in your root `composer.json` file include the following items, at a minimum:

```json
     "extra": {
        "merge-plugin": {
            "require": [
                "docroot/modules/contrib/webform/composer.libraries.json",
                "docroot/profiles/contrib/webspark/composer.json",
                "custom-dependencies/composer.json"
            ],
            "recurse": true,
            "replace": false,
            "ignore-duplicates": false,
            "merge-dev": true,
            "merge-extra": false,
            "merge-extra-deep": false,
            "merge-replace": true,
            "merge-scripts": true
        },
        "drupal-scaffold": {
            "allowed-packages": [
                "drupal/core"
            ],
            "locations": {
                "web-root": "./docroot"
            },
            "file-mapping": {
                "[web-root]/.htaccess": false,
                "[web-root]/robots.txt": false,
                "[profile-root]/.editorconfig": false,
                "[profile-root]/.gitattributes": false,
                "[profile-root]/.coveralls.yml": false,
                "[profile-root]/.travis.yml": false,
                "[profile-root]/.gitignore": false,
                "[profile-root]/acquia-pipelines.yml": false,
                "[profile-root]/grumphp.yml": false
            },
            "gitignore": true,
            "excludes": [
                ".htaccess"
            ]
        },
        "enable-patching": true,
        "patches-file": "composer.patches.json",
        "installer-paths": {
            "docroot/core": [
                "type:drupal-core"
            ],
            "docroot/libraries/{$name}": [
                "type:drupal-library",
                "type:bower-asset",
                "type:npm-asset"
            ],
            "docroot/modules/contrib/{$name}": [
                "type:drupal-module"
            ],
            "docroot/profiles/contrib/{$name}": [
                "type:drupal-profile"
            ],
            "docroot/themes/contrib/{$name}": [
                "type:drupal-theme"
            ],
            "docroot/modules/custom/{$name}": [
                "type:drupal-custom-module"
            ],
            "docroot/profiles/custom/{$name}": [
                "type:drupal-custom-profile"
            ],
            "docroot/themes/custom/{$name}": [
                "type:drupal-custom-theme"
            ],
            "drush/Commands/contrib/{$name}": [
                "type:drupal-drush"
            ],
            "docroot/libraries/ckeditor/plugins/{$name}": [
                "vendor:ckeditor-plugin"
            ]
        },
        "installer-types": [
            "bower-asset",
            "npm-asset"
        ],
        "patchLevel": {
            "drupal/core": "-p2"
        }
    },
    "autoload": {
        "classmap": [
            "webspark-dependencies/scripts/ComposerScripts.php",
            "webspark-dependencies/scripts/CustomComposerScripts.php"
        ]
    },
    "scripts": {
        "pre-autoload-dump": [
            "bash webspark-dependencies/scripts/pre-autoload-check"
        ],
        "pre-command-run": [
            "WebsparkCustomScripts\\CustomComposerScripts::checkCommand",
            "WebsparkCustomScripts\\ComposerScripts::writeComposerPatchFile",
            "bash docroot/profiles/contrib/webspark/sync-dependencies"
        ],
        "pre-update-cmd": [
            "WebsparkCustomScripts\\ComposerScripts::preUpdate"
        ],
        "post-update-cmd": [
            "WebsparkCustomScripts\\ComposerScripts::postUpdate"
        ],
        "custom-require": [
            "WebsparkCustomScripts\\CustomComposerScripts::customRequire"
        ],
        "custom-remove": [
            "WebsparkCustomScripts\\CustomComposerScripts::customRemove"
        ]
    },
    "repositories": [
        {
            "type": "composer",
            "url": "https://packages.drupal.org/8"
        },
        {
            "type": "composer",
            "url": "https://asset-packagist.org"
        },
        {
            "type": "path",
            "url": "custom-dependencies"
        },
        {
            "type": "package",
            "package": {
                "name": "fontawesome/fontawesome",
                "version": "6.4.2",
                "type": "drupal-library",
                "extra": {
                    "installer-name": "fontawesome"
                },
                "dist": {
                    "url": "https://use.fontawesome.com/releases/v6.4.2/fontawesome-free-6.4.2-web.zip",
                    "type": "zip"
                }
            }
        },
        {
        "type": "package",
            "package": {
                "name": "northernco/ckeditor5-anchor-drupal",
                "version": "0.4.0",
                "type": "drupal-library",
                "dist": {
                    "url": "https://registry.npmjs.org/@northernco/ckeditor5-anchor-drupal/-/ckeditor5-anchor-drupal-0.4.0.tgz",
                    "type": "tar"
                }
            }
        }
    ]
```

## Update composer

Run `ddev composer update` to ensure all dependencies are correctly installed and updated.

## Verify the update
During the update process, pay close attention to the output in your terminal. You should see something like the following (truncated for brevity):
```
> WebsparkCustomScripts\CustomComposerScripts::checkCommand
> WebsparkCustomScripts\ComposerScripts::writeComposerPatchFile
Gathering patches from patch file.
Removing package drupal/cas so that it can be re-installed and re-patched.
  - Removing drupal/cas (2.3.2)
...
Deleting /var/www/html/docroot/modules/contrib/cas - deleted
> WebsparkCustomScripts\ComposerScripts::preUpdate
Using version 'dev-main' for path repositories.
Loading composer repositories with package information
Updating dependencies
Lock file operations: 26 installs, 1 update, 1 removal
...
Writing lock file
Installing dependencies from lock file (including require-dev)
Package operations: 34 installs, 1 update, 1 removal
  - Downloading asuwebplatforms/webspark (dev-main 02fa4b5)
...
Gathering patches from patch file.
Gathering patches for dependencies. This might take a minute.
  - Installing algolia/places (1.19.0): Extracting archive
  - Installing asu/custom-dependencies (dev-main): Symlinking from custom-dependencies
  - Installing drupal/core (10.3.14): Extracting archive
...
  - Applying patches for drupal/core
    https://www.drupal.org/files/issues/2022-07-13/f245f21ea664f22c81d8d28c6f0f4a42fb9a5890.patch (#2951547: Fix issue with layout overflow)
    https://www.drupal.org/files/issues/2024-05-16/core-10.2.3-xss-refactor_filter_attributes-3109650-74.patch (#3109650: Refactor Xss::attributes() to allow filtering of style attribute values)
    https://www.drupal.org/files/issues/2024-02-15/3415961.patch (#3415961: Fix issue with focus after inserting media via the modal dialog)
    https://www.drupal.org/files/issues/2024-08-14/3386605-9-add-ckeditor5-support-for-webp.patch (#3386605: Add CKEditor 5 support for WebP images)
...
Package doctrine/annotations is abandoned, you should avoid using it. No replacement was suggested.
Generating autoload files
...
> WebsparkCustomScripts\ComposerScripts::postUpdate
Successfully combined ASUAwesome and Font Awesome icons
```
Open the `composer.patches.json` file at the root of your project and verify that it has been populated with the patches from both the webspark profile and your custom-dependencies.

If you encountered no issues or errors during the update process, you have successfully updated your project to use the consolidated webspark profile!
