<?php

declare(strict_types=1);

namespace Drupal\webspark_webdir;

use Drupal\Core\Entity\EntityInterface;
use Drupal\Core\Entity\EntityListBuilder;
use Drupal\Core\Entity\EntityStorageInterface;
use Drupal\Core\Entity\EntityTypeInterface;
use Drupal\Core\Form\FormBuilderInterface;
use Drupal\Core\Form\FormInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Url;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Provides a list controller for the profile entity type.
 */
final class ProfileListBuilder extends EntityListBuilder implements FormInterface {

  /**
   * The form builder.
   *
   * @var \Drupal\Core\Form\FormBuilderInterface
   */
  protected FormBuilderInterface $formBuilder;

  /**
   * The current request.
   *
   * @var \Symfony\Component\HttpFoundation\Request
   */
  protected Request $request;

  /**
   * The filter values.
   *
   * @var array
   */
  protected array $filterValues = [];

  /**
   * {@inheritdoc}
   */
  public static function createInstance(ContainerInterface $container, EntityTypeInterface $entity_type): self {
    $instance = new self(
      $entity_type,
      $container->get('entity_type.manager')->getStorage($entity_type->id()),
    );
    $instance->formBuilder = $container->get('form_builder');
    $instance->request = $container->get('request_stack')->getCurrentRequest();
    return $instance;
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId(): string {
    return 'asu_profile_admin_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state): array {
    // Filter section.
    $form['filters'] = [
      '#type' => 'container',
      '#attributes' => ['class' => ['form--inline', 'clearfix']],
    ];

    $form['filters']['name'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Name'),
      '#size' => 30,
      '#default_value' => $this->request->query->get('name', ''),
    ];

    $form['filters']['profile_type'] = [
      '#type' => 'select',
      '#title' => $this->t('Profile type'),
      '#options' => [
        '' => $this->t('- Any -'),
        'local' => $this->t('Local'),
        'from_directory' => $this->t('Remote (from directory)'),
      ],
      '#default_value' => $this->request->query->get('profile_type', ''),
    ];

    $form['filters']['status'] = [
      '#type' => 'select',
      '#title' => $this->t('Status'),
      '#options' => [
        '' => $this->t('- Any -'),
        '1' => $this->t('Enabled'),
        '0' => $this->t('Disabled'),
      ],
      '#default_value' => $this->request->query->get('status', ''),
    ];

    $form['filters']['filter_actions'] = [
      '#type' => 'actions',
    ];

    $form['filters']['filter_actions']['submit'] = [
      '#type' => 'submit',
      '#value' => $this->t('Filter'),
      '#submit' => ['::submitFilterForm'],
    ];

    $form['filters']['filter_actions']['reset'] = [
      '#type' => 'link',
      '#title' => $this->t('Reset'),
      '#url' => Url::fromRoute('entity.asu_profile.collection'),
      '#attributes' => ['class' => ['button']],
    ];

    // Bulk operations section.
    $form['bulk'] = [
      '#type' => 'container',
      '#attributes' => ['class' => ['form--inline', 'clearfix']],
    ];

    $form['bulk']['action'] = [
      '#type' => 'select',
      '#title' => $this->t('Action'),
      '#title_display' => 'invisible',
      '#options' => [
        '' => $this->t('- Select action -'),
        'delete' => $this->t('Delete selected'),
      ],
    ];

    $form['bulk']['apply'] = [
      '#type' => 'submit',
      '#value' => $this->t('Apply to selected items'),
      '#submit' => ['::submitBulkForm'],
      '#validate' => ['::validateBulkForm'],
    ];

    // Build the table with checkboxes.
    $form['profiles'] = $this->buildProfileTable();

    // Add pager.
    $form['pager'] = [
      '#type' => 'pager',
    ];

    return $form;
  }

  /**
   * Build the profiles table with checkboxes.
   *
   * @return array
   *   The table render array.
   */
  protected function buildProfileTable(): array {
    // Define sortable headers.
    $header = [
      'id' => [
        'data' => $this->t('ID'),
        'field' => 'id',
        'specifier' => 'id',
      ],
      'name' => [
        'data' => $this->t('Name'),
        'field' => 'name',
        'specifier' => 'name',
      ],
      'profile_type' => [
        'data' => $this->t('Profile Type'),
        'field' => 'profile_type',
        'specifier' => 'profile_type',
      ],
      'status' => [
        'data' => $this->t('Status'),
        'field' => 'status',
        'specifier' => 'status',
      ],
      'uid' => [
        'data' => $this->t('Author'),
        'field' => 'uid',
        'specifier' => 'uid',
      ],
      'created' => [
        'data' => $this->t('Created'),
        'field' => 'created',
        'specifier' => 'created',
        'sort' => 'desc',
      ],
      'operations' => $this->t('Operations'),
    ];

    $options = [];
    $entities = $this->load();

    foreach ($entities as $entity) {
      /** @var \Drupal\webspark_webdir\Entity\Profile $entity */
      $entity_id = $entity->id();
      $options[$entity_id] = [
        'id' => $entity_id,
        'name' => $entity->toLink(),
        'profile_type' => $entity->get('profile_type')->value ?? '',
        'status' => $entity->get('status')->value ? $this->t('Enabled') : $this->t('Disabled'),
        'uid' => [
          'data' => [
            '#theme' => 'username',
            '#account' => $entity->getOwner(),
          ],
        ],
        'created' => \Drupal::service('date.formatter')->format(
          $entity->get('created')->value,
          'short',
        ),
        'operations' => [
          'data' => $this->buildOperations($entity),
        ],
      ];
    }

    return [
      '#type' => 'tableselect',
      '#header' => $header,
      '#options' => $options,
      '#empty' => $this->t('No profiles found.'),
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state): void {
    // No validation needed for filter form.
  }

  /**
   * Validate the bulk action form.
   */
  public function validateBulkForm(array &$form, FormStateInterface $form_state): void {
    $action = $form_state->getValue('action');
    if (empty($action)) {
      $form_state->setErrorByName('action', $this->t('Please select an action.'));
      return;
    }

    $selected = array_filter($form_state->getValue('profiles') ?? []);
    if (empty($selected)) {
      $form_state->setErrorByName('profiles', $this->t('Please select at least one profile.'));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state): void {
    // Default submit - redirect to filter.
    $this->submitFilterForm($form, $form_state);
  }

  /**
   * Submit handler for the filter form.
   */
  public function submitFilterForm(array &$form, FormStateInterface $form_state): void {
    $query = [];
    if ($name = $form_state->getValue('name')) {
      $query['name'] = $name;
    }
    if ($profile_type = $form_state->getValue('profile_type')) {
      $query['profile_type'] = $profile_type;
    }
    if ($form_state->getValue('status') !== '') {
      $status = $form_state->getValue('status');
      if ($status !== NULL && $status !== '') {
        $query['status'] = $status;
      }
    }

    $form_state->setRedirectUrl(
      Url::fromRoute('entity.asu_profile.collection', [], ['query' => $query])
    );
  }

  /**
   * Submit handler for the bulk action form.
   */
  public function submitBulkForm(array &$form, FormStateInterface $form_state): void {
    $action = $form_state->getValue('action');
    $selected = array_filter($form_state->getValue('profiles') ?? []);

    if (empty($selected)) {
      return;
    }

    $storage = $this->getStorage();
    $profiles = $storage->loadMultiple($selected);

    switch ($action) {
      case 'delete':
        $storage->delete($profiles);
        $this->messenger()->addStatus($this->t('Deleted @count profiles.', ['@count' => count($profiles)]));
        break;
    }
  }

  /**
   * {@inheritdoc}
   */
  public function render(): array {
    $build = [];

    // Add "+ Add Profile" button.
    $build['add_button'] = [
      '#type' => 'link',
      '#title' => $this->t('Add Profile'),
      '#url' => Url::fromRoute('entity.asu_profile.add_form'),
      '#attributes' => [
        'class' => ['button', 'button--primary', 'button--action'],
      ],
    ];

    // Add the combined filter/bulk/table form.
    $build['form'] = $this->formBuilder->getForm($this);

    return $build;
  }

  /**
   * {@inheritdoc}
   */
  protected function getEntityIds(): array {
    $query = $this->getStorage()->getQuery()
      ->accessCheck(TRUE);

    // Apply name filter.
    if ($name = $this->request->query->get('name')) {
      $query->condition('name', '%' . $name . '%', 'LIKE');
    }

    // Apply profile type filter.
    if ($profile_type = $this->request->query->get('profile_type')) {
      $query->condition('profile_type', $profile_type);
    }

    // Apply status filter.
    $status = $this->request->query->get('status');
    if ($status !== NULL && $status !== '') {
      $query->condition('status', (int) $status);
    }

    // Apply sort from TableSort.
    // Drupal's tablesort passes the column header label in the 'order' param,
    // so we map display labels to entity field names.
    $order = $this->request->query->get('order', '');
    $sort = $this->request->query->get('sort', 'desc');

    $label_to_field = [
      'ID' => 'id',
      'Name' => 'name',
      'Profile Type' => 'profile_type',
      'Status' => 'status',
      'Author' => 'uid',
      'Created' => 'created',
    ];

    $sort_direction = strtoupper($sort) === 'ASC' ? 'ASC' : 'DESC';

    if (!empty($order) && isset($label_to_field[$order])) {
      $query->sort($label_to_field[$order], $sort_direction);
    }
    else {
      // Default sort by created date descending.
      $query->sort('created', 'DESC');
    }

    // Apply pager.
    if ($this->limit) {
      $query->pager($this->limit);
    }

    return $query->execute();
  }

  /**
   * {@inheritdoc}
   */
  public function buildHeader(): array {
    $header['id'] = $this->t('ID');
    $header['name'] = $this->t('Name');
    $header['profile_type'] = $this->t('Profile Type');
    $header['status'] = $this->t('Status');
    $header['uid'] = $this->t('Author');
    $header['created'] = $this->t('Created');
    return $header + parent::buildHeader();
  }

  /**
   * {@inheritdoc}
   */
  public function buildRow(EntityInterface $entity): array {
    /** @var \Drupal\webspark_webdir\Entity\Profile $entity */
    $row['id'] = $entity->id();
    $row['name'] = $entity->toLink();
    $row['profile_type'] = $entity->get('profile_type')->value ?? '';
    $row['status'] = $entity->get('status')->value ? $this->t('Enabled') : $this->t('Disabled');
    $row['uid']['data'] = [
      '#theme' => 'username',
      '#account' => $entity->getOwner(),
    ];
    $row['created'] = \Drupal::service('date.formatter')->format(
      $entity->get('created')->value,
      'short',
    );
    return $row + parent::buildRow($entity);
  }

}
