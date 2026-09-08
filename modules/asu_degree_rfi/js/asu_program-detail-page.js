(function ($, Drupal, drupalSettings) {
  Drupal.behaviors.programDetailPage = {
    attach: function (context, settings) {
      var componentLoaded =
        typeof AsuDegreePages !== 'undefined' &&
        typeof AsuDegreePages.initListingPage !== 'undefined';
      var programDetailPageExist =
        typeof settings.asu_degree_rfi !== 'undefined' &&
        typeof settings.asu_degree_rfi.program_detail_page !== 'undefined';

      if (!componentLoaded || !programDetailPageExist) {
        return;
      }

      // BigPipe guard: prevent double-initialization.
      var targetEl = document.getElementById('degreeDetailPageContainer');
      if (!targetEl || targetEl.hasAttribute('data-react-root-initialized')) {
        delete settings.asu_degree_rfi.program_detail_page;
        return;
      }
      targetEl.setAttribute('data-react-root-initialized', 'true');

      AsuDegreePages.initProgramDetailPage({
        targetSelector: '#degreeDetailPageContainer',
        props: settings.asu_degree_rfi.program_detail_page,
      });
    },
  };
})(jQuery, Drupal, drupalSettings);
