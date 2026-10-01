<?php

namespace Drupal\asu_degree_rfi;

use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Language\LanguageInterface;
use Drupal\Core\Logger\LoggerChannelFactoryInterface;
use Drupal\node\NodeInterface;
use Drupal\redirect\RedirectRepository;

/**
 * Unpublishes degree detail pages and creates offsite degree redirects.
 *
 * For each degree detail page the academic plan code
 * (field_degree_detail_acadplancode) is looked up against the Data Potluck
 * Academic Plan codeset to determine the plan's degreeType. The degreeType is
 * mapped to a degrees.asu.edu program type and a 301 redirect is created from
 * the node's public path to the offsite degree page. Existing redirects for
 * the same source are preserved (not overwritten).
 *
 * @see https://asudev.jira.com/wiki/spaces/DPL/pages/2796192305/Academic+Plan+codeset
 */
class AsuDegreeRfiDegreeRedirector {

  /**
   * The degree detail page content type machine name.
   */
  const DEGREE_DETAIL_BUNDLE = 'degree_detail_page';

  /**
   * The Academic Plan code field machine name.
   */
  const ACAD_PLAN_FIELD = 'field_degree_detail_acadplancode';

  /**
   * Base URL for the offsite degrees site.
   */
  const DESTINATION_BASE = 'https://degrees.apps.asu.edu';

  /**
   * Maps Data Potluck degreeType codes to degrees.asu.edu program types.
   *
   * - UG (Undergraduate degrees) => bachelors.
   * - GR (Graduate and Law) => masters-phd.
   * - UGCM (Non-graduate/non-law certificates and minors) => minors.
   *
   * The OTHR degreeType is intentionally unmapped: such plans cannot be turned
   * into a reliable degrees.asu.edu URL and are skipped.
   */
  const PROGRAM_TYPE_MAP = [
    'UG' => 'bachelors',
    'GR' => 'masters-phd',
    'UGCM' => 'minors',
  ];

  /**
   * Outcome: node had no academic plan code, left untouched.
   */
  const RESULT_SKIPPED_NO_PLANCODE = 'skipped_no_plancode';

  /**
   * Outcome: program type could not be resolved, node left untouched.
   */
  const RESULT_SKIPPED_NO_TYPE = 'skipped_no_type';

  /**
   * Outcome: a redirect already existed for the source; node unpublished.
   */
  const RESULT_REDIRECT_EXISTS = 'redirect_exists';

  /**
   * Outcome: a new redirect was created; node unpublished.
   */
  const RESULT_REDIRECTED = 'redirected';

  /**
   * The entity type manager.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected $entityTypeManager;

  /**
   * The ASU Degree RFI Data Potluck client.
   *
   * @var \Drupal\asu_degree_rfi\AsuDegreeRfiDataPotluckClient
   */
  protected $dataPotluckClient;

  /**
   * The redirect repository.
   *
   * @var \Drupal\redirect\RedirectRepository
   */
  protected $redirectRepository;

  /**
   * The logger channel.
   *
   * @var \Drupal\Core\Logger\LoggerChannelInterface
   */
  protected $logger;

  /**
   * Static cache of degreeType lookups keyed by academic plan code.
   *
   * @var array
   */
  protected $degreeTypeCache = [];

  /**
   * Constructs an AsuDegreeRfiDegreeRedirector object.
   *
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   The entity type manager.
   * @param \Drupal\asu_degree_rfi\AsuDegreeRfiDataPotluckClient $data_potluck_client
   *   The ASU Degree RFI Data Potluck client.
   * @param \Drupal\redirect\RedirectRepository $redirect_repository
   *   The redirect repository.
   * @param \Drupal\Core\Logger\LoggerChannelFactoryInterface $logger_factory
   *   The logger channel factory.
   */
  public function __construct(EntityTypeManagerInterface $entity_type_manager, AsuDegreeRfiDataPotluckClient $data_potluck_client, RedirectRepository $redirect_repository, LoggerChannelFactoryInterface $logger_factory) {
    $this->entityTypeManager = $entity_type_manager;
    $this->dataPotluckClient = $data_potluck_client;
    $this->redirectRepository = $redirect_repository;
    $this->logger = $logger_factory->get('asu_degree_rfi');
  }

  /**
   * Returns the IDs of all degree detail page nodes.
   *
   * @return int[]
   *   An array of node IDs.
   */
  public function getDegreeDetailNids() {
    return array_values($this->entityTypeManager->getStorage('node')->getQuery()
      ->condition('type', self::DEGREE_DETAIL_BUNDLE)
      ->accessCheck(FALSE)
      ->execute());
  }

