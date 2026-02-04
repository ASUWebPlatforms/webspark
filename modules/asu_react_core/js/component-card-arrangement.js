(function ($, Drupal, drupalSettings) {

  Drupal.behaviors.cardArrangement = {
    attach: function (context, settings) {
      var componentLoaded = typeof unityReactCore !== "undefined" && (
        typeof unityReactCore.initCardArrangement !== "undefined" ||
        typeof unityReactCore.initRankingCard !== "undefined"
      );
      var cardArrangementExist = typeof settings.asu !== "undefined" &&
        typeof settings.asu.components !== "undefined" &&
        typeof settings.asu.components.card_arrangement !== "undefined";

      const COLUMNS_PROP = {
        "two-columns": "2",
        "three-columns": "3",
        "four-columns": "4",
      }

      if (!cardArrangementExist || !componentLoaded) {
        return;
      }

      for (var blockUuid in settings.asu.components.card_arrangement) {
        var arrangementData = settings.asu.components.card_arrangement[blockUuid];

        const isValidForCardArrangement = arrangementData.cards.length > 1;
        const isRankingCardsOnly = arrangementData.cards.every(card => card.cardType === "ranking");

        if (isValidForCardArrangement && isRankingCardsOnly) {
          // Use ranking card component for multiple ranking cards
          unityReactCore.initCardArrangement({
            targetSelector: "#card-arrangement-" + blockUuid,
            props: {
              columns: COLUMNS_PROP[arrangementData.columns],
              cards: arrangementData.cards.map(card => ({
                imageSize: card.imageSize,
                image: card.imageSource,
                imageAlt: card.imageAltText,
                heading: card.title,
                body: card.content,
                readMoreLink: card.linkUrl,
                citation: card.citation,
              })),
              cardType: "ranking",
            },
          });
        } else if (isValidForCardArrangement) {
          // Use card arrangement component for multiple cards
          unityReactCore.initCardArrangement({
            targetSelector: "#card-arrangement-" + blockUuid,
            props: {
              columns: COLUMNS_PROP[arrangementData.columns],
              cards: arrangementData.cards.map(card => ({
                type: card.cardType,
                horizontal: card.horizontal,
                clickable: card.clickable,
                clickHref: card.clickHref,
                image: card.imageSource,
                imageAltText: card.imageAltText,
                title: card.cardType === "image" ? card.linkLabel : card.title,
                body: card.content,
                buttons: card.buttons,
                icon: card.icon,
                linkLabel: card.linkLabel,
                linkUrl: card.linkUrl,
                tags: card.tags,
                showBorders: card.showBorders,
                src: card.imageSource,
                alt: card.imageAltText,
                cssClasses: ["w-100", "ws2-img"],
                loading: card.loading,
                decoding: "auto",
                fetchPriority: "auto",
                cardLink: card.linkUrl,
                captionTitle: card.linkLabel,
                caption: card.caption,
                captionTitle: card.captionTitle,
                border: card.showBorders,
                dropShadow: card.dropShadow,
                eventFormat: card.eventFormat,
                eventLocation: card.eventLocation,
                eventTime: card.eventTime,
                cardLink: card.linkUrl,
                caption: card.caption,
              })),
              cardType: arrangementData.cards[0].cardType,
            },
          });
        }
        else {
          // Fallback: render individual cards (existing behavior)
          arrangementData.cards.forEach(function(card) {
            if (card.cardType === "ranking") {
              unityReactCore.initRankingCard({
                targetSelector: "#card-" + card.id,
                props: {
                  imageSize: card.imageSize,
                  image: card.imageSource,
                  imageAlt: card.imageAltText,
                  heading: card.title,
                  body: card.content,
                  readMoreLink: card.linkUrl,
                  citation: card.citation,
                },
              });
            } else if (card.cardType === "image") {
              unityReactCore.initImage({
                targetSelector: "#card-" + card.id,
                props: {
                  src: card.imageSource,
                  alt: card.imageAltText,
                  cssClasses: ["w-100", "ws2-img"],
                  loading: card.loading,
                  decoding: "auto",
                  fetchPriority: "auto",
                  cardLink: card.linkUrl,
                  title: card.linkLabel,
                  caption: card.caption,
                  captionTitle: card.captionTitle,
                  border: card.showBorders,
                  dropShadow: card.dropShadow
                }
              });
            } else {
              unityReactCore.initCard({
                targetSelector: '#card-' + card.id,
                props: {
                  type: card.cardType,
                  horizontal: card.horizontal,
                  clickable: card.clickable,
                  clickHref: card.clickHref,
                  image: card.imageSource,
                  imageAltText: card.imageAltText,
                  title: card.title,
                  body: card.content,
                  buttons: card.buttons,
                  icon: card.icon,
                  linkLabel: card.linkLabel,
                  linkUrl: card.linkUrl,
                  tags: card.tags,
                  showBorders: card.showBorders,
                },
              });
            }
          });
        }

        delete settings.asu.components.card_arrangement[blockUuid];
      }
    }
  };
})(jQuery, Drupal, drupalSettings);
