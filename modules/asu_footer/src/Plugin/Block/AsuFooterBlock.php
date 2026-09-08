<?php

namespace Drupal\asu_footer\Plugin\Block;

use Drupal\Core\Block\BlockBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Cache\Cache;
use Drupal\system\Entity\Menu;
use Drupal\media\Entity\Media;
use Drupal\file\Entity\File;

use function Embed\isEmpty;

/**
 * Provides the ASU footer block which deploys the React footer component.
 *
 * @Block(
 *   id = "asu_footer",
 *   admin_label = @Translation("ASU footer"),
 *   category = @Translation("ASU footer"),
 * )
 */
class AsuFooterBlock extends BlockBase {

  const ORDINAL_INDEX = ['Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];

  /**
   * The total number of stacked menus in a column.
   */
  const STACKED_MENUS = 3;

  /**
   * {@inheritdoc}
   */
  public function build() {
    $config = $this->getConfiguration();

    // Migrate old configuration to new format for backward compatibility.
    $migrated_config = $this->migrateOldConfiguration($config);
    if ($migrated_config !== $config) {
      $this->setConfiguration($migrated_config);
    }
    $config = $migrated_config;

    $module_handler = \Drupal::service('module_handler');
    $path_module = $module_handler->getModule('asu_footer')->getPath();

    // Default unit logo.
    $src_unit_logo = '/' . $path_module . '/img/ASU-EndorsedLogo.png';
    $src_unit_logo_internal = $path_module . '/img/ASU-EndorsedLogo.png';
    [$src_unit_logo_width, $src_unit_logo_height] = getimagesize($src_unit_logo_internal);

    // Footer rank image.
    $src_footer_img = '/' . $path_module . '/img/footer-rank.png';
    $src_footer_img_internal = $path_module . '/img/footer-rank.png';
    [$src_footer_img_width, $src_footer_img_height] = getimagesize($src_footer_img_internal);

    // Unit custom logo: render array for Twig, URL string for React.
    $unit_custom_logo = NULL;
    $unit_custom_logo_link = $config['asu_footer_block_logo_link_url'] ?? 'https://www.asu.edu';
    $unit_logo_url = $src_unit_logo;
    if (!empty($config['asu_footer_block_unit_logo_img'])) {
      $unit_custom_logo = $this->load_unit_logo($config['asu_footer_block_unit_logo_img']);
      $custom_logo_url = $this->load_unit_logo_url($config['asu_footer_block_unit_logo_img']);
      if ($custom_logo_url) {
        $unit_logo_url = $custom_logo_url;
      }
    }

    $site_name = \Drupal::config('system.site')->get('name');

    // Social link URLs (already full URLs after migration).
    $facebook_url = $config['asu_footer_block_facebook_url'] ?? '';
    $twitter_url = $config['asu_footer_block_twitter_url'] ?? '';
    $linkedin_url = $config['asu_footer_block_linkedin_url'] ?? '';
    $instagram_ulr = $config['asu_footer_block_instagram_url'] ?? '';
    $youtube_url = $config['asu_footer_block_youtube_url'] ?? '';

    // Build columns for both Twig HTML (SEO) and React props in a single pass.
    $columns_data = [];
    $react_columns = [];
    $cache_tags = [];

    if (!empty($config['asu_footer_block_contact_enabled'])) {
      foreach (static::ORDINAL_INDEX as $index) {
        foreach (range(1, static::STACKED_MENUS) as $stack_id) {
          $menu_id = $this->getFieldId($index, $stack_id);
          $title_id = $this->getFieldId($index, $stack_id, 'title');
          $source_type_id = $this->getFieldId($index, $stack_id, 'source_type');

          $source_type = $config[$source_type_id] ?? 'menu';
          $column_title = $config[$title_id] ?? '';

          if (!empty($column_title)) {
            $twig_items = [];
            $react_links = [];

            if ($source_type === 'menu') {
              if (!empty($config[$menu_id]) && $config[$menu_id] !== '_none') {
                $menu_name = $config[$menu_id];
                $raw_items = $this->get_menu_column($menu_name);
                $cache_tags = Cache::mergeTags($cache_tags, ['config:system.menu.' . $menu_name]);

                foreach ($raw_items as $item) {
                  $url_str = $item[0]->toString();
                  $title = $item[1];
                  $twig_items[] = [$url_str, $title];
                  $react_links[] = ['url' => $url_str, 'text' => $title, 'title' => $title];
                }
              }
            }
            elseif ($source_type === 'custom') {
              $max_link_num = $this->getNumCustomLinks($config, $index, $stack_id);

              for ($link_num = 1; $link_num <= $max_link_num; $link_num++) {
                $link_text_id = $this->getFieldId($index, $stack_id, "custom_link_{$link_num}_text");
                $link_url_id = $this->getFieldId($index, $stack_id, "custom_link_{$link_num}_url");

                $link_text = $config[$link_text_id] ?? '';
                $link_url = $config[$link_url_id] ?? '';

                if (!empty($link_text) && !empty($link_url)) {
                  $twig_items[] = [$link_url, $link_text];
                  $react_links[] = [
                    'url' => $link_url,
                    'text' => $link_text,
                    'title' => $link_text
                  ];
                }
              }
            }

            if (!empty($twig_items)) {
              $columns_data[$index][] = [
                'title' => $column_title,
                'menu_items' => $twig_items,
              ];
              $react_columns[] = [
                'title' => $column_title,
                'links' => $react_links,
              ];
            }
          }
        }
      }
    }

    // Build React props.
    $props = [];

    if (!empty($config['asu_footer_block_social_enabled'])) {
      $mediaLinks = [];
      if (!empty($config['asu_footer_block_facebook_url'])) {
        $mediaLinks['facebook'] = $config['asu_footer_block_facebook_url'];
      }
      if (!empty($config['asu_footer_block_twitter_url'])) {
        $mediaLinks['twitter'] = $config['asu_footer_block_twitter_url'];
      }
      if (!empty($config['asu_footer_block_instagram_url'])) {
        $mediaLinks['instagram'] = $config['asu_footer_block_instagram_url'];
      }
      if (!empty($config['asu_footer_block_youtube_url'])) {
        $mediaLinks['youtube'] = $config['asu_footer_block_youtube_url'];
      }
      if (!empty($config['asu_footer_block_linkedin_url'])) {
        $mediaLinks['linkedIn'] = $config['asu_footer_block_linkedin_url'];
      }

      $props['social'] = [
        'logoUrl' => $config['asu_footer_block_logo_url'] ?? 'https://www.asu.edu',
        'unitLogo' => $unit_logo_url,
        'mediaLinks' => $mediaLinks,
      ];
    }

    if (!empty($config['asu_footer_block_contact_enabled'])) {
      $props['contact'] = [
        'title' => $config['asu_footer_block_contact_title'] ?? '',
        'contactLink' => $config['asu_footer_block_contact_link'] ?? '',
        'contributionLink' => $config['asu_footer_block_contribution_link'] ?? '',
        'columns' => $react_columns,
      ];
    }

    // Render the static HTML footer first (for SEO), then React hydrates into
    // the same #ws2FooterContainer on the client side.
    $block_output = [
      '#theme' => 'asu_footer__footer_block',
      '#cache' => [
        'contexts' => $this->getCacheContexts(),
        'tags' => Cache::mergeTags($this->getCacheTags(), $cache_tags),
      ],
      '#site_name' => $site_name,
      '#src_unit_logo' => $src_unit_logo,
      '#src_unit_logo_width' => $src_unit_logo_width,
      '#src_unit_logo_height' => $src_unit_logo_height,
      '#unit_custom_logo' => $unit_custom_logo ?? '',
      '#unit_custom_logo_link' => $unit_custom_logo_link,
      '#src_footer_img' => $src_footer_img,
      '#src_footer_img_width' => $src_footer_img_width,
      '#src_footer_img_height' => $src_footer_img_height,
      '#show_logo_social_media' => !empty($config['asu_footer_block_social_enabled']),
      '#facebook_url' => $facebook_url,
      '#twitter_url' => $twitter_url,
      '#linkedin_url' => $linkedin_url,
      '#instagram_ulr' => $instagram_ulr,
      '#youtube_url' => $youtube_url,
      '#show_columns' => !empty($config['asu_footer_block_contact_enabled']),
      '#unit_name' => $config['asu_footer_block_contact_title'] ?? '',
      '#columns_data' => $columns_data,
      '#link_title' => $config['asu_footer_block_link_title'] ?? '',
      '#link_url' => $config['asu_footer_block_contact_link'] ?? '',
      '#cta_title' => $config['asu_footer_block_cta_title'] ?? '',
      '#cta_url' => $config['asu_footer_block_contribution_link'] ?? '',
    ];

    $block_output['#attached']['library'][] = 'asu_footer/components-library';
    $block_output['#attached']['drupalSettings']['asu_footer']['props'] = $props;

    return $block_output;
  }

  /**
   * {@inheritdoc}
   */
  public function blockForm($form, FormStateInterface $form_state) {
    $form = parent::blockForm($form, $form_state);
    $config = $this->getConfiguration();

    // Migrate old configuration to new format for backward compatibility.
    $config = $this->migrateOldConfiguration($config);

    $menu_options = array_map(function ($menu) {
      return $menu->label();
    }, Menu::loadMultiple());

    // Social media section.
    $form['social_settings'] = [
      '#type' => 'details',
      '#title' => $this->t('Social Media and Unit Logo Settings'),
      '#open' => TRUE,
    ];

    $form['social_settings']['asu_footer_block_social_enabled'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable social media section'),
      '#default_value' => $config['asu_footer_block_social_enabled'] ?? FALSE,
    ];

    $form['social_settings']['asu_footer_block_logo_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Logo URL'),
      '#default_value' => $config['asu_footer_block_logo_url'] ?? 'https://www.asu.edu',
      '#description' => $this->t('URL for the logo link'),
      '#states' => [
        'visible' => [
          ':input[name="settings[social_settings][asu_footer_block_social_enabled]"]' => ['checked' => TRUE],
        ],
      ],
    ];

    $form['social_settings']['asu_footer_block_unit_logo'] = [
      '#type' => 'details',
      '#title' => $this->t('Unit logo'),
      '#open' => TRUE,
      '#states' => [
        'visible' => [
          ':input[name="settings[social_settings][asu_footer_block_social_enabled]"]' => [
            'checked' => TRUE,
          ],
        ],
      ],
    ];

    $form['social_settings']['asu_footer_block_unit_logo']['asu_footer_block_unit_logo_img'] = [
      '#type' => 'media_library',
      '#allowed_bundles' => ['image'],
      '#title' => $this->t('Upload Unit logo'),
      '#default_value' => $config['asu_footer_block_unit_logo_img'] ?? '',
      '#states' => [
        'visible' => [
          ':input[name="settings[social_settings][asu_footer_block_social_enabled]"]' => [
            'checked' => TRUE,
          ],
        ],
      ],
      '#description' => $this->t('Recommended image size (W x H): 380 x 112 px') . '<br><b>' . $this->t('If you upload an image larger than the recommended size, it will be automatically cropped with a center anchor.') . '</b><br>',
    ];

    $form['social_settings']['asu_footer_block_unit_logo']['asu_footer_block_logo_link_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Logo URL'),
      '#default_value' => $config['asu_footer_block_logo_link_url'] ?? '',
      '#states' => [
        'visible' => [
          ':input[name="settings[social_settings][asu_footer_block_social_enabled]"]' => [
            'checked' => TRUE,
          ],
        ],
      ],
    ];

