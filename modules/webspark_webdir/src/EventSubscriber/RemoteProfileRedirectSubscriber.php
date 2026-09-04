<?php

declare(strict_types=1);

namespace Drupal\webspark_webdir\EventSubscriber;

use Drupal\Core\Routing\RouteMatchInterface;
use Drupal\webspark_webdir\Entity\Profile;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Drupal\Core\Routing\TrustedRedirectResponse;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Redirects remote profile canonical pages to search.asu.edu.
 *
 * When a visitor navigates to /profile/{id} for a profile whose type is
 * "from_directory", they are redirected to the corresponding ASU Search
 * profile page instead of seeing the local entity page.
 */
class RemoteProfileRedirectSubscriber implements EventSubscriberInterface {

  /**
   * The current route match.
   *
   * @var \Drupal\Core\Routing\RouteMatchInterface
   */
  protected RouteMatchInterface $routeMatch;

  /**
   * Constructs a RemoteProfileRedirectSubscriber.
   *
   * @param \Drupal\Core\Routing\RouteMatchInterface $route_match
   *   The current route match service.
   */
  public function __construct(RouteMatchInterface $route_match) {
    $this->routeMatch = $route_match;
  }

  /**
   * Redirects remote profiles to search.asu.edu.
   *
   * @param \Symfony\Component\HttpKernel\Event\RequestEvent $event
   *   The request event.
   */
  public function onKernelRequest(RequestEvent $event): void {
    if (!$event->isMainRequest()) {
      return;
    }

    $route_name = $this->routeMatch->getRouteName();
    if ($route_name !== 'entity.asu_profile.canonical') {
      return;
    }

    $profile = $this->routeMatch->getParameter('asu_profile');
    if (!$profile instanceof Profile) {
      return;
    }

    $profile_type = $profile->get('profile_type')->value ?? '';
    if ($profile_type !== 'from_directory') {
      return;
    }

    $asurite = $profile->get('asurite')->value ?? '';
    if (empty($asurite)) {
      return;
    }

    $redirect_url = 'https://search.asu.edu/profile/' . urlencode($asurite);
    $response = new TrustedRedirectResponse($redirect_url, 301);
    $event->setResponse($response);
  }

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    // Priority must be lower than the router listener (32) so the route
    // is already matched, but higher than the page cache (27).
    return [
      KernelEvents::REQUEST => ['onKernelRequest', 28],
    ];
  }

}
