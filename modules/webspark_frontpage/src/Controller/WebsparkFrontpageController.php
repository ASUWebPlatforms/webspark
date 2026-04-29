<?php

declare(strict_types=1);

namespace Drupal\webspark_frontpage\Controller;

use Drupal\Core\Controller\ControllerBase;

final class WebsparkFrontpageController extends ControllerBase {

  /**
   * Generate the Webspark front page.
   *
   * @return array
   */
  public function index(): array {
    return [
      '#type' => 'inline_template',
      '#title' => 'Welcome to Webspark',
      '#template' => '
        <div class="container">
          <div class="col">
            <p class="h2">Welcome to your new Webspark site</p>

            <p>To get started, you can dive right in and <a href="/node/add">Add Content</a>.</p>

            <p>Once you have added content, you can <a href="https://www.drupal.org/docs/user_guide/en/menu-home.html">add a custom front page</a> for your site.</p>

            <p>If you are not ready to add content, you can get some helpful tips to <a href="https://webservices.asu.edu/resources/plan-your-site">Plan your Site</a>. Or, you can learn what Webspark has to offer with our <a href="https://webservices.asu.edu/resources/videos">Video Tutorials</a>.</p>
          </div>
        </div>
      ',
    ];
  }

}
