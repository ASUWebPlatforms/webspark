<?php

namespace Drupal\asu_quikpay\Plugin\Commerce\PaymentGateway;

use Drupal\commerce_payment\Plugin\Commerce\PaymentGateway\OffsitePaymentGatewayBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\commerce_order\Entity\OrderInterface;
use Symfony\Component\HttpFoundation\Request;

/**
 * Provides the quikpay offsite payment gateway.
 * 
 * @CommercePaymentGateway(
 *  id = "quikpay_redirect_checkout",
 *  label = @Translation("Redirect to QuikPay (Nelnet)."),
 *  display_label = @Translation("QuikPay Secure Payment Server"),
 *  forms = {
 *    "offsite-payment" = "Drupal\asu_quikpay\PluginForm\QuikpayRedirectForm",
 *  },
 *  payment_method_types = {"credit_card"},
 *  credit_card_types = {"mastercard", "visa",},
 * )
 */

class Quikpay extends OffsitePaymentGatewayBase {
  public function defaultConfiguration() {
    return [
      'order_type' => "",
      /* 'quikpay_mode' => 'test', */
      'quikpay_redirect' => 'rtpn',
      'quikpay_redirect_url' => '/commerce_nelnet/rtpn',
      'quikpay_test_pt_key' => 'key',
      'quikpay_test_rtpn_key' => 'key',
      'quikpay_prod_pt_key' => 'key',
      'quikpay_prod_rtpn_key' => 'key',
      'quikpay_test_url' => "https://uatquikpayasp.com/asu/commerce_manager/payer.do",
      'quikpay_prod_url' => "https://quikpayasp.com/asu/commerce_manager/payer.do",
      'quikpay_success_text' => 'Thank you for your payment. You may now view your orders by clicking on the link below.',
      'quikpay_checkout_text' => 'IMPORTANT! In order to make an online payment a new window will open to receive and process your payment details. You may return to this site once your payment is complete by closing that window. You will receive an email receipt as well as an additional email containing course registration details.',
      'quikpay_checkout_red' => 'You will be directed to a payment page that will process your payment details. Once the payment is complete, you will automatically return to this site and will be able to view your completed order. You will receive an email receipt as well as an additional email containing course registration details.',
    ] + parent::defaultConfiguration();
  }

  public function buildConfigurationForm(array $form, FormStateInterface $form_state) {
    $form = parent::buildConfigurationForm($form, $form_state);

    $form['order_type'] = [
      '#type' => 'textfield',
      '#title' => t('Nelnet order type'),
      '#default_value' => $this->configuration['order_type'],
    ];
    /* $form['quikpay_cc_images'] = [
      '#type' => 'checkboxes',
      '#title' => t('Credit card images to display'),
      '#default_value' => $this->configuration['quikpay_cc_images'],
      '#options' => ['visa' => 'Visa', 'mastercard' => 'MasterCard', 'discover' => 'Discover', 'amex' => "American Express"],
      '#description' => t('Choose credit card images to display when checking out.'),
    ]; */
    $form['quikpay_redirect'] = [
      '#type' => 'select',
      '#title' => t('Redirect Method'),
      '#default_value' => $this->configuration['quikpay_redirect'],
      '#options' => [
        /* 'rtpn' => t('RTPN'), */ // TODO complete RTPN for nelnet.
        'url' => t('Redirect URL'),
      ],
      '#description' => t('Select whether to use RTPN or the redirect url method upon completion of payment.'),
    ];
   $form['quikpay_redirect_url'] = [
      '#type' => 'textfield',
      '#title' => t('URL used for redirect if redirect method is selected above.'),
      '#default_value' => $this->configuration['quikpay_redirect_url'],
      '#description' => t('<strong>Make sure there is no trailing / in the URL as it matters in being authenticated by Nelnet!</strong>'),
      '#disabled' => TRUE
    ];
    $form['quikpay_test_pt_key'] = [
      '#type' => 'textfield',
      '#title' => t('Nelnet pass through authentication test key'),
      '#default_value' => $this->configuration['quikpay_test_pt_key'],
    ];
    $form['quikpay_test_rtpn_key'] = [
      '#type' => 'textfield',
      '#title' => t('Nelnet real time payment notification test key'),
      '#default_value' => $this->configuration['quikpay_test_rtpn_key'],
    ];
    $form['quikpay_prod_pt_key'] = [
      '#type' => 'textfield',
      '#title' => t('Nelnet pass through authentication production key'),
      '#default_value' => $this->configuration['quikpay_prod_pt_key'],
    ];
    $form['quikpay_prod_rtpn_key'] = [
      '#type' => 'textfield',
      '#title' => t('Nelnet real time payment notification production key'),
      '#default_value' => $this->configuration['quikpay_prod_rtpn_key'],
    ];
    $form['quikpay_test_url'] = [
      '#type' => 'textfield',
      '#title' => t('Nelnet test URL'),
      '#default_value' => $this->configuration['quikpay_test_url'],
    ];
    $form['quikpay_prod_url'] = [
      '#type' => 'textfield',
      '#title' => t('Nelnet production URL'),
      '#default_value' => $this->configuration['quikpay_prod_url'],
    ];
   $form['quikpay_success_text'] = [
      '#type' => 'textarea',
      '#title' => t('Success Message'),
      '#default_value' => $this->configuration['quikpay_success_text'],
      '#description' => ('Text to display upon successful completion of payment'),
      '#required' => TRUE
    ];
    $form['quikpay_checkout_text'] = [
      '#type' => 'textarea',
      '#title' => t('RTPN Checkout instructions'),
      '#default_value' => $this->configuration['quikpay_checkout_text'],
      '#description' => t('Instructional text to display below the proceed to checkout link.'),
      '#required' => TRUE
    ];  
    $form['quikpay_checkout_red'] = [
      '#type' => 'textarea',
      '#title' => t('Redirect Method Checkout instructions'),
      '#default_value' => $this->configuration['quikpay_checkout_red'],
      '#description' => t('Instructional text to display below the proceed to checkout link.'),
      '#required' => TRUE
    ];

    return $form;
  }

