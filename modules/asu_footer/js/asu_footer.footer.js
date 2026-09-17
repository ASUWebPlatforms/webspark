(function (Drupal, drupalSettings) {
  Drupal.behaviors.AsuFooterBehavior = {
    attach: function (context, settings) {
      // If the asu footer is on the page
      var footerElement = document.getElementById('ws2FooterContainer');
      if (footerElement) {
        // BigPipe guard: prevent double-initialization.
        if (footerElement.hasAttribute('data-react-root-initialized')) {
          return;
        }
        footerElement.setAttribute('data-react-root-initialized', 'true');

        var props = drupalSettings.asu_footer
          ? drupalSettings.asu_footer.props
          : {};

        // Check if the shared ESM bundle is available and initialize the footer.
        if (
          window.websparkAsuHeaderFooter &&
          typeof window.websparkAsuHeaderFooter.initASUFooter === 'function'
        ) {
          window.websparkAsuHeaderFooter.initASUFooter({
            targetSelector: '#ws2FooterContainer',
            props: props,
          });
        } else {
          console.warn(
            'The Webspark ASU footer initializer is unavailable. Make sure asu_brand/components-library is loaded.',
          );
        }
      }
    },
  };
})(Drupal, drupalSettings);
