
# Webspark profile

## Description

Webspark profile installs all the required modules and configurations for the
webspark distribution.

## How to install
- For an initial install, follow the instructions in the INSTALL-INSTRUCTIONS.md file.

## Features

- Installs all the required modules for this distribution
- Comes with updates that will periodically improve the experience
- Has some predefined configurations on blocks, users, ckeditor profiles, system settings, etc.


## Requirements

Drupal 10 or higher

## Dependency sync process

The Webspark profile is installed into many downstream repositories via Composer.
A handful of files that Webspark relies on cannot live inside the profile itself —
they have to exist at the **root** of the consuming repository. To deliver these files without causing merge conflicts on
every upstream update, the profile ships them inside two source folders and
syncs/distributes them out to the repository root automatically when you run
`composer install` or `composer update`.

This section documents that process so developers understand what happens, why, and
which files they should and should not edit.

### The two source folders

Both folders live inside the profile and are the **source of truth**. They are
copied out to the repository root, where they are renamed (the `-source` suffix is
dropped):

| Profile source folder           | Root destination          | How it gets there                                            |
|---------------------------------| ------------------------- | ------------------------------------------------------------ |
| `webspark-dependencies-source/` | `webspark-dependencies/`  | Automatically rsynced on every `composer install`/`update`.  |
| `custom-dependencies-source/`   | `custom-dependencies/`    | Copied **once** by hand during install, then owned by the site. |

- `webspark-dependencies/` is **upstream-owned**. It is overwritten on every Composer
  run, so do **not** edit anything in it at the individual site level — your changes will be lost. Upstream changes belong in
  `webspark-dependencies-source/`.
- `custom-dependencies/` is **site-owned**. It holds your site-specific
  `composer.json` and `patches.custom.json` files, and is registered as a
  Composer `path` repository (`asu/custom-dependencies`). Manage it with
  `composer custom-require` / `composer custom-remove` (see
  `custom-dependencies/README.md`).

### Composer hook wiring

The root `composer.json` `scripts` section wires the process into Composer's
lifecycle:

  - `WebsparkCustomScripts\ComposerScripts::writeComposerPatchFile` — merges
    `webspark-dependencies/patches.webspark.json` (upstream) and
    `custom-dependencies/patches.custom.json` (site) into the root
    `composer.patches.json`. That root file is generated; edit the source patch
    files instead.
- **`post-update-cmd`** runs after `composer update` and **`post-install-cmd`** runs
  after `composer install`. Both start by running the
  `docroot/profiles/contrib/webspark/sync-dependencies` script (the actual file sync,
  described below), then perform a couple of follow-up steps:
  - After an update, `ComposerScripts::postUpdate` merges the ASUAwesome and Font
    Awesome icon lists for the renovation theme. After an install,
    `ComposerScripts::buildFrontend` compiles the renovation theme's frontend assets
    (only in the `asufactory1` CI pipeline).
  - Both then recreate the SimpleSAMLphp symlinks so the library can locate its
    public files and configuration.

The two Composer script classes are autoloaded from
`webspark-dependencies/scripts/ComposerScripts.php` and
`CustomComposerScripts.php` via the root `composer.json` `autoload.classmap`.

### What `sync-dependencies` does

`docroot/profiles/contrib/webspark/sync-dependencies` runs on every
`composer install` / `composer update`. It is **local-only**: it is skipped when
`AH_SITE_ENVIRONMENT` (Acquia Cloud) or `CI` is set, because those environments
already have the synced files committed to the repository.

When it runs locally it performs the following steps:

1. **Rsync the source folder.** `rsync -avq --delete` copies
   `webspark-dependencies-source/` to the root-level `webspark-dependencies/` directory. The `--delete` flag
   means `webspark-dependencies/` is a faithful mirror of the source — anything not
   in the source is removed.
2. **Rewrite PHP namespaces.** In every synced `*.php` file the namespace
   `SampleWebsparkCustomScripts` is rewritten to `WebsparkCustomScripts` (the
   namespace the root `composer.json` autoloader expects).
3. **Distribute the synced files to their final homes.** Files that were rsynced
   into `webspark-dependencies/scripts/` are moved to where they actually need to
   live for the repository to work, and the source copy under
   `webspark-dependencies/scripts/` is deleted after each move:

   | Synced source file                         | Final destination                          | Behavior                                                                                       |
   | ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
   | `scripts/pre-commit`                       | `.git/hooks/pre-commit`                    | Installs the hook, or merges the `asu_commit_check` function into an existing hook.            |
   | `scripts/post-commit`                      | `.git/hooks/post-commit`                   | Installs the hook, or merges the `asu_post_commit_actions` function into an existing hook.     |
   | `scripts/.prettierignore`                  | root `.prettierignore`                     | Copied to the repository root.                                                                 |
   | `scripts/prettierrc.js`                    | root `.prettierrc.js`                      | Copied to the repository root.                                                                 |
   | `scripts/.root-gitignore`                  | root `.gitignore`                          | Ensures the `/node_modules` and `!/package.json` rules exist (appends them if missing).        |
   | `scripts/package.json`                     | root `package.json`                        | Creates the root `package.json`, or merges the `prettier` devDependency into an existing one.  |

4. **Align `drupal/core-dev`.** `sync_core_dev` reads the installed
   `drupal/core-recommended` version from `composer.lock` and adds/updates a matching
   `drupal/core-dev` entry in the root `composer.json` `require-dev`.

The files that remain in `webspark-dependencies/` after distribution are the ones
that are referenced in place: the Composer scripts (`scripts/ComposerScripts.php`,
`scripts/CustomComposerScripts.php`, `scripts/pre-autoload-check`) and
`patches.webspark.json`.

### What developers should / should not edit

- **Upstream maintainers:** make changes in `webspark-dependencies-source/`
  (and `custom-dependencies-source/`). These are the sources of truth that ship with
  the profile.
- **Site developers:**
  - **Do not** edit `webspark-dependencies/` — it is regenerated on every Composer
    run.
  - **Do not** hand-edit the root `composer.patches.json` — it is generated by
    merging the two patch source files.
  - **Do** put site-specific dependencies and patches in `custom-dependencies/` using
    `composer custom-require` / `composer custom-remove`.

### Related documentation

- `INSTALL-INSTRUCTIONS.md` — For first-time setup, including the one-time copy of
  `custom-dependencies-source/` to root-level `custom-dependencies/` and the required root
  `composer.json` configuration.
- `UPDATE-INSTRUCTIONS.md` — How to update an existing Webspark site.
- `custom-dependencies/README.md` — For managing site-specific dependencies and patches.
