(function ($, Drupal, drupalSettings, once) {
  Drupal.behaviors.anchorMenu = {
    attach: function (context, settings) {
      $(once('anchorMenuInit', '#uds-anchor-menu', context)).each(function () {
        const $anchorMenuEl = $(this);
        const $links = $('.webspark-anchor-link-data');
        if (!$links.length) return;

        const anchorMenuNav = $anchorMenuEl.find('nav');
        const heading = $('.uds-anchor-menu-wrapper')
          .find('h2')
          .text()
          .toLowerCase()
          .trim();

        // NOTE: Leaving this code here for now, if after full testing is complete and
        // the issue is not present, this should be removed before the next release.
        // If the user is an admin, we clear the anchor menu items to not duplicate links
        // if (drupalSettings.is_admin) {
        //   $(once('clear-anchor-menu-items', anchorMenuNav, context)).each(function() {
        //     anchorMenuNav.empty();
        //   });
        // }

        $(once('append-anchor-menu-items', $links, context)).each(
          function (i, item) {
            const icon = $(item).siblings('.anchor-link-icon').html();
            const title = $(item).data('title');
            const href = $(item).attr('id');
            const dataTitle = title.toLowerCase();
            const markup = `<a class="nav-link" data-ga-event="link" data-ga-action="click" data-ga-name="onclick" data-ga-type="internal link" data-ga-region="main content" data-ga-component="" data-ga-section="${heading}" data-ga-text="${dataTitle}" href="#${href}"><span>${icon}</span>${title}</a>`;

            anchorMenuNav.append(markup);
          },
        );

        // Give the React header time to render
        setTimeout(function () {
          initializeAnchorMenu();
        }, 100);

        // After render otherwise it will attach to the wrong element
        $anchorMenuEl.show();
      });
    },
  };

  // Anchor menu logic relies on @asu/unity-bootstrap-theme in the Renovation theme
})(jQuery, Drupal, drupalSettings, once);
