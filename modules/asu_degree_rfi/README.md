# webspark-module-asu_degree_rfi
Degree and RFI component launcher module.

## About the asu_degree_rfi module
The ASU Degree RFI module provides Webspark 2 integrations for the 
[Unity Design System](https://unity.web.asu.edu) app-degree-pages and 
app-rfi components.

## Installation
Enable the module through the Drupal admin interface like any other
module.

Information about how these components function and are to be
configured within Webspark 2 is found in the admin interface 
for the module at the path `/admin/config/asu_degree_rfi/settings`
in your site.

Please note, the recommendations for configuring the RFI settings
have changed since ASU hosting moved to Acquia. RFI settings are 
now recommended to be configured via the admin UI.

## About Degree listing pages and Degree detail pages
The only type of degree pages you need to manually create in your site 
are Degree listing pages. In creating a Degree listing page, you define
the parameters the degree listing component will use to display the links
to the Degree detail pages in the UI. When a user follows one of those
links, if no Degree detail page exists at that path yet it will 
automatically be created.

IMPORTANT NOTE:
Because a Degree detail page relies on the page's path to determine
whether or not to create the page, please do not alter the automatic
path settings for Degree detail pages or edit the path after the page
is created. We have taken measures to prevent you from doing this in
the UI. In cases where the path is altered, duplicated Degree detail
pages will be created.

If you need to map legacy paths, or other paths to a Degree detail
page, please use a redirect in order to preserve the system path.

Additionally, it should be noted that because the parent node ID is 
included on the path of a Degree detail page so that a breadcrumb trail
can be established, if you have a degree appearing in multiple Degree
listing pages, a copy of the Degree detail page will be created for the
context of each Degree listing page. This is considered a feature, and
not a bug as it allows the most flexibility by providing the proper
breadcrumb trail context and allows for each copy of the Degree detail
page to be overridden with customizations for the unique context.
