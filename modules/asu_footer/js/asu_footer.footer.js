(function (Drupal, drupalSettings) {
  Drupal.behaviors.AsuFooterBehavior = {
    attach: function (context, settings) {

      // If the asu footer is on the page
      var footerElement = document.getElementById("ws2FooterContainer");
      if (footerElement) {

        var props = drupalSettings.asu_footer ? drupalSettings.asu_footer.props : {};

        // Check if AsuHeaderFooter is available and initialize the footer
        if (typeof AsuHeaderFooter !== 'undefined' && typeof AsuHeaderFooter.initASUFooter === 'function') {
          AsuHeaderFooter.initASUFooter({
            targetSelector: '#ws2FooterContainer',
            props: props
          });
        } else {
          console.warn('AsuHeaderFooter.initASUFooter not found. Make sure @asu/component-header-footer package is properly loaded.');
        }

      }
    }
  };

})(Drupal, drupalSettings);
