<?php

namespace Drupal\asu_editor_guardrails\Access;

use Drupal\Core\Access\AccessResult;
use Drupal\Core\Access\AccessResultInterface;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Flood\FloodInterface;
use Drupal\Core\Routing\Access\AccessInterface;
use Drupal\Core\Session\AccountInterface;
use Symfony\Component\Routing\Route;

/**
 * Rate-limits calls to the ai_ckeditor request endpoint.
 *
 * There is no built-in throttle on ai_ckeditor.do_request: any user holding
 * 'use ai ckeditor' can otherwise trigger unlimited billable LLM calls in a
 * tight loop.
 */
class CkeditorFloodAccessCheck implements AccessInterface {

  /**
   * Fallback rate limit used if config is missing (e.g. not yet imported).
   */
  protected const DEFAULT_LIMIT = 30;

  /**
   * Fallback window, in seconds, used if config is missing.
   */
  protected const DEFAULT_WINDOW = 300;

  public function __construct(
    protected FloodInterface $flood,
    protected ConfigFactoryInterface $configFactory,
  ) {}

  /**
   * Checks flood control for the given route/account.
   */
  public function access(Route $route, AccountInterface $account): AccessResultInterface {
    $config = $this->configFactory->get('asu_editor_guardrails.settings');
    // Fall back to defaults if config is missing (not an import failure):
    // an unset value should not silently lock out every CKEditor request.
    $limit = (int) ($config->get('ckeditor_limit') ?? self::DEFAULT_LIMIT);
    $window = (int) ($config->get('ckeditor_window') ?? self::DEFAULT_WINDOW);
    $flood_key = 'asu_editor_guardrails.ckeditor_request';

    if (!$this->flood->isAllowed($flood_key, $limit, $window, (string) $account->id())) {
      return AccessResult::forbidden('AI CKEditor request rate limit exceeded.')
        ->setCacheMaxAge(0);
    }

    $this->flood->register($flood_key, $window, (string) $account->id());

    return AccessResult::allowed()->setCacheMaxAge(0);
  }

}
