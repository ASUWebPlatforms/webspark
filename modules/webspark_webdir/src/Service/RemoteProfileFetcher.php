<?php

declare(strict_types=1);

namespace Drupal\webspark_webdir\Service;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\webspark_webdir\WebdirApiUrl;
use GuzzleHttp\ClientInterface;
use Psr\Log\LoggerInterface;

/**
 * Fetches remote profile data from the ASU Search API with 24-hour caching.
 */
class RemoteProfileFetcher {

  /**
   * Cache lifetime in seconds (24 hours).
   */
  const CACHE_LIFETIME = 86400;

  /**
   * The HTTP client.
   *
   * @var \GuzzleHttp\ClientInterface
   */
  protected ClientInterface $httpClient;

  /**
   * The config factory.
   *
   * @var \Drupal\Core\Config\ConfigFactoryInterface
   */
  protected ConfigFactoryInterface $configFactory;

  /**
   * The cache backend.
   *
   * @var \Drupal\Core\Cache\CacheBackendInterface
   */
  protected CacheBackendInterface $cache;

  /**
   * The logger.
   *
   * @var \Psr\Log\LoggerInterface
   */
  protected LoggerInterface $logger;

  /**
   * The API URL builder.
   *
   * @var \Drupal\webspark_webdir\WebdirApiUrl
   */
  protected WebdirApiUrl $apiUrl;

  /**
   * Constructs a RemoteProfileFetcher object.
   *
   * @param \GuzzleHttp\ClientInterface $http_client
   *   The HTTP client.
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The config factory.
   * @param \Drupal\Core\Cache\CacheBackendInterface $cache
   *   The cache backend.
   * @param \Psr\Log\LoggerInterface $logger
   *   The logger channel.
   * @param \Drupal\webspark_webdir\WebdirApiUrl $api_url
   *   The API URL builder.
   */
  public function __construct(
    ClientInterface $http_client,
    ConfigFactoryInterface $config_factory,
    CacheBackendInterface $cache,
    LoggerInterface $logger,
    WebdirApiUrl $api_url,
  ) {
    $this->httpClient = $http_client;
    $this->configFactory = $config_factory;
    $this->cache = $cache;
    $this->logger = $logger;
    $this->apiUrl = $api_url;
  }

  /**
   * Fetches profile data for an ASURITE ID, using cached data if available.
   *
   * @param string $asurite_id
   *   The ASURITE ID to look up.
   *
   * @return array|null
   *   An associative array of profile field data keyed by Profile entity field
   *   names, or NULL if the profile could not be fetched.
   */
  public function fetchProfile(string $asurite_id): ?array {
    $cid = $this->getCacheId($asurite_id);
    $cached = $this->cache->get($cid);

    if ($cached) {
      return $cached->data;
    }

    return $this->doFetch($asurite_id);
  }

  /**
   * Forces a fresh fetch of profile data, bypassing any cached version.
   *
   * @param string $asurite_id
   *   The ASURITE ID to look up.
   *
   * @return array|null
   *   An associative array of profile field data keyed by Profile entity field
   *   names, or NULL if the profile could not be fetched.
   */
  public function refreshProfile(string $asurite_id): ?array {
    $this->cache->delete($this->getCacheId($asurite_id));
    return $this->doFetch($asurite_id);
  }

  /**
   * Checks whether the cached profile data for an ASURITE ID is still fresh.
   *
   * @param string $asurite_id
   *   The ASURITE ID to check.
   *
   * @return bool
   *   TRUE if valid cached data exists, FALSE otherwise.
   */
  public function isCacheFresh(string $asurite_id): bool {
    $cached = $this->cache->get($this->getCacheId($asurite_id));
    return $cached !== FALSE;
  }

