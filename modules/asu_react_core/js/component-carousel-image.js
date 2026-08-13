(function ($, Drupal, drupalSettings) {

  Drupal.behaviors.imageCarousel = {
    attach: function (context, settings) {
      var componentLoaded = typeof unityReactCore !== "undefined" && typeof unityReactCore.initImageCarousel !== "undefined";
      var imageExist = typeof settings.asu !== "undefined" && typeof settings.asu.components !== "undefined" && typeof settings.asu.components.carousel_image !== "undefined";

      if (!imageExist || !componentLoaded) {
        return;
      }
      for (var imageId in settings.asu.components.carousel_image) {
        var carouselData = settings.asu.components.carousel_image[imageId];

        // BigPipe guard: prevent double-initialization.
        var targetEl = document.getElementById("imageCarouselContainer" + imageId);
        if (!targetEl || targetEl.hasAttribute('data-react-root-initialized')) {
          delete settings.asu.components.carousel_image[imageId];
          continue;
        }
        targetEl.setAttribute('data-react-root-initialized', 'true');

        var images = [];
        carouselData.items.forEach(function(item) {
          images.push(settings.asu.components.gallery_image[item]);
        });

        var type = carouselData.type
        // Setup and initialize the Image carousel.
        unityReactCore.initImageCarousel({
          targetSelector: "#imageCarouselContainer" + imageId,
          props: {
            perView: "2",
            imageItems: images,
            imageAutoSize: true,
          },
        });

        delete settings.asu.components.carousel_image[imageId];
      }
    }
  };

})(jQuery, Drupal, drupalSettings);