  public function submitConfigurationForm(array &$form, FormStateInterface $form_state) {
    parent::submitConfigurationForm($form, $form_state);
    $values = $form_state->getValue($form['#parents']);
    $this->configuration['order_type'] = $values['order_type'];
    $this->configuration['quikpay_redirect'] = $values['quikpay_redirect'];
    $this->configuration['quikpay_redirect_url'] = $values['quikpay_redirect_url'];
    $this->configuration['quikpay_test_pt_key'] = $values['quikpay_test_pt_key'];
    $this->configuration['quikpay_test_rtpn_key'] = $values['quikpay_test_rtpn_key'];
    $this->configuration['quikpay_prod_pt_key'] = $values['quikpay_prod_pt_key'];
    $this->configuration['quikpay_prod_rtpn_key'] = $values['quikpay_prod_rtpn_key'];
    $this->configuration['quikpay_test_url'] = $values['quikpay_test_url'];
    $this->configuration['quikpay_prod_url'] = $values['quikpay_prod_url'];
    $this->configuration['quikpay_success_text'] = $values['quikpay_success_text'];
    $this->configuration['quikpay_checkout_text'] = $values['quikpay_checkout_text'];
    $this->configuration['quikpay_checkout_red'] = $values['quikpay_checkout_red'];
  }

  /**
   * @inheritDoc
   */
  public function onReturn(OrderInterface $order, Request $request) {
    $logger = \Drupal::logger('asu_quikpay');
    // We load order id and key.
    $order_id = $order->get('order_id')->first()->getValue()["value"];
    $key = $this->configuration['mode'] === "live" ? $this->configuration['quikpay_prod_pt_key'] : $this->configuration['quikpay_test_pt_key'];
    
    // Get the success parameter from the URL.
    $success = boolval($request->query->get('success'));

    // Create the hash string to be compared with the paid parameter value.
    $hash_string = '';
    $hash_string .= $order_id;
    $hash_string .= $success;
    $hash = hash('SHA256', $hash_string . $key);

    $validated = $hash === $request->query->get('paid') ? TRUE : FALSE;
    // If the validation is correct we proceed with the order.
    if ($validated) {
      $payment_storage = $this->entityTypeManager->getStorage('commerce_payment');

      $payment = $payment_storage->create([
        'state' => 'completed',
        'amount' => $order->getTotalPrice(),
        'payment_gateway' => $this->parentEntity->id(),
        'order_id' => $order->id(),
      ]);

      $logger->info('Saving Payment information');

      $payment->save();
    }
  }
}