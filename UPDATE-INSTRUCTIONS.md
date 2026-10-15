# Updating Webspark

If you are using the Webspark profile, you will need to keep it up to date with the latest changes. The best way to do this is to utilize Composer to update the dependencies.

To update Webspark, follow these steps:

1. Open your terminal and navigate to the root directory of your Webspark project.
2. Run the following command to update webspark with all of its dependencies:

```bash
ddev composer update asuwebplatforms/webspark --with-all-dependencies
```

3. If you experience issues updating, you can try the following steps:
   - Check for patches that have been applied in your `custom-dependencies` directory that may be incompatible with the latest update. Remove any that are no longer needed or that may be causing conflicts.
     - Tip: If a patch didn't apply on initial update, try running `ddev composer install` to see if a second attempt will fix the patching issue.
   - Check the `composer.json` file in your `custom-dependencies` directory to ensure that there are no conflicting dependencies that may be preventing the update from completing successfully.
   - Double check that your root `composer.json` file matches the latest information in the `INSTALL_INSTRUCTIONS.md` file in the Webspark repository.
     - If you find discrepancies between your `composer.json` file and the one in the Webspark repository, update your `composer.json` file to match the latest install recommendations.
   - You can try deleting the `docroot/profiles/contrib/webspark` directory and then running the composer update command again. This will force composer to re-download the Webspark profile and its dependencies.
4. After updating, make sure to update the database by clicking through the form at `/update.php` and also clear the Drupal cache to ensure that all changes take effect.

## Automatic composer.json changes

On `composer install` and `composer update`, Webspark applies small, guarded,
idempotent fixups to your root `composer.json`
(`WebsparkCustomScripts\ComposerScripts::applyComposerJsonUpdates`) so downstream
sites stay consistent without hand edits. It runs via `pre-update-cmd` on update
and `pre-command-run` on install; existing values you set are never overwritten.

### `drupal/telephone` replace shim (temporary)

The hook adds this to your root `composer.json`:

```json
"replace": {
    "drupal/telephone": "*"
}
```

**Why:** the deprecated core `telephone` module has a constraint that forces
Drupal core to 11.4. Marking it replaced makes Composer treat it as provided, so
the constraint is skipped and your site stays on its current core version.

Because `composer install` does not re-resolve, apply the shim with a scoped
update of the package that pulls in telephone:

```bash
ddev composer update drupal/telephone_validation --with-all-dependencies
```

This re-resolves the telephone dependency chain and honors the new `replace`.
Drupal core is unaffected: it is pinned to an exact version, so it cannot move.

**TODO — remove at Drupal 11 upgrade:** delete the `drupal/telephone` entry from
`composer.json` and the matching block in
`webspark-dependencies-source/scripts/ComposerScripts.php`.
