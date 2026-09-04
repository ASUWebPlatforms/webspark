<?php

namespace Drupal\webspark_views\Plugin\views\style;

use Drupal\Core\Form\FormStateInterface;
use Drupal\views\Plugin\views\style\StylePluginBase;
use Drupal\Core\Entity\EntityFieldManagerInterface;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\filter\Entity\FilterFormat;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Style plugin for the cards view format. Creates an arrangement of default cards.
 *
 * @ingroup views_style_plugins
 *
 * @ViewsStyle(
 *   id = "webspark_card_view_format",
 *   title = @Translation("Default Cards Style"),
 *   help = @Translation("Displays content in default cards."),
 *   theme = "views_view_webspark_card_view_format",
 *   display_types = {"normal"},
 *   base = {"node_field_data"},
 * )
 */
class CardViewFormat extends StylePluginBase {

  /**
   * Default text format applied to the card body when none is configured.
   *
   * This is also used as the fallback for pre-existing views that were saved
   * before the body text format option existed.
   */
  const DEFAULT_BODY_TEXT_FORMAT = 'minimal_format';

  /**
   * The entity field manager.
   *
   * @var \Drupal\Core\Entity\EntityFieldManagerInterface
   */
  protected $entityFieldManager;

  public function __construct(array $configuration, $plugin_id, $plugin_definition, EntityFieldManagerInterface $entity_field_manager) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
    $this->entityFieldManager = $entity_field_manager;
  }

  /**
   * {@inheritdoc}
   */
  protected $usesOptions = TRUE;
  /**
   * {@inheritdoc}
   */
  protected $usesFields = TRUE;
  /**
   * {@inheritdoc}
   */
  protected $usesRowPlugin = TRUE;

  /**
   * {@inheritdoc}
   */
  public function usesRowPlugin() {
    return TRUE;
  }

  /**
   * Specify that only the 'fields' row plugin is allowed.
   */
  public function getType() {
    return 'normal';
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    return new static(
      $configuration,
      $plugin_id,
      $plugin_definition,
      $container->get('entity_field.manager')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function defineOptions() {
    $options = parent::defineOptions();
    $options['row_plugin'] = ['default' => 'fields'];
    $this->options['row_plugin'] = 'fields';
    $options['columns'] = ['default' => 1];
    $options['button_color'] = ['default' => 1];
    $options['destination'] = ['default' => TRUE];
    // Text format used to filter/sanitize the card body. Defaults to
    // minimal_format so both new and pre-existing views render the body
    // through a safe filter rather than stripping all markup.
    $options['body_text_format'] = ['default' => self::DEFAULT_BODY_TEXT_FORMAT];
    $options['field_mapping'] = [
      'default' => [
        'wrapper_class' => 'default-group-class',
        'media' => [
          'default_value' => '',
          'enabled' => TRUE,
        ],
        'body' => [
          'default_value' => '',
          'enabled' => TRUE,
        ],
        'cta' => [
          'default_value' => '',
          'enabled' => TRUE,
        ],
      ],
    ];
    return $options;
  }

  /**
   * {@inheritdoc}
   */
  public function buildOptionsForm(&$form, FormStateInterface $form_state) {
    parent::buildOptionsForm($form, $form_state);
    // Options for columns.
    $columnOptions = [
      0 => '2 columns',
      1 => '3 columns',
      2 => '4 columns'
    ];

    // Options for button colors.
    $buttonOptions = [
      'btn-maroon' => 'Maroon',
      'btn-gold' => 'Gold',
      'btn-gray' => 'Gray 2',
      'btn-dark' => 'Gray 7',
    ];

    $form['columns'] = [
      '#type' => 'radios',
      '#title' => $this->t('Columns'),
      '#options' => $columnOptions,
      '#default_value' => (isset($this->options['columns'])) ? $this->options['columns'] : 1,
      '#description' => $this->t('Choose how many cards to show per row in desktop view.')
    ];

    $form['button_color'] = [
      '#type' => 'radios',
      '#title' => $this->t('Button Color'),
      '#options' => $buttonOptions,
      '#default_value' => (isset($this->options['button_color'])) ? $this->options['button_color'] : 'btn-maroon',
      '#description' => $this->t('Choose button color for CTAs.')
    ];

    // Build a list of available text formats for the card body.
    $format_options = [];
    foreach (FilterFormat::loadMultiple() as $format_id => $format) {
      // Only offer enabled formats.
      if ($format->status()) {
        $format_options[$format_id] = $format->label();
      }
    }

    $form['body_text_format'] = [
      '#type' => 'select',
      '#title' => $this->t('Card body text format'),
      '#options' => $format_options,
      '#default_value' => (isset($this->options['body_text_format'])) ? $this->options['body_text_format'] : self::DEFAULT_BODY_TEXT_FORMAT,
      '#description' => $this->t('Text format used to filter and sanitize the card body. Defaults to Minimal Format. The body is trimmed to 500 characters after filtering.'),
    ];

    $form['field_mapping'] = [
      '#type' => 'details',
      '#title' => $this->t('Map fields to card elements'),
      '#open' => TRUE,
    // Ensures nested values in $form_state.
      '#tree' => TRUE,
    ];

    $form['field_mapping']['media'] = [
      '#type' => 'select',
      '#title' => $this->t('Media image field'),
      '#options' => $this->getOptions($form, $form_state, 'media'),
      '#empty_option' => $this->t('- Select -'),
      '#empty_value' => '',
      '#default_value' => (isset($this->options['field_mapping']['media'])) ? $this->options['field_mapping']['media'] : '',
      '#description' => $this->t('Choose a media field to use as the card image. This field is optional.')
    ];

    $form['field_mapping']['body'] = [
      '#type' => 'select',
      '#title' => $this->t('Card body'),
      '#options' => $this->getOptions($form, $form_state, 'text'),
      '#empty_option' => $this->t('- Select -'),
      '#empty_value' => '',
      '#default_value' => (isset($this->options['field_mapping']['body'])) ? $this->options['field_mapping']['body'] : '',
      '#description' => $this->t('Choose a text field to use as the card body. If a summary on the selected text field is available, it will be used. Trimmed to 500 characters.')
    ];

    $form['field_mapping']['cta'] = [
      '#type' => 'select',
      '#title' => $this->t('CTA'),
      '#options' => $this->getOptions($form, $form_state, 'link'),
      '#empty_option' => $this->t('- Select -'),
      '#empty_value' => '',
      '#default_value' => (isset($this->options['field_mapping']['cta'])) ? $this->options['field_mapping']['cta'] : '',
      '#description' => $this->t('Choose a link field to use as the card CTA. This field is optional. Up to 2 links will show per card, a primary and a secondary.')
    ];

  }

  /**
   * Returns form options for settings fields.
   *
   * @internal
   *
   * @return array
   *   An array of field names for configuration form
   */
  private function getOptions(&$form, FormStateInterface $form_state, $fieldType) {

    // Getting the currently selected content type of the view.
    $view_ui = $form_state->getStorage()['view'];
    $executable = $view_ui->getExecutable();
    $filters = $executable->display_handler->getOption('filters');
    $fieldOptions = [];
    if (isset($filters['type'])) {
      $content_types = $filters['type']['value'];
      // Getting fields, creating options lists based on field type. Only one content type is allowd by this style.
      foreach ($content_types as $content_type) {
        // Get all field definitions for a specific content type (string, e.g., 'article').
        $fields = $this->entityFieldManager->getFieldDefinitions('node', $content_type);
        foreach ($fields as $field_name => $field_definition) {
          if ($fieldType == 'media') {
            if ($field_definition->getType() === 'entity_reference' && $field_definition->getSetting('target_type') === 'media') {
              $fieldOptions[$field_name] = $field_definition->getLabel();
            }
          }
          elseif ($fieldType == 'text') {
            $textTypes = ['text', 'text_long', 'text_with_summary'];
            if (in_array($field_definition->getType(), $textTypes)) {
              $fieldOptions[$field_name] = $field_definition->getLabel();
            }
          }
          elseif ($fieldType == 'link') {
            if ($field_definition->getType() === 'link') {
              $fieldOptions[$field_name] = $field_definition->getLabel();
            }
          }
        }
      }
    }

    return $fieldOptions;
  }

  /**
   * Validation prevents style from being used on multi-content-type views or with unsupported display format.
   *
   * This is needed because the view does not yet exist on the intial configuration page at admin/structure/views/add.
   */
  public function validate() {
    $errors = parent::validate();
    $view = $this->view;

    // Ensure the view is filtering by a single content type.
    $filters = $view->display_handler->getHandlers('filter');
    if (isset($filters['type'])) {
      $value = $filters['type']->value;
      if (count($value) !== 1) {
        $errors[] = $this->t('The Default Cards plugin can only be used with views restricted to a single content type.');
      }
    }
    else {
      $errors[] = $this->t('You must add a "Content: Type" filter to use this style. The Default Cards plugin can only be used with views restricted to a single content type.');
    }

    if (isset($view->rowPlugin) && !($view->rowPlugin->getPluginId() === 'fields')) {
      $errors[] = $this->t('Under Page display settings you must add choose Display format: Fields to use the Default Cards Plugin style.');
    }

    return $errors;
  }

}
