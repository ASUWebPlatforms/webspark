(function ($, Drupal, drupalSettings) {
  Drupal.behaviors.degreeListingPage = {
    attach: function (context, settings) {
      var componentLoaded =
        typeof AsuDegreePages !== 'undefined' &&
        typeof AsuDegreePages.initListingPage !== 'undefined';
      var degreeListingPageExist =
        typeof settings.asu_degree_rfi !== 'undefined' &&
        typeof settings.asu_degree_rfi.degree_listing_page !== 'undefined';

      if (!componentLoaded || !degreeListingPageExist) {
        return;
      }

      // BigPipe guard: prevent double-initialization.
      var targetEl = document.getElementById('degreeListingPageContainer');
      if (!targetEl || targetEl.hasAttribute('data-react-root-initialized')) {
        delete settings.asu_degree_rfi.degree_listing_page;
        return;
      }
      targetEl.setAttribute('data-react-root-initialized', 'true');

      AsuDegreePages.initListingPage({
        targetSelector: '#degreeListingPageContainer',
        props: settings.asu_degree_rfi.degree_listing_page,
      });
    },
  };
})(jQuery, Drupal, drupalSettings);
