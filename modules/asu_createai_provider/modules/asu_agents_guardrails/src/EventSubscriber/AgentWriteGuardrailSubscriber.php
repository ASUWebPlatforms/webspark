<?php

namespace Drupal\asu_agents_guardrails\EventSubscriber;

use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Flood\FloodInterface;
use Drupal\Core\Session\AccountInterface;
use Drupal\ai_agents\Event\AgentToolFinishedExecutionEvent;
use Drupal\ai_agents\Event\AgentToolPreExecuteEvent;
use Psr\Log\LoggerInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

/**
 * Adds rate limiting and audit logging to ai_agents' write-capable tools.
 *
 * Every write-capable tool shipped by ai_agents' auto-installed agents
 * (Taxonomy, Content Type, Field) ships with no rate limiting and no audit
 * trail of their own — each independently checks the acting user's Drupal
 * permissions before writing, but nothing bounds how many changes one user
 * can trigger, and nothing records what an LLM-driven agent actually did.
 * Vocabularies/terms/content types/fields have no revision history in
 * Drupal core, so an agent-driven change is otherwise only visible in the
 * (possibly ephemeral) chat transcript. This subscriber uses the module's
 * own supported ai_agents.tool_pre_executed / ai_agents.tool_finished_executed
 * events — no contrib patching required.
 */
class AgentWriteGuardrailSubscriber implements EventSubscriberInterface {

  /**
   * Plugin IDs of the write-capable tools this subscriber guards.
   *
   * Covers all three of ai_agents' default-installed agents reviewed so
   * far (Taxonomy, Content Type, Field). If any future agent/tool is
   * enabled on this site, it must be security-reviewed and added here
   * before being considered guarded — this is an explicit allowlist, not a
   * catch-all.
   */
  protected const WRITE_TOOLS = [
    // Taxonomy Agent.
    'ai_agent:modify_vocabulary',
    'ai_agent:modify_taxonomy_term',
    // Content Type Agent.
    'ai_agent:create_content_type',
    'ai_agent:edit_content_type',
    // Field Agent.
    'ai_agent:create_field_storage_config',
    'ai_agent:manipulate_field_config',
    'ai_agent:manipulate_field_display_form',
  ];

  /**
   * Fallback rate limit used if config is missing (e.g. not yet imported).
   */
  protected const DEFAULT_LIMIT = 20;

  /**
   * Fallback window, in seconds, used if config is missing.
   */
  protected const DEFAULT_WINDOW = 300;

  public function __construct(
    protected FloodInterface $flood,
    protected LoggerInterface $logger,
    protected AccountInterface $currentUser,
    protected ConfigFactoryInterface $configFactory,
  ) {}

  /**
   * {@inheritdoc}
   */
  public static function getSubscribedEvents(): array {
    return [
      AgentToolPreExecuteEvent::EVENT_NAME => 'onPreExecute',
      AgentToolFinishedExecutionEvent::EVENT_NAME => 'onFinished',
    ];
  }

  /**
   * Rate-limits the write tools before they execute.
   *
   * @throws \RuntimeException
   *   If the acting user has exceeded the configured limit within the
   *   configured window.
   */
  public function onPreExecute(AgentToolPreExecuteEvent $event): void {
    if (!in_array($event->getTool()->getPluginId(), self::WRITE_TOOLS, TRUE)) {
      return;
    }

    $config = $this->configFactory->get('asu_agents_guardrails.settings');
    // Fall back to defaults if config is missing (not an import failure):
    // an unset value should not silently lock out every write tool.
    $limit = (int) ($config->get('write_limit') ?? self::DEFAULT_LIMIT);
    $window = (int) ($config->get('write_window') ?? self::DEFAULT_WINDOW);

    $flood_key = 'asu_agents_guardrails.agent_write';
    $uid = (string) $this->currentUser->id();
    if (!$this->flood->isAllowed($flood_key, $limit, $window, $uid)) {
      // Log the rejection explicitly: AgentToolFinishedExecutionEvent only
      // fires after a tool's execute() returns successfully, so a blocked
      // attempt would otherwise leave no audit trail at all — precisely the
      // case an operator most wants visibility into.
      $this->logger->warning('Blocked @tool for uid @uid: rate limit exceeded.', [
        '@tool' => $event->getTool()->getPluginId(),
        '@uid' => $uid,
      ]);
      // Fail closed: reject the tool call before it can write anything.
      throw new \RuntimeException('Too many AI-driven site changes; please wait a few minutes and try again.');
    }
    $this->flood->register($flood_key, $window, $uid);
  }

  /**
   * Logs a durable audit trail for the write tools once they've run.
   *
   * Note: this only fires on successful execution (AgentToolFinishedExecutionEvent
   * is dispatched only after execute() returns without throwing) — a tool-level
   * failure (e.g. its own permission check, or a save/validation error) is not
   * captured here. The flood-rejection case is logged separately in
   * onPreExecute() above; other failure modes remain a known gap, since
   * ai_agents doesn't wrap execute() in a try/finally that this module could
   * hook into.
   */
  public function onFinished(AgentToolFinishedExecutionEvent $event): void {
    if (!in_array($event->getTool()->getPluginId(), self::WRITE_TOOLS, TRUE)) {
      return;
    }

    $this->logger->notice('Agent @agent ran @tool for uid @uid: @output', [
      '@agent' => $event->getAgentId(),
      '@tool' => $event->getTool()->getPluginId(),
      '@uid' => $this->currentUser->id(),
      '@output' => $event->getTool()->getReadableOutput(),
    ]);
  }

}
