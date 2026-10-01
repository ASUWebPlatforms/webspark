<?php

namespace Drupal\asu_editor_guardrails\Routing;

use Drupal\Core\Routing\RouteSubscriberBase;
use Symfony\Component\Routing\RouteCollection;

/**
 * Adds flood control to the ai_ckeditor request route.
 *
 * The upstream ai_ckeditor.do_request route has no rate limiting at all, so
 * any user with 'use ai ckeditor' can trigger unlimited billable LLM calls.
 *
 * Note on CSRF: the route also lacks `_csrf_token`, but the shipped client
 * (AiWriter.js) performs a plain `fetch()` with no token and only a
 * `Content-Type` header — it has no way to satisfy a `_csrf_token`
 * requirement, so adding one here would return 403 for every legitimate
 * request and break the feature entirely. Real CSRF hardening requires a
 * coordinated upstream patch (server route + client fetch call both
 * updated); until that exists, mitigation relies on the flood control added
 * here plus Drupal's default `SameSite=Lax` session cookie policy, which
 * blocks the classic cross-site cookie-bearing POST for most browsers. This
 * is a documented residual risk, not something silently "fixed" by this
 * module.
 */
class RouteSubscriber extends RouteSubscriberBase {

  /**
   * {@inheritdoc}
   */
  protected function alterRoutes(RouteCollection $collection) {
    $route = $collection->get('ai_ckeditor.do_request');
    if (!$route) {
      // ai_ckeditor is not installed; nothing to harden.
      return;
    }
    $route->setRequirement('_asu_editor_guardrails_flood', 'TRUE');
  }

}