  /**
   * Fetches raw affiliation data for an ASURITE ID.
   *
   * Returns the titles, departments, and deptids arrays along with primary
   * values for building the affiliation selector.
   *
   * @param string $asurite_id
   *   The ASURITE ID to look up.
   *
   * @return array|null
   *   An array with keys: primary_title, primary_department, primary_deptid,
   *   titles, departments, deptids. Or NULL on failure/not found.
   */
  public function fetchAffiliations(string $asurite_id): ?array {
    $config = $this->configFactory->get('webspark_webdir.settings');
    $endpoint_path = $config->get('filtered_people_department');

    if (empty($endpoint_path)) {
      $this->logger->error('The filtered_people_department config value is not set in webspark_webdir.settings.');
      return NULL;
    }

    $url = $this->apiUrl->getUrlBase() . $endpoint_path
      . '?asurite_ids=' . urlencode($asurite_id);

    try {
      $response = $this->httpClient->request('GET', $url, [
        'timeout' => 10,
        'connect_timeout' => 5,
      ]);

      $body = $response->getBody()->getContents();
      $data = json_decode($body, TRUE);

      if (json_last_error() !== JSON_ERROR_NONE) {
        return NULL;
      }

      $results = $data['results'] ?? [];
      if (!is_array($results) || empty($results)) {
        return NULL;
      }

      // Find the matching result.
      $match = NULL;
      foreach ($results as $result) {
        $meta_id = $result['_meta']['id'] ?? '';
        $result_asurite = $this->unwrapRaw($result['asurite_id'] ?? NULL);
        if ($meta_id === $asurite_id || $result_asurite === $asurite_id) {
          $match = $result;
          break;
        }
      }
      if ($match === NULL && count($results) === 1) {
        $match = $results[0];
      }
      if ($match === NULL) {
        return NULL;
      }

      // Extract affiliation arrays. These are raw arrays (not wrapped).
      $primary_title = $this->unwrapRaw($match['primary_title'] ?? $match['working_title'] ?? NULL);
      $primary_department = $this->unwrapRaw($match['primary_department'] ?? NULL);
      $primary_deptid = $this->unwrapRaw($match['primary_deptid'] ?? NULL);

      // The titles, departments, deptids arrays.
      $titles = $this->unwrapRawArray($match['titles'] ?? $match['working_title'] ?? NULL);
      $departments = $this->unwrapRawArray($match['departments'] ?? NULL);
      $deptids = $this->unwrapRawArray($match['deptids'] ?? NULL);

      return [
        'primary_title' => $primary_title,
        'primary_department' => $primary_department,
        'primary_deptid' => $primary_deptid,
        'titles' => $titles,
        'departments' => $departments,
        'deptids' => $deptids,
      ];
    }
    catch (\Exception $e) {
      $this->logger->error('Error fetching affiliations for ASURITE @id: @message', [
        '@id' => $asurite_id,
        '@message' => $e->getMessage(),
      ]);
      return NULL;
    }
  }

  /**
   * Unwraps a raw value that should be an array.
   *
   * @param mixed $value
   *   The value to unwrap.
   *
   * @return array
   *   The unwrapped array, or empty array.
   */
  protected function unwrapRawArray(mixed $value): array {
    if ($value === NULL) {
      return [];
    }

    // Unwrap the { "raw": ... } envelope.
    if (is_array($value) && array_key_exists('raw', $value)) {
      $value = $value['raw'];
    }

    if (is_array($value)) {
      return array_map(fn($item) => (string) ($item ?? ''), $value);
    }

    // Single value — return as single-element array.
    return ($value !== NULL && $value !== '') ? [(string) $value] : [];
  }

  /**
   * Builds the affiliation select options from raw affiliation data.
   *
   * @param array $affiliations
   *   The affiliation data from fetchAffiliations().
   *
   * @return array
   *   An array of options keyed by deptid, with values like
   *   "Title — Department". Primary affiliation is listed first.
   */
  public function buildAffiliationOptions(array $affiliations): array {
    $options = [];
    $primary_deptid = $affiliations['primary_deptid'] ?? '';
    $primary_title = $affiliations['primary_title'] ?? '';
    $primary_department = $affiliations['primary_department'] ?? '';

    // Add primary as the first option.
    if (!empty($primary_deptid)) {
      $options[$primary_deptid] = $primary_title . ' — ' . $primary_department;
    }

    // Add remaining affiliations, filtering out duplicates of primary.
    $titles = $affiliations['titles'] ?? [];
    $departments = $affiliations['departments'] ?? [];
    $deptids = $affiliations['deptids'] ?? [];

    $count = min(count($titles), count($departments), count($deptids));
    for ($i = 0; $i < $count; $i++) {
      $deptid = $deptids[$i] ?? '';
      if (empty($deptid) || isset($options[$deptid])) {
        continue;
      }
      $title = $titles[$i] ?? '';
      $dept = $departments[$i] ?? '';
      $options[$deptid] = $title . ' — ' . $dept;
    }

    return $options;
  }

