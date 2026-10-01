<?php

namespace Drupal\asu_editor_guardrails\EventSubscriber;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Entity\EntityPublishedInterface;
use Drupal\Core\Flood\FloodInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\Core\Session\AnonymousUserSession;
use Drupal\ai_automators\Event\ShouldProcessFieldEvent;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Vetoes ai_automators processing for unpublished/inaccessible entities.
 *
 * Ai_automators has no publish/access gate at all: an automator attached to
 * a bundle runs (and sends field content, including image binaries,
 * externally) for any save regardless of the entity's published/moderation
 * state. This subscriber uses the module's own supported
 * ai_automator.should_process_field event to veto processing before the
 * external call happens, rather than patching contrib code. It also
 * throttles automator re-triggers on repeated saves of the same
 * entity/field, regardless of the rule's `edit_mode` setting (see the
 * class doc on `automator_cooldown` in asu_editor_guardrails.settings for
 * why `edit_mode` alone is not a reliable signal).
 */
class AutomatorGuardrailSubscriber implements EventSubscriberInterface {

  /**
   * Fallback cooldown, in seconds, used if config is missing.
   */
  protected const DEFAULT_COOLDOWN = 300;

  /**
   * Fallback per-user limit used if config is missing.
   */
  protected const DEFAULT_USER_LIMIT = 20;

  /**
   * Fallback per-user window, in seconds, used if config is missing.
   */
  protected const DEFAULT_USER_WINDOW = 300;

  public function __construct(
    protected FloodInterface $flood,
    protected ConfigFactoryInterface $configFactory,
    protected AccountInterface $currentUser,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [
      ShouldProcessFieldEvent::EVENT_NAME => 'onShouldProcessField',
    ];
  }

  /**
   * Vetoes processing for unpublished/inaccessible entities.
   *
   * Also throttles automator re-triggers on repeated saves (see
   * `automator_cooldown` below).
   */
  public function onShouldProcessField(ShouldProcessFieldEvent $event): void {
    if (!$event->shouldProcess()) {
      // Already skipped for another reason; nothing to add.
      return;
    }

    $entity = $event->getEntity();

    // Never send unpublished content externally.
    if ($entity instanceof EntityPublishedInterface && !$entity->isPublished()) {
      $event->setShouldProcess(FALSE);
      return;
    }

    // Best-effort check that the content would be visible to the public
    // before it's visible to the public: if an anonymous visitor could not
    // view this entity (access-restricted, embargoed, workflow-gated,
    // etc.), don't let its content leave the site via the AI provider yet.
    // Fail closed (skip processing) if the access check itself throws,
    // rather than letting one bundle's broken access hook break saves
    // site-wide.
    $anonymous = new AnonymousUserSession();
    try {
      $accessible = $entity->access('view', $anonymous);
    }
    catch (\Throwable $e) {
      \Drupal::logger('asu_editor_guardrails')->error('Access check failed for @type @id, skipping automator processing: @msg', [
        '@type' => $entity->getEntityTypeId(),
        '@id' => $entity->id() ?? 'new',
        '@msg' => $e->getMessage(),
      ]);
      $event->setShouldProcess(FALSE);
      return;
    }
    if (!$accessible) {
      $event->setShouldProcess(FALSE);
      return;
    }

    $config = $this->configFactory->get('asu_editor_guardrails.settings');

    // Throttle automator re-triggers: without this, a trivial repeated save
    // re-triggers a full, synchronous, billable LLM call with no cooldown —
    // for ComplexTextChat-based rules this happens on EVERY save, not just
    // edit_mode ones, so the check below is intentionally unconditional.
    // Some rule base classes (e.g. ComplexTextChat, used by
    // llm_text_create_summary) regenerate on every entity save regardless
    // of `edit_mode` — their checkIfEmpty()/storeValues() never check it at
    // all — so gating the cooldown on `edit_mode` alone leaves those rules
    // with zero throttling. A single unconditional cooldown covers both
    // cases: rules that self-limit via checkIfEmpty() are unaffected in
    // practice (they don't re-trigger on unchanged saves anyway), and rules
    // that don't self-limit are now bounded regardless of edit_mode.
    //
    // This alone does not bound total cost (see automator_user_limit
    // below) — the entity-keyed bucket can be reset by deleting and
    // recreating the entity, so it only prevents rapid re-triggering of
    // the *same* content. The identifier is pinned to an empty string
    // (rather than left to default to the requester's IP) so the bucket is
    // scoped purely to the entity+field key, not inadvertently
    // partitioned per source IP.
    $cooldown = (int) ($config->get('automator_cooldown') ?? self::DEFAULT_COOLDOWN);
    // Flood's `event` column is a 64-char varchar; entity type/bundle/field
    // machine names concatenated directly can exceed that under MySQL
    // strict mode, so hash the variable part instead of inlining it.
    $entity_key = implode(':', [
      $entity->getEntityTypeId(),
      $entity->bundle(),
      $entity->id() ?? 'new',
      $event->getFieldDefinition()->getName(),
    ]);
    $flood_key = 'asu_editor_guardrails.automator_cooldown.' . hash('crc32b', $entity_key);

    if (!$this->flood->isAllowed($flood_key, 1, $cooldown, '')) {
      $event->setShouldProcess(FALSE);
      return;
    }

    // Per-user cap: backstops the cooldown above even if the entity/field
    // key is rotated by deleting and recreating the entity. This cap is
    // keyed per-user instead, so it bounds one actor's total spend
    // regardless of how many distinct entities they cycle through. Note:
    // anonymous requests all share uid '0', so this becomes one sitewide
    // bucket for anonymous saves rather than a per-visitor one —
    // acceptable (it's more restrictive, not a bypass) unless anonymous
    // users can actually trigger automator-eligible saves on this site,
    // which is not expected.
    $user_limit = (int) ($config->get('automator_user_limit') ?? self::DEFAULT_USER_LIMIT);
    $user_window = (int) ($config->get('automator_user_window') ?? self::DEFAULT_USER_WINDOW);
    $user_key = 'asu_editor_guardrails.automator_cooldown_user';
    $uid = (string) $this->currentUser->id();
    if (!$this->flood->isAllowed($user_key, $user_limit, $user_window, $uid)) {
      $event->setShouldProcess(FALSE);
      return;
    }

    $this->flood->register($flood_key, $cooldown, '');
    $this->flood->register($user_key, $user_window, $uid);
  }

}
