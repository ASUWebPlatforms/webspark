(function anchorMenu($, Drupal, once) {
  function isAllowedAnchorTargetId(id) {
    return (
      /^webspark-anchor-link--[0-9]+$/.test(id) ||
      /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?--[0-9]+$/.test(id)
    );
  }

  Drupal.behaviors.anchorMenu = {
    attach(context) {
      const menu = document.querySelector('#uds-anchor-menu');
      const nav = menu && menu.querySelector('nav');
      if (!nav) {
        return;
      }
      const hasTargets = document.querySelector('.webspark-anchor-link-data');
      if (!hasTargets) {
        return;
      }
      const menus = once('anchorMenuInit', '#uds-anchor-menu', context);
      const links = once(
        'append-anchor-menu-items',
        '.webspark-anchor-link-data',
        document,
      );

      const heading = document.querySelector('.uds-anchor-menu-wrapper h2');
      const section = heading ? heading.textContent.toLowerCase().trim() : '';
      let addedLink = false;

      links.forEach((item) => {
        const title = item.getAttribute('data-title') || '';
        const targetId = item.getAttribute('id') || '';
        if (title === '' || !isAllowedAnchorTargetId(targetId)) {
          return;
        }

        const link = document.createElement('a');
        link.className = 'nav-link';
        link.setAttribute('data-ga-event', 'link');
        link.setAttribute('data-ga-action', 'click');
        link.setAttribute('data-ga-name', 'onclick');
        link.setAttribute('data-ga-type', 'internal link');
        link.setAttribute('data-ga-region', 'main content');
        link.setAttribute('data-ga-component', '');
        link.setAttribute('data-ga-section', section);
        link.setAttribute('data-ga-text', title.toLowerCase());
        link.setAttribute('href', `#${targetId}`);

        const iconWrapper = document.createElement('span');
        const iconSource =
          item.parentElement &&
          item.parentElement.querySelector('.anchor-link-icon');
        if (iconSource) {
          Array.from(iconSource.childNodes).forEach((node) => {
            iconWrapper.appendChild(node.cloneNode(true));
          });
        }
        link.append(iconWrapper, document.createTextNode(title));
        nav.appendChild(link);
        addedLink = true;
      });

      if (addedLink || (menus.length && nav.querySelector('.nav-link'))) {
        $(menu).show();
        if (addedLink && once('anchorMenuUnityInit', menu).length) {
          // Give the React header time to render.
          setTimeout(() => {
            window.unityBootstrap.initAnchorMenu();
          }, 100);
        }
      }
    },
  };

  // Anchor menu logic relies on @asu/unity-bootstrap-theme in the Renovation theme
})(jQuery, Drupal, once);
