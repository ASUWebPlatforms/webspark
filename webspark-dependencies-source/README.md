# webspark-dependencies-source

This folder is the **upstream source of truth** for files that Webspark needs at the
**root** of a consuming repository (the Composer scripts, git hooks, prettier config,
root `.gitignore` rules, root `package.json` entries, and the upstream patches file).

On every `composer install` / `composer update`, the profile's `sync-dependencies`
script rsyncs this folder to `webspark-dependencies/` at the repository root, rewrites
PHP namespaces, and distributes the individual files to their final destinations.

> ⚠️ Do **not** edit `webspark-dependencies/` at the site level — it is regenerated on
> every Composer run. Upstream changes belong here, in `webspark-dependencies-source/`.

📖 **For the full end-to-end documentation of how this sync works, see the
"Dependency sync process" section of the main profile
[`README.md`](../README.md).**
