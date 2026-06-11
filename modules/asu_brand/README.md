# ASU Brand module for Drupal

The ASU Brand module provides the following functionality:

- An ASU branded, accessible, Web Standards compliant Header with integration
  with ASU search and spplying required links. The header provides navigation
  menu which you can configure through the Drupal admin user interface. More
  details on configuration below.
- ASU Universal Google Tag Manager. Enabled and included in your site's markup
  automatically without any configuration needed by you. Should you want to
  turn it off or wish to add an additional GTM container ID, visit Admin ->
  Configuration -> ASU Brand settings.
- ASU branded Cookie Consent for GDPR compliance. On by default. No
  configuration necessary.

Find more technical details about the header, GTM and cookie consent on [unity.web.asu.edu](https://unity.web.asu.edu).

## Installation instructions

The ASU Brand module installs when you create a Webspark site. If you're
using this module outside of Webspark or in other situations, see the
instructions below.

1. Install and enable the ASU Brand module just like any other module.
2. Go to the Admin -> Structure -> Blocks and place the ASU Brand header block
   into the header region of your site. Please note that the header supplies
   its own header tag, so you may need to update non-Webspark themes to ensure
   they do not set their own header tags. The available regions will be
   determined by the theme that you are using.

## CAS integration

The default login/out paths used in the ASU Brand header assume you have the
CAS single sign on module enabled. CAS should be included and installed by
default in Webspark sites. If needed for implementations, install and enable
the CAS module to allow users to create accounts and authenticate to your site.

## Note on caching

The ASU Brand header is cached for performance. When you make updates to the
menu used in your header, please clear the cache to see your updates
immediately. In the Drupal UI, go Admin -> Configuration -> Performance to
clear the cache.

## Other configurations

Global configurations related to GTM and Cookie Consent are found at the
following click path: Admin -> Configuration -> ASU Brand settings.

## Header assets

Previous version of the ASU Brand header loaded the header from external
sources. The Webspark 2 version of the module, now ships with all header assets
from the Unity Design System "components-library" header component onboard.

## A note about toolbar menus

The ASU Brand header is designed to work with the Drupal core toolbar menu used
to provide administrative system links. A popular Drupal module, the Admin
Toolbar, which provides dropdown menus from the toolbar, is not currently
supported.

## Help! The header overlaps my content or UI!

The ASU Brand header uses fixed positioning, and that can lead to issues with
other fixed positioned elements in the UI. We've attempted to catch and supply
CSS rules that make adjustments for those UI elements provided in Webspark. If
you have customizations or added modules that are overlapped, you can use the
following CSS to deliver UI adjustments:

```css
body.asu-brand-header-present {
  /* Your rules here. See css/asu_brand.header.css for examples from this
     module. To see how the ASU Brand module uses Javascript to detect and
     apply necessary changes related to the header, see
     js/asu_brand.header.js */
}
```

## Extending the Google Analytics dataLayer

The ASU Brand module initializes a Google Analytics dataLayer for use by
frontend Unity components. The dataLayer has been implmented so that
modules may take advantage of it as well using the
hook_asu_brand_gtm_datalayer_alter() hook. Please note, use of this hook to
add page-based dataLayer pushes has not been tested, so it is encumbent on
the developer implementing to ensure it behaves as desired and doesn't
interfere with other dataLayer usage on existing pages. If you test this,
we would appreciate hearing about your experience.

```php
function hook_asu_brand_gtm_datalayer_alter(array &$datalayer) {
  // Set a "site" variable return.
  $datalayer['site'] = 'My Site';
}
*/
```
