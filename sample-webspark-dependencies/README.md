# Webspark Dependencies

This directory contains the dependencies required for the Webspark distribution profile. These dependencies must reside in the root directory of the repository to ensure proper functionality.

## Contents
- A `scripts` directory containing necessary Composer scripts for managing a Webspark-based project.
  - `ComposerScripts.php`: This file includes custom Composer scripts that facilitate various tasks such as installation, updates, and maintenance of the Webspark distribution.
  - `CustomComposerScripts.php`: This file contains custom Composer scripts designed to enable the use of the `composer custom-require` and `composer custom-remove` commands, which should be used when adding or removing packages from a Webspark-based project.
  - `pre-autoload-check`: This script is necessary for ensuring that the autoload files do not cause false-positive errors during pipeline artifact generation.
- `patches.webspark.json`: This file contains patches specific to the Webspark distribution that are applied during the Composer installation process.

## Installation
- Copy the `sample-webspark-dependencies` directory to the root of your Webspark-based project repository and rename it to be `webspark-dependencies`.
- Edit the namespace declarations in the two PHP files within the `scripts` directory to be `WebsparkCustomScripts` instead of `SampleWebsparkCustomScripts` and save them.

## Usage
After installation, this directory and its files **_should never be modified directly_**. Rather, we will automatically update it as needed via Webspark update scripts.
