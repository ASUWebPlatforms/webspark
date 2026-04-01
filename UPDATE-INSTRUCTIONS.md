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
