<?php

namespace Drupal\asu_quikpay\Controller;

use Drupal\Core\Controller\ControllerBase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Drupal\Core\Url;
use Drupal\commerce_payment\Exception\PaymentGatewayException;

/**
 * ASU controller needed for redirect payment url.
 */
class AsuQuikpayOffSite extends ControllerBase {

  /**
   * Returns a render-able array for a test page.
   */
  public function content() {
    $this->validatePayment(\Drupal::request());
    $build = [
      '#markup' => $this->t('Validating Payment.'),
    ];
    return $build;
  }

  protected function validatePayment(Request $request) {

    // The variables we sent in the redirectParameteres to Quikpay.
    $red_variables = "transactionType,transactionStatus,transactionId,originalTransactionId,transactionTotalAmount,transactionDate,transactionAcountType,transactionEffectiveDate,transactionDescription,transactionResultDate,transactionResultEffectiveDate,transactionResultCode,transactionResultMessage,orderNumber,orderType,orderName,orderDescription,orderAmount,orderFee,orderAmountDue,orderDueDate,orderBalance,orderCurrentStatusBalance,orderCurrentStatusAmountDue";
    $vars = explode(',', $red_variables);
    // Create hash string.
    $hash_string = "";
    foreach ($vars as $k) {
      $hash_string .= $request->query->get($k);
    }
    // Add the incoming timestamp from Quikpay server.
    $incoming_timestamp = $request->query->get('timestamp');

    $gateway = "quikpay";

    // If you use more than one payment gateway, please use the following code as reference to load the correct gateway configuration.

    /* $order_type = $request->query->get('orderType');
    if ($order_type === "YOUR OTHER ORDER TYPE") {
      $gateway = "your_other_gateway_machine_name";
    } */

    // Pull config from payment gateway.
    $payment_gateway = \Drupal::service('entity_type.manager')->getStorage('commerce_payment_gateway')->load($gateway)->getPluginConfiguration();
    $key = $payment_gateway['mode'] === "live" ? $payment_gateway['quikpay_prod_pt_key'] : $payment_gateway['quikpay_test_pt_key'];

    $hash_string .= $incoming_timestamp;
    $hash_string .= $key;

    // Create hash.
    $hash = hash('SHA256', $hash_string);

    // We make sure the hash is the same we generate.
    if ($request->query->get('hash') === $hash) {
      $order_id = $request->query->get('orderNumber');
      $order = \Drupal::entityTypeManager()->getStorage('commerce_order')->load($order_id);
      $changed_timestamp = $order->get('placed')->value === null && $order->get('completed')->value === null ? $order->get('changed')->value : null;
      //$time_diff = (date('i', ($incoming_timestamp / 1000))) - date('i', $changed_timestamp);

      // Get Transaction status.
      $transaction_status = $request->query->get('transactionStatus');
      // Get Transaction type (credit card or eCheck).
      $transaction_type = $request->query->get('transactionType');
      $success_codes = $transaction_type === "3" ? ["5","6","8"] : $transaction_status;

      // Validating Timeout (5 min) since the order was sent to Quikpay and the status was successful.
      $successful_payment = FALSE;
      if (($transaction_type === "3" && in_array($transaction_status, $success_codes)) || (in_array($transaction_type, ["1", "2"]) && $success_codes === "1")) {
        $order_total_amount = floatval($order->getTotalPrice()->getNumber());
        $total_amount_paid = ($request->query->get('transactionTotalAmount') / 100);
        if ($total_amount_paid == $order_total_amount) { // TODO Are we going to add fees? change to >=
          $successful_payment = TRUE;
        } else {
          throw new PaymentGatewayException('Charged amount not equal to order amount.');
        }
      }

      if (/* $time_diff <= 5 && */ $successful_payment) { // TODO: Do we need time validation? change to <=
        $successful_string = '';
        $successful_string .= $order_id;
        $successful_string .= $successful_payment;
        
        $successful_value = hash('SHA256', $successful_string . $key);
        // If the payment was successful we redirect to the complete order.
        $url = Url::fromUri('internal:/checkout/' . $order_id . '/payment/return');
        $link_options = [
          'query' => [
            'paid' => $successful_value,
            'success' => $successful_payment
          ]
        ];
        $url->setOptions($link_options);
        $destination = $url->toString();

        $response = new RedirectResponse($destination);
        $response->send();
      }
    }
  }

}