  /**
   * Maps a Data Potluck degreeType code to a degrees.asu.edu program type.
   *
   * @param string|null $degree_type
   *   The Data Potluck degreeType code.
   *
   * @return string|null
   *   The program type ('bachelors', 'masters-phd', 'minors'), or NULL if the
   *   degreeType is unknown/unmapped.
   */
  public function mapProgramType($degree_type) {
    if ($degree_type === NULL) {
      return NULL;
    }
    return self::PROGRAM_TYPE_MAP[$degree_type] ?? NULL;
  }

  /**
   * Builds the offsite degree page destination URL.
   *
   * @param string $program_type
   *   The degrees.asu.edu program type.
   * @param string $plancode
   *   The academic plan code.
   *
   * @return string
   *   The absolute destination URL.
   */
  public function buildDestinationUrl($program_type, $plancode) {
    return sprintf('%s/%s/major/ASU00/%s', self::DESTINATION_BASE, $program_type, $plancode);
  }

  /**
   * Resolves (and statically caches) the degreeType for a plan code.
   *
   * @param string $plancode
   *   The academic plan code.
   *
   * @return string|null
   *   The degreeType code, or NULL if it could not be resolved.
   */
  protected function resolveDegreeType($plancode) {
    if (!array_key_exists($plancode, $this->degreeTypeCache)) {
      $this->degreeTypeCache[$plancode] = $this->dataPotluckClient->getDegreeTypeByAcadPlan($plancode);
    }
    return $this->degreeTypeCache[$plancode];
  }

  /**
   * Ensures a redirect is in place and unpublishes a degree detail node.
   *
   * The node is only unpublished once a redirect is confirmed in place (either
   * newly created or already existing). Nodes whose program type cannot be
   * resolved are left untouched so they can be re-processed or handled
   * manually; this keeps the operation safe and idempotent.
   *
   * @param \Drupal\node\NodeInterface $node
   *   The degree detail page node.
   *
   * @return string
   *   One of the RESULT_* constants describing the outcome.
   */
  public function processNode(NodeInterface $node) {
    $plancode = trim((string) $node->get(self::ACAD_PLAN_FIELD)->value);
    if ($plancode === '') {
      $this->logger->warning('Degree detail node @nid has no academic plan code; skipped.', [
        '@nid' => $node->id(),
      ]);
      return self::RESULT_SKIPPED_NO_PLANCODE;
    }

    $degree_type = $this->resolveDegreeType($plancode);
    $program_type = $this->mapProgramType($degree_type);
    if ($program_type === NULL) {
      $this->logger->warning('Could not resolve a program type for node @nid (plan code @pc, degreeType @dt); skipped.', [
        '@nid' => $node->id(),
        '@pc' => $plancode,
        '@dt' => $degree_type ?? 'none',
      ]);
      return self::RESULT_SKIPPED_NO_TYPE;
    }

    $destination = $this->buildDestinationUrl($program_type, $plancode);

    // Use the internal system path as the redirect source. The redirect module
    // runs inbound path processing (alias -> system path) before matching, so a
    // source keyed on node/{nid} matches requests to both the alias and the
    // canonical path. A source keyed on the alias would never match because the
    // incoming alias is resolved to node/{nid} before the redirect lookup runs.
    $source = 'node/' . $node->id();

    // Guard against an existing redirect for this source: do not create a
    // duplicate or overwrite a manually configured redirect.
    $existing = $this->redirectRepository->findMatchingRedirect($source);
    $result = self::RESULT_REDIRECT_EXISTS;
    if (!$existing) {
      /** @var \Drupal\redirect\Entity\Redirect $redirect */
      $redirect = $this->entityTypeManager->getStorage('redirect')->create();
      $redirect->setSource($source);
      $redirect->setRedirect($destination);
      $redirect->setStatusCode(301);
      $redirect->setLanguage(LanguageInterface::LANGCODE_NOT_SPECIFIED);
      $redirect->save();
      $result = self::RESULT_REDIRECTED;
      $this->logger->notice('Created 301 redirect from /@source to @dest for degree detail node @nid.', [
        '@source' => $source,
        '@dest' => $destination,
        '@nid' => $node->id(),
      ]);
    }

    // Unpublish the node now that a redirect is in place.
    if ($node->isPublished()) {
      $node->setUnpublished();
      $node->save();
    }

    return $result;
  }

}
