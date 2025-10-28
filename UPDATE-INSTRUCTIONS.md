# Instructions

## Delete the existing webspark profile (if it exists)
Delete the existing webspark profile folder located at `docroot/profiles/webspark`. You can do this with `rm -rf docroot/profiles/webspark` from your terminal.
## Get the required composer packages
Install the necessary composer packages by running the following command in your terminal:
```
ddev composer require asuwebplatforms/webspark:2.17.0 wikimedia/composer-merge-plugin:2.1.0
```
## Adjust your composer.json
This will add the needed package to your repository. After it has successfully installed, you will need to adjust your root `composer.json` file to ONLY have the following items in its `require` section:
```json
    "require": {
        "asu/custom-dependencies": "*"
        "asuwebplatforms/webspark": "2.17.0",
        "wikimedia/composer-merge-plugin": "2.1.0",
    },
```

Any items other than the three indicated above in the `require` section will need to be moved into the appropriate `composer.json` file in the custom-dependencies folder, being careful not to duplicate items that are in the webspark profile's `composer.json` file (which should be at `docroot/profiles/contrib/webspark/composer.json`).

Additionally, you will need to add or update the following sections in your root `composer.json` file to minimally include the following:

```json
     "extra": {
        "merge-plugin": {
            "require": [
                "docroot/profiles/contrib/webspark/composer.webspark-libraries.json",
                "docroot/modules/contrib/webform/composer.libraries.json"
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
                "[profile-root]/.gitignore": false,
                "[profile-root]/acquia-pipelines.yml": false
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
            "docroot/profiles/contrib/webspark/scripts/ComposerScripts.php",
            "custom-dependencies/scripts/CustomComposerScripts.php"
        ]
    },
    "scripts": {
        "pre-command-run": [
            "WebsparkCustomScripts\\CustomComposerScripts::checkCommand",
            "DrupalComposerManaged\\ComposerScripts::writeComposerPatchFile"
        ],
        "pre-update-cmd": [
            "DrupalComposerManaged\\ComposerScripts::preUpdate"
        ],
        "post-update-cmd": [
            "DrupalComposerManaged\\ComposerScripts::postUpdate"
        ],
        "custom-require": [
            "WebsparkCustomScripts\\CustomComposerScripts::customRequire"
        ],
        "custom-remove": [
            "WebsparkCustomScripts\\CustomComposerScripts::customRemove"
        ]
    }
```
## Acquia Cloud Next Webspark site adjustments
If your site is hosted on Acquia Cloud Next and you are using the Webspark profile, you will need to make the following adjustments to your Acquia Cloud Next environment settings.
### Delete upstream-configuration directory (if it exists)
If your repository has an `upstream-configuration` directory at the root level, delete it. This directory is no longer needed with the webspark profile.

### Prepare patch files
The `composer.patches.json` file at the root of your repository needs to be adjusted. Compare it with the version located in `docroot/profiles/contrib/webspark/patches.webspark.json` and remove any of the items that exist in that file from the root `composer.patches.json` file.

Then, take what is remaining and compare it with what exists in `custom-dependencies/patches.custom.json`. After making sure that the `custom-dependencies/patches.custom.json` file contains all of the patches unique to your site, you can delete the items from within the root `composer.patches.json` file, leaving only an empty set of curly braces like this:
`{}`.

From this point on, the root `composer.patches.json` file will be dynamically populated via a composer script that combines the patches in your custom-dependencies `patches.custom.json` file and the webspark profile's `patches.webspark.json` file when you run `composer update` or `composer install`.

## Update composer

Run `ddev composer update` to ensure all dependencies are correctly installed and updated.

## Verify the update
During the update process, pay close attention to the output in your terminal. You should see something like the following:
```
> WebsparkCustomScripts\CustomComposerScripts::checkCommand
> DrupalComposerManaged\ComposerScripts::writeComposerPatchFile
Gathering patches from patch file.
> DrupalComposerManaged\ComposerScripts::preUpdate
...
Loading composer repositories with package information
Updating dependencies
...
Writing lock file
Installing dependencies from lock file (including require-dev)
...
> DrupalComposerManaged\ComposerScripts::postUpdate
Successfully combined ASUAwesome and Font Awesome icons
```
Open the `composer.patches.json` file at the root of your project and verify that it has been populated with the patches from both the webspark profile and your custom-dependencies.

If you encountered no issues or errors during the update process, you have successfully updated your project to use the consolidated webspark profile!