    $form['social_settings']['asu_footer_block_facebook_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Facebook URL'),
      '#default_value' => $config['asu_footer_block_facebook_url'] ?? '',
      '#description' => $this->t('Enter the full Facebook URL (e.g., https://www.facebook.com/ASU)'),
      '#states' => [
        'visible' => [
          ':input[name="settings[social_settings][asu_footer_block_social_enabled]"]' => ['checked' => TRUE],
        ],
      ],
    ];

    $form['social_settings']['asu_footer_block_twitter_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Twitter URL'),
      '#default_value' => $config['asu_footer_block_twitter_url'] ?? '',
      '#description' => $this->t('Enter the full Twitter URL (e.g., https://twitter.com/ASU)'),
      '#states' => [
        'visible' => [
          ':input[name="settings[social_settings][asu_footer_block_social_enabled]"]' => ['checked' => TRUE],
        ],
      ],
    ];

    $form['social_settings']['asu_footer_block_linkedin_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('LinkedIn URL'),
      '#default_value' => $config['asu_footer_block_linkedin_url'] ?? '',
      '#description' => $this->t('Enter the full LinkedIn URL (e.g., https://www.linkedin.com/school/asu)'),
      '#states' => [
        'visible' => [
          ':input[name="settings[social_settings][asu_footer_block_social_enabled]"]' => ['checked' => TRUE],
        ],
      ],
    ];

    $form['social_settings']['asu_footer_block_instagram_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Instagram URL'),
      '#default_value' => $config['asu_footer_block_instagram_url'] ?? '',
      '#description' => $this->t('Enter the full Instagram URL (e.g., https://www.instagram.com/arizonastateuniversity)'),
      '#states' => [
        'visible' => [
          ':input[name="settings[social_settings][asu_footer_block_social_enabled]"]' => ['checked' => TRUE],
        ],
      ],
    ];

    $form['social_settings']['asu_footer_block_youtube_url'] = [
      '#type' => 'textfield',
      '#title' => $this->t('YouTube URL'),
      '#default_value' => $config['asu_footer_block_youtube_url'] ?? '',
      '#description' => $this->t('Enter the full YouTube URL (e.g., https://www.youtube.com/user/arizonastateuniv)'),
      '#states' => [
        'visible' => [
          ':input[name="settings[social_settings][asu_footer_block_social_enabled]"]' => ['checked' => TRUE],
        ],
      ],
    ];

    // Contact information section.
    $form['contact_settings'] = [
      '#type' => 'details',
      '#title' => $this->t('Contact Information Settings'),
      '#open' => TRUE,
    ];

    $form['contact_settings']['asu_footer_block_contact_enabled'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable contact information section'),
      '#default_value' => $config['asu_footer_block_contact_enabled'] ?? FALSE,
    ];

    $form['contact_settings']['asu_footer_block_contact_title'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Contact Title'),
      '#default_value' => $config['asu_footer_block_contact_title'] ?? '',
      '#description' => $this->t('Title for the contact section (e.g., "Ira A. Fulton Schools of Engineering")'),
      '#states' => [
        'visible' => [
          ':input[name="settings[contact_settings][asu_footer_block_contact_enabled]"]' => ['checked' => TRUE],
        ],
      ],
    ];

    $form['contact_settings']['asu_footer_block_contact_link'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Contact Link'),
      '#default_value' => $config['asu_footer_block_contact_link'] ?? '',
      '#maxlength' => 60,
      '#states' => [
        'visible' => [
          ':input[name="settings[contact_settings][asu_footer_block_contact_enabled]"]' => ['checked' => TRUE],
        ],
      ],
    ];

    $form['contact_settings']['asu_footer_block_contribution_link'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Contribution Link'),
      '#default_value' => $config['asu_footer_block_contribution_link'] ?? '',
      '#description' => $this->t('URL for the contribution/donation link'),
      '#states' => [
        'visible' => [
          ':input[name="settings[contact_settings][asu_footer_block_contact_enabled]"]' => ['checked' => TRUE],
        ],
      ],
    ];

    $menu_options = array_map(function ($menu) {
      return $menu->label();
    }, Menu::loadMultiple());
    asort($menu_options);
    foreach (static::ORDINAL_INDEX as $index) {

      $form[$index . '_column'] = [
        '#type' => 'details',
        '#title' => $this->t($index . ' Column'),
        '#open' => TRUE,
        '#states' => [
          'visible' => [
            ':input[name="settings[contact_settings][asu_footer_block_contact_enabled]"]' => ['checked' => TRUE],
          ],
        ],
      ];

      // Only create one configuration section per column (use stack_id = 1)
      $stack_id = 1;
      $menu_id = $this->getFieldId($index, $stack_id);
      $title_id = $this->getFieldId($index, $stack_id, 'title');
      $name_suffix = $stack_id > 1 ? "_$stack_id" : '';

      // Add option to choose between menu or custom links.
      $source_type_id = $this->getFieldId($index, $stack_id, 'source_type');

      $form[$index . '_column'][$source_type_id] = [
        '#type' => 'radios',
        '#title' => $this->t('Column content type'),
        '#options' => [
          'menu' => $this->t('Use Drupal Menu'),
          'custom' => $this->t('Custom Links'),
        ],
        '#default_value' => $config[$source_type_id] ?? 'menu',
        '#states' => [
          'visible' => [
            ':input[name="settings[contact_settings][asu_footer_block_contact_enabled]"]' => ['checked' => TRUE],
          ],
        ],
      ];

      $form[$index . '_column'][$menu_id] = [
        '#type' => 'select',
        '#title' => $this->t('Menu to insert in ' . $index . ' column'),
        '#description' => $this->t('Select the menu to insert.'),
        '#options' => $menu_options,
        '#empty_option' => t('- None -'),
        '#empty_value' => '_none',
        '#default_value' => $config[$menu_id] ?? '',
        '#states' => [
          'visible' => [
            ':input[name="settings[contact_settings][asu_footer_block_contact_enabled]"]' => ['checked' => TRUE],
            ":input[name='settings[{$index}_column][{$source_type_id}]']" => ['value' => 'menu'],
          ],
        ],
      ];

      $form[$index . '_column'][$title_id] = [
        '#type' => 'textfield',
        '#title' => $this->t('Column title'),
        '#default_value' => $config[$title_id] ?? '',
        '#description' => $this->t('Title for this column section.'),
        '#states' => [
          'visible' => [
            ':input[name="settings[contact_settings][asu_footer_block_contact_enabled]"]' => ['checked' => TRUE],
          ],
          'required' => [
            [
              ":input[name='settings[{$index}_column][{$source_type_id}]']" => ['value' => 'menu'],
              ":input[name='settings[{$index}_column][asu_footer_block_menu_{$index}_column_name{$name_suffix}]']" => ['!value' => '_none'],
            ],
            'or',
            [
              ":input[name='settings[{$index}_column][{$source_type_id}]']" => ['value' => 'custom'],
            ],
          ],
        ]
      ];

      $custom_links_id = $this->getFieldId($index, $stack_id, 'custom_links');
      $form[$index . '_column'][$custom_links_id] = [
        '#type' => 'details',
        '#title' => $this->t('Custom Links'),
        '#open' => TRUE,
        '#states' => [
          'visible' => [
            ':input[name="settings[contact_settings][asu_footer_block_contact_enabled]"]' => ['checked' => TRUE],
            ":input[name='settings[{$index}_column][{$source_type_id}]']" => ['value' => 'custom'],
          ],
        ],
      ];

      // Get the number of custom links from form state or config.
      $num_links_key = $this->getFieldId($index, $stack_id, 'custom_links_count');
      $num_links = $form_state->get($num_links_key) ?: $this->getNumCustomLinks($config, $index, $stack_id);

      if ($num_links == 0) {
        // Start with at least one link.
        $num_links = 1;
      }

      $form_state->set($num_links_key, $num_links);

      // Container for dynamic links.
      $links_container_id = $this->getFieldId($index, $stack_id, 'links_container');
      $form[$index . '_column'][$custom_links_id][$links_container_id] = [
        '#type' => 'container',
      ];

      // Add dynamic custom link fields.
      for ($link_num = 1; $link_num <= $num_links; $link_num++) {
        $link_text_id = $this->getFieldId($index, $stack_id, "custom_link_{$link_num}_text");
        $link_url_id = $this->getFieldId($index, $stack_id, "custom_link_{$link_num}_url");

        $form[$index . '_column'][$custom_links_id][$links_container_id]["link_{$link_num}"] = [
          '#type' => 'fieldset',
          '#title' => $this->t('Link @num', ['@num' => $link_num]),
          '#collapsible' => FALSE,
          '#attributes' => ['class' => ['custom-link-fieldset']],
        ];

        $form[$index . '_column'][$custom_links_id][$links_container_id]["link_{$link_num}"][$link_text_id] = [
          '#type' => 'textfield',
          '#title' => $this->t('Link Text'),
          '#default_value' => $config[$link_text_id] ?? '',
          '#size' => 30,
          '#required' => FALSE,
        ];

        $form[$index . '_column'][$custom_links_id][$links_container_id]["link_{$link_num}"][$link_url_id] = [
          '#type' => 'textfield',
          '#title' => $this->t('Link URL'),
          '#default_value' => $config[$link_url_id] ?? '',
          '#size' => 50,
          '#required' => FALSE,
        ];

        // Add remove button for links beyond the first one.
        if ($link_num > 1) {
          $form[$index . '_column'][$custom_links_id][$links_container_id]["link_{$link_num}"]['remove_link'] = [
            '#type' => 'submit',
            '#value' => $this->t('Remove Link'),
            '#name' => "remove_link_{$index}_{$stack_id}_{$link_num}",
            '#submit' => [[$this, 'removeCustomLink']],
            '#limit_validation_errors' => [],
          ];
        }
      }

      // Add "Add Link" button.
      $form[$index . '_column'][$custom_links_id]['add_link'] = [
        '#type' => 'submit',
        '#value' => $this->t('Add Link'),
        '#name' => "add_link_{$index}_{$stack_id}",
        '#submit' => [[$this, 'addCustomLink']],
        '#limit_validation_errors' => [],
        '#attributes' => ['class' => ['button--primary']],
      ];
    }

    return $form;
  }

  /**
   * Get the number of existing custom links from configuration.
   *
   * @param array $config
   *   The configuration array.
   * @param string $index
   *   The column index.
   * @param int $stack_id
   *   The stack ID.
   *
   * @return int
   *   The number of existing custom links.
   */
  protected function getNumCustomLinks(array $config, string $index, int $stack_id): int {
    $count = 0;
    // Check up to 10 possible links to find existing ones - chose 10 as a reasonable limit for custom links to add.
    for ($i = 1; $i <= 10; $i++) {
      $text_id = $this->getFieldId($index, $stack_id, "custom_link_{$i}_text");
      $url_id = $this->getFieldId($index, $stack_id, "custom_link_{$i}_url");

      if (!empty($config[$text_id]) || !empty($config[$url_id])) {
        $count = $i;
      }
    }
    return $count;
  }

  /**
   * Submit callback to add a custom link.
   */
  public function addCustomLink(array &$form, FormStateInterface $form_state) {
    $triggering_element = $form_state->getTriggeringElement();
    $button_name = $triggering_element['#name'];

    // Extract index and stack_id from button name.
    if (preg_match('/add_link_(\w+)_(\d+)/', $button_name, $matches)) {
      $index = $matches[1];
      $stack_id = (int) $matches[2];

      $num_links_key = $this->getFieldId($index, $stack_id, 'custom_links_count');
      $current_count = $form_state->get($num_links_key) ?: 1;
      $form_state->set($num_links_key, $current_count + 1);
    }

    $form_state->setRebuild();
  }

  /**
   * Submit callback to remove a custom link.
   */
  public function removeCustomLink(array &$form, FormStateInterface $form_state) {
    $triggering_element = $form_state->getTriggeringElement();
    $button_name = $triggering_element['#name'];

    // Extract index, stack_id, and link_num from button name.
    if (preg_match('/remove_link_(\w+)_(\d+)_(\d+)/', $button_name, $matches)) {
      $index = $matches[1];
      $stack_id = (int) $matches[2];
      $link_num = (int) $matches[3];

      $num_links_key = $this->getFieldId($index, $stack_id, 'custom_links_count');
      $current_count = $form_state->get($num_links_key) ?: 1;

      if ($current_count > 1) {
        $form_state->set($num_links_key, $current_count - 1);
      }
    }

    $form_state->setRebuild();
  }

  /**
   * {@inheritdoc}
   */
  public function blockSubmit($form, FormStateInterface $form_state) {
    parent::blockSubmit($form, $form_state);
    $values = $form_state->getValues();

    // Social settings.
    foreach ($values['social_settings'] as $key => $value) {
      if ($key === 'asu_footer_block_unit_logo' && is_array($value)) {
        // Handle nested unit logo settings.
        foreach ($value as $nested_key => $nested_value) {
          $this->configuration[$nested_key] = $nested_value;
        }
      }
      else {
        $this->configuration[$key] = $value;
      }
    }

    // Contact settings.
    foreach ($values['contact_settings'] as $key => $value) {
      $this->configuration[$key] = $value;
    }

    // Menu column settings.
    foreach (static::ORDINAL_INDEX as $index) {
      $column_key = $index . '_column';
      if (isset($values[$column_key])) {
        foreach ($values[$column_key] as $field_key => $field_value) {
          // Handle all field values directly, including nested custom links.
          $this->processFieldValue($field_key, $field_value);
        }
      }
    }

    // Ensure the new configuration is saved properly for future compatibility.
    $this->configuration = $this->migrateOldConfiguration($this->configuration);
  }

  /**
   * Helper method to process field values recursively.
   */
  private function processFieldValue($key, $value) {
    if (is_array($value)) {
      foreach ($value as $nested_key => $nested_value) {
        $this->processFieldValue($nested_key, $nested_value);
      }
    }
    else {
      $this->configuration[$key] = $value;
    }
  }

  /**
   * {@inheritdoc}
   */
  public function getCacheContexts() {
    return Cache::mergeContexts(parent::getCacheContexts(), [
      'user',
    ]);
  }

  /**
   * Generates a field id.
   *
   * @param string $index_str
   *   The index string.
   * @param int $index
   *   The index number.
   * @param string $type
   *   The field type.
   *
   * @return string
   *   The field id.
   */
  protected function getFieldId(string $index_str, int $index, string $type = ''): string {
    $elements = ['asu_footer_block'];

    if ($type == 'title') {
      $elements[] = $index_str;
      $elements[] = 'title';
    }
    elseif ($type == 'source_type') {
      $elements[] = $index_str;
      $elements[] = 'source_type';
    }
    elseif ($type == 'custom_links') {
      $elements[] = $index_str;
      $elements[] = 'custom_links';
    }
    elseif ($type == 'custom_links_count') {
      $elements[] = $index_str;
      $elements[] = 'custom_links_count';
    }
    elseif ($type == 'links_container') {
      $elements[] = $index_str;
      $elements[] = 'links_container';
    }
    elseif (strpos($type, 'custom_link_') === 0) {
      $elements[] = $index_str;
      $elements[] = $type;
    }
    else {
      $elements[] = 'menu';
      $elements[] = $index_str;
      $elements[] = 'column_name';
    }

    if ($index > 1 && !in_array($type, ['title', 'source_type', 'custom_links', 'custom_links_count', 'links_container']) && strpos($type, 'custom_link_') !== 0) {
      $elements[] = $index;
    }

    return implode('_', $elements);
  }

  /**
   * Get menu column items.
   *
   * @param string $menu_name
   *   The menu machine name.
   *
   * @return array
   *   Array of menu items with URL and title.
   */
  public function get_menu_column($menu_name) {
    $menu_tree = \Drupal::menuTree();
    $parameters = $menu_tree->getCurrentRouteMenuTreeParameters($menu_name);
    $parameters->setMinDepth(0);
    $parameters->onlyEnabledLinks();

    $tree = $menu_tree->load($menu_name, $parameters);
    $manipulators = [
      ['callable' => 'menu.default_tree_manipulators:checkAccess'],
      ['callable' => 'menu.default_tree_manipulators:generateIndexAndSort'],
    ];
    $tree = $menu_tree->transform($tree, $manipulators);

    $menu_items = [];

    foreach ($tree as $item) {
      $title = $item->link->getTitle();
      $url = $item->link->getUrlObject();
      $menu_items[] = [$url, $title];
    }

    return $menu_items;
  }

  /**
   * Migrate old configuration format to new format for backward compatibility.
   *
   * @param array $config
   *   The existing configuration array.
   *
   * @return array
   *   The migrated configuration array.
   */
  private function migrateOldConfiguration(array $config): array {
    if (isset($config['asu_footer_block_show_logo_social_media']) && !isset($config['asu_footer_block_social_enabled'])) {
      $config['asu_footer_block_social_enabled'] = $config['asu_footer_block_show_logo_social_media'];
    }

    if (isset($config['asu_footer_block_show_columns']) && !isset($config['asu_footer_block_contact_enabled'])) {
      $config['asu_footer_block_contact_enabled'] = $config['asu_footer_block_show_columns'];
    }

    if (isset($config['asu_footer_block_unit_name']) && !isset($config['asu_footer_block_contact_title'])) {
      $config['asu_footer_block_contact_title'] = $config['asu_footer_block_unit_name'];
    }

    if (isset($config['asu_footer_block_facebook_url']) && !empty($config['asu_footer_block_facebook_url'])) {
      // Check if it's already a full URL or just the username part.
      if (strpos($config['asu_footer_block_facebook_url'], 'http') !== 0) {
        $config['asu_footer_block_facebook_url'] = 'https://www.facebook.com/' . $config['asu_footer_block_facebook_url'];
      }
    }

    if (isset($config['asu_footer_block_twitter_url']) && !empty($config['asu_footer_block_twitter_url'])) {
      if (strpos($config['asu_footer_block_twitter_url'], 'http') !== 0) {
        $config['asu_footer_block_twitter_url'] = 'https://twitter.com/' . $config['asu_footer_block_twitter_url'];
      }
    }

    if (isset($config['asu_footer_block_linkedin_url']) && !empty($config['asu_footer_block_linkedin_url'])) {
      if (strpos($config['asu_footer_block_linkedin_url'], 'http') !== 0) {
        $config['asu_footer_block_linkedin_url'] = 'https://www.linkedin.com/' . $config['asu_footer_block_linkedin_url'];
      }
    }

    if (isset($config['asu_footer_block_instagram_url']) && !empty($config['asu_footer_block_instagram_url'])) {
      if (strpos($config['asu_footer_block_instagram_url'], 'http') !== 0) {
        $config['asu_footer_block_instagram_url'] = 'https://www.instagram.com/' . $config['asu_footer_block_instagram_url'];
      }
    }

    if (isset($config['asu_footer_block_youtube_url']) && !empty($config['asu_footer_block_youtube_url'])) {
      if (strpos($config['asu_footer_block_youtube_url'], 'http') !== 0) {
        $config['asu_footer_block_youtube_url'] = 'https://www.youtube.com/' . $config['asu_footer_block_youtube_url'];
      }
    }

    if (isset($config['asu_footer_block_logo_link_url']) && !isset($config['asu_footer_block_logo_url'])) {
      $config['asu_footer_block_logo_url'] = $config['asu_footer_block_logo_link_url'];
    }

    if (isset($config['asu_footer_block_link_url']) && !isset($config['asu_footer_block_contact_link'])) {
      $config['asu_footer_block_contact_link'] = $config['asu_footer_block_link_url'];
    }

    if (isset($config['asu_footer_block_cta_url']) && !isset($config['asu_footer_block_contribution_link'])) {
      $config['asu_footer_block_contribution_link'] = $config['asu_footer_block_cta_url'];
    }

    $old_ordinal_index = ['second', 'third', 'fourth', 'fifth', 'sixth'];
    $new_ordinal_index = ['Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];

    foreach ($old_ordinal_index as $index => $old_key) {
      $new_key = $new_ordinal_index[$index];

      // Migrate menu and title configurations for each stack.
      for ($stack_id = 1; $stack_id <= static::STACKED_MENUS; $stack_id++) {
        $old_menu_id = $this->getOldFieldId($old_key, $stack_id);
        $old_title_id = $this->getOldFieldId($old_key, $stack_id, 'title');

        $new_menu_id = $this->getFieldId($new_key, $stack_id);
        $new_title_id = $this->getFieldId($new_key, $stack_id, 'title');
        $new_source_type_id = $this->getFieldId($new_key, $stack_id, 'source_type');

        if (isset($config[$old_menu_id]) && !isset($config[$new_menu_id])) {
          $config[$new_menu_id] = $config[$old_menu_id];
          if (!isset($config[$new_source_type_id])) {
            $config[$new_source_type_id] = 'menu';
          }
        }

        if (isset($config[$old_title_id]) && !isset($config[$new_title_id])) {
          $config[$new_title_id] = $config[$old_title_id];
        }
      }
    }

    return $config;
  }

  /**
   * Generate field ID for old configuration format.
   *
   * @param string $index_str
   *   The index string.
   * @param int $index
   *   The index number.
   * @param string $type
   *   The field type.
   *
   * @return string
   *   The old field id.
   */
  protected function getOldFieldId(string $index_str, int $index, string $type = ''): string {
    $elements = [
      ($type == 'title') ? 'asu_footer_block' : 'asu_footer_block_menu',
      $index_str,
      ($type == 'title') ? 'title' : 'column_name',
    ];

    if ($index > 1) {
      $elements[] = $index;
    }

    return implode('_', $elements);
  }

  /**
   * Load unit logo as a render array from a media entity (for Twig template).
   *
   * @param int $mid
   *   The media entity ID.
   *
   * @return array|null
   *   A render array for the image, or NULL if not found.
   */
  public function load_unit_logo($mid) {
    if ($mid) {
      $media = Media::load($mid);
      if ($media) {
        $fid = $media->field_media_image->target_id;
        $alt = $media->field_media_image->alt;
        $file = File::load($fid);
        if ($file) {
          $logo_build = [
            '#theme' => 'image_style',
            '#style_name' => 'footer_logo',
            '#uri' => $file->getFileUri(),
            '#alt' => $alt,
          ];
          $renderer = \Drupal::service('renderer');
          $renderer->addCacheableDependency($logo_build, $file);
          return $logo_build;
        }
      }
    }
    return NULL;
  }

  /**
   * Load unit logo URL from media entity.
   *
   * @param int $mid
   *   The media entity ID.
   *
   * @return string|null
   *   The URL of the logo image or NULL if not found.
   */
  public function load_unit_logo_url($mid) {
    if ($mid) {
      $media = Media::load($mid);
      if ($media) {
        $fid = $media->field_media_image->target_id;
        if ($fid) {
          $file = File::load($fid);
          if ($file) {
            return \Drupal::service('file_url_generator')->generateAbsoluteString($file->getFileUri());
          }
        }
      }
    }
    return NULL;
  }

}