  /**
   * Performs the actual API request, normalizes, maps, and caches the result.
   *
   * @param string $asurite_id
   *   The ASURITE ID to look up.
   *
   * @return array|null
   *   Mapped profile data or NULL on failure.
   */
  protected function doFetch(string $asurite_id): ?array {
    $config = $this->configFactory->get('webspark_webdir.settings');
    $endpoint_path = $config->get('filtered_people_department');

    if (empty($endpoint_path)) {
      $this->logger->error('The filtered_people_department config value is not set in webspark_webdir.settings.');
      return NULL;
    }

    $url = $this->apiUrl->getUrlBase() . $endpoint_path
      . '?asurite_ids=' . urlencode($asurite_id);

    try {
      $response = $this->httpClient->request('GET', $url, [
        'timeout' => 10,
        'connect_timeout' => 5,
      ]);

      $body = $response->getBody()->getContents();
      $data = json_decode($body, TRUE);

      if (json_last_error() !== JSON_ERROR_NONE) {
        $this->logger->error('Invalid JSON response for ASURITE @id: @error', [
          '@id' => $asurite_id,
          '@error' => json_last_error_msg(),
        ]);
        return NULL;
      }

      $normalized = $this->extractAndNormalize($data, $asurite_id);
      if ($normalized === NULL) {
        $this->logger->warning('Profile not found in API response for ASURITE @id.', [
          '@id' => $asurite_id,
        ]);
        return NULL;
      }

      $mapped = $this->mapToEntityFields($normalized);

      // Cache the mapped data with a 24-hour expiry.
      $this->cache->set(
        $this->getCacheId($asurite_id),
        $mapped,
        \Drupal::time()->getRequestTime() + self::CACHE_LIFETIME,
        ['webspark_webdir:remote_profile:' . $asurite_id]
      );

      return $mapped;
    }
    catch (\Exception $e) {
      $this->logger->error('Error fetching remote profile for ASURITE @id: @message', [
        '@id' => $asurite_id,
        '@message' => $e->getMessage(),
      ]);
      return NULL;
    }
  }

  /**
   * Extracts and normalizes a single profile from the API response.
   *
   * The API returns data wrapped in { "raw": value } envelopes. This method
   * finds the matching result and unwraps all fields.
   *
   * @param array $data
   *   The decoded API response body.
   * @param string $asurite_id
   *   The ASURITE ID to match.
   *
   * @return array|null
   *   An associative array of unwrapped API field values, or NULL if not found.
   */
  protected function extractAndNormalize(array $data, string $asurite_id): ?array {
    $results = $data['results'] ?? [];

    if (!is_array($results)) {
      return NULL;
    }

    $match = NULL;

    // Find the result matching the ASURITE ID.
    foreach ($results as $result) {
      $meta_id = $result['_meta']['id'] ?? '';
      $result_asurite = $this->unwrapRaw($result['asurite_id'] ?? NULL);

      if ($meta_id === $asurite_id || $result_asurite === $asurite_id) {
        $match = $result;
        break;
      }
    }

    // If only one result, use it.
    if ($match === NULL && count($results) === 1) {
      $match = $results[0];
    }

    if ($match === NULL) {
      return NULL;
    }

    // Unwrap all fields from the { "raw": value } envelope.
    return [
      'asurite_id' => $match['_meta']['id'] ?? $this->unwrapRaw($match['asurite_id'] ?? NULL),
      'display_name' => $this->unwrapRaw($match['display_name'] ?? NULL),
      'first_name' => $this->unwrapRaw($match['first_name'] ?? NULL),
      'display_last_name' => $this->unwrapRaw($match['display_last_name'] ?? NULL),
      'photo_url' => $this->unwrapRaw($match['photo_url'] ?? NULL),
      'working_title' => $this->unwrapRaw($match['working_title'] ?? NULL),
      'primary_department' => $this->unwrapRaw($match['primary_department'] ?? NULL),
      'email_address' => $this->unwrapRaw($match['email_address'] ?? NULL),
      'phone' => $this->unwrapRaw($match['phone'] ?? NULL),
      'campus_address' => $this->unwrapRaw($match['campus_address'] ?? NULL),
      'city' => $this->unwrapRaw($match['city'] ?? NULL),
      'state' => $this->unwrapRaw($match['state'] ?? NULL),
      'zip' => $this->unwrapRaw($match['postal'] ?? $match['zip'] ?? NULL),
      'bio' => $this->unwrapRaw($match['bio'] ?? NULL),
      'short_bio' => $this->unwrapRaw($match['short_bio'] ?? NULL),
      'facebook' => $this->unwrapRaw($match['facebook'] ?? NULL),
      'linkedin' => $this->unwrapRaw($match['linkedin'] ?? NULL),
      'twitter' => $this->unwrapRaw($match['twitter'] ?? NULL),
      'website' => $this->unwrapRaw($match['website'] ?? NULL),
    ];
  }

