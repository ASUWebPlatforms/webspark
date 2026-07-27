# ASU Footer module for Drupal 9

## Description

The ASU Footer module provides a custom block plugin specific for the ASU Footer.

## Requirements

Drupal 8.x. or Drupal 9.x

## Configuration

To configure the block, you will have to go to the Block section for your
current theme admin/structure/block and configure the "# ASU Footer Module

This Drupal module provides integration with the ASU React footer component from the `@asu/component-header-footer` package.

## Overview

The ASU Footer module creates a React-based footer component that follows ASU Web Standards 2.0. It provides configurable social media links and contact information while maintaining consistency with ASU branding guidelines.

## Features

- **React Component Integration**: Uses the official `@asu/component-header-footer` package
- **Configurable Social Media Links**: Support for Facebook, Twitter, LinkedIn, Instagram, and YouTube
- **Contact Information**: Configurable contact details including title, address, phone, and email
- **Theme Independent**: Works with any Drupal theme
- **Cache Integration**: Proper Drupal cache handling for optimal performance

## Installation

1. Ensure the `asu_brand` module is installed and enabled (required for shared React components)
2. Enable the footer module: `drush en asu_footer`
3. Configure the footer block through the block layout interface

**Note**: The footer module depends on the `asu_brand` module for the shared `@asu/component-header-footer` React component library.

## Configuration

### Block Configuration

1. Go to Admin → Structure → Block Layout
2. Place the "ASU footer" block in your desired region
3. Configure the block settings:
   - **Social Media Settings**: Enable and configure social media links
   - **Contact Information Settings**: Enable and configure contact information

### Global Settings

Access global footer settings at: Admin → Configuration → ASU → ASU Footer

## Usage

Once configured, the footer will automatically render using the React component. The footer includes:

- Social media icons (if configured)
- Contact information (if configured)
- Standard ASU legal and innovation sections

## Dependencies

- `asu_react_integration`
- `asu_react_core`
- `asu_brand` (for shared `@asu/component-header-footer` package)

## Technical Details

The module follows the same pattern as the ASU Brand header module:

- Block plugin for configuration (`AsuFooterBlock.php`)
- JavaScript integration (`asu_footer.footer.js`)
- Drupal settings integration for passing configuration to React
- **Shared Library Dependency**: Uses the `@asu/component-header-footer` package through the `asu_brand` module's library system

## Troubleshooting

If the footer doesn't display properly:

1. Check that the `@asu/component-header-footer` package is installed
2. Verify JavaScript console for any errors
3. Ensure the block is placed and configured correctly
4. Check that required dependencies are enabled" block.
   In order to add custom menus, you can do that in the Menu section: admin/structure/menu.