  /**
   * Unwraps a value from the API's { "raw": ... } envelope.
   *
   * If the unwrapped value is an array, the first non-null element is returned.
   *
   * @param mixed $value
   *   The value to unwrap.
   *
   * @return string
   *   The unwrapped scalar value, or an empty string.
   */
  protected function unwrapRaw(mixed $value): string {
    if ($value === NULL) {
      return '';
    }

    // Unwrap the { "raw": ... } envelope.
    if (is_array($value) && array_key_exists('raw', $value)) {
      $value = $value['raw'];
    }

    // If the raw value is an array, get the first non-null element.
    if (is_array($value)) {
      foreach ($value as $item) {
        if ($item !== NULL && $item !== '') {
          return (string) $item;
        }
      }
      return '';
    }

    return ($value !== NULL && $value !== '') ? (string) $value : '';
  }

  /**
   * Maps normalized API data to Profile entity field names.
   *
   * @param array $normalized
   *   The normalized API data from extractAndNormalize().
   *
   * @return array
   *   An associative array keyed by Profile entity field names.
   */
  protected function mapToEntityFields(array $normalized): array {
    $mapped = [
      'name' => $normalized['display_name'] ?? '',
      'first_name' => $normalized['first_name'] ?? '',
      'display_last_name' => $normalized['display_last_name'] ?? '',
      'image_url' => $normalized['photo_url'] ?? '',
      'title_field' => $normalized['working_title'] ?? '',
      'department' => $normalized['primary_department'] ?? '',
      'email' => $normalized['email_address'] ?? '',
      'phone' => $normalized['phone'] ?? '',
      'street_address' => $normalized['campus_address'] ?? '',
      'city' => $normalized['city'] ?? '',
      'state' => $normalized['state'] ?? '',
      'zip' => $normalized['zip'] ?? '',
      'bio' => $normalized['bio'] ?? '',
      'short_bio' => $normalized['short_bio'] ?? '',
    ];

    // Social media links: only set if non-empty, using ['uri' => ...] format.
    $mapped['facebook_url'] = !empty($normalized['facebook'])
      ? ['uri' => $normalized['facebook']] : NULL;
    $mapped['linkedin_url'] = !empty($normalized['linkedin'])
      ? ['uri' => $normalized['linkedin']] : NULL;
    $mapped['x_url'] = !empty($normalized['twitter'])
      ? ['uri' => $normalized['twitter']] : NULL;
    $mapped['personal_website_url'] = !empty($normalized['website'])
      ? ['uri' => $normalized['website']] : NULL;

    return $mapped;
  }

  /**
   * Builds the cache ID for a given ASURITE ID.
   *
   * @param string $asurite_id
   *   The ASURITE ID.
   *
   * @return string
   *   The cache ID.
   */
  protected function getCacheId(string $asurite_id): string {
    return 'webspark_webdir:remote_profile:' . $asurite_id;
  }

}
