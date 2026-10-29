<?php

namespace Drupal\asu_quikpay\PluginForm;

use Drupal\commerce_payment\Exception\PaymentGatewayException;
use Drupal\commerce_payment\PluginForm\PaymentOffsiteForm as BasePaymentOffsiteForm;
use Drupal\Core\Form\FormStateInterface;

class QuikpayRedirectForm extends BasePaymentOffsiteForm {

  /**
   * {@inheritdoc}
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state) {
    $form = parent::buildConfigurationForm($form, $form_state);
    /** @var \Drupal\commerce_payment\Entity\PaymentInterface $payment */
    $payment = $this->entity;

    /** @var \Drupal\commerce_payment\Plugin\Commerce\PaymentGateway\OffsitePaymentGatewayInterface $payment_gateway_plugin */
    $payment_gateway_plugin = $payment->getPaymentGateway()->getPlugin();
    $configuration = $payment_gateway_plugin->getConfiguration();
    $base_url = \Drupal::request()->getSchemeAndHttpHost();

    $url = $configuration['mode'] === "live" ? $configuration["quikpay_prod_url"] : $configuration["quikpay_test_url"];
    $ptkey = $configuration['mode'] === "live" ? $configuration["quikpay_prod_pt_key"] : $configuration["quikpay_test_pt_key"];
    $redirect_method = $configuration["quikpay_redirect"];
    $redirect_url = $base_url . $configuration["quikpay_redirect_url"];
    $order = $payment->getOrder();
    $billing_address = $order->getBillingProfile()->get("address");
    $amount_arr = $payment->getAmount()->getNumber() * 100;


    $order_items = [];
    foreach ($order->getItems() as $key => $order_item) {
      $product = $order_item->getPurchasedEntity();

      $type = $product->get("type")->first()->getValue()["target_id"];
      $price = "$" . number_format($product->get("price")->first()->getValue()["number"], 2);
      $quantity = number_format($order_item->getQuantity(), 0);
      
      if ($type == "product") {
        /* // TODO Handle this through a hook_alter instead of in the Quikpay module.
        if (module_exists("lp_courses")) {
          $class = lp_courses_get_product_class($product, TRUE);
          //$class_title = $class->title;
          $class_id = lp_courses_get_class_id($class);
        } */
      
        // Finally, put it all together.
        $item_entry  = "SKU " . $product->getSku() . " | ";

        /* // TODO Handle this through a hook_alter instead of in the Quikpay module.
        if (module_exists("lp_courses")) {
          $item_entry .= " [nid:" . $class->nid . "] | ";
        } */

        $item_entry .= $quantity . " @ " . $price;
      }
      elseif ($type == "commerce_coupon") {
        $item_entry = "Discount " . $product->getTitle() . " | " . $quantity . " @ " . $price;
        $order_items[] = $item_entry;
      }
      else {
        $item_entry = "Misc " . $product->getTitle() . " | " . $type;
        $order_items[] = $item_entry;
      }
      if (!in_array($item_entry,$order_items)) {
        $order_items[] = $item_entry;
      }
    }

    // Get data for Nelnet together.

    // The digest/hash includes our pass through key and parameters. Order 
    // matters - check pass through authentication documentation.
  
    // Drupal Order ID
    $drupal_order_id = $order->get('order_id')->first()->getValue()["value"];
    $variables = "orderType,orderNumber,amount,userChoice2,userChoice3,userChoice4,userChoice5,userChoice6,userChoice7,userChoice8,userChoice9,userChoice10,streetOne,streetTwo,city,state,zip,email";

    if ($redirect_method == "url") {
      $variables .= ",redirectUrl,redirectUrlParameters,retriesAllowed";
    }

    $variables .= ",timestamp";

    // Set up parameters for payload.
    $param['orderType'] = $configuration['order_type'];
    $param['orderNumber'] = $drupal_order_id;
    $param['amount'] = strval($amount_arr);
    $param['userChoice2'] = '';
    // Individual order items. Trimmed to 48 characters.
    $param['userChoice3'] = isset($order_items[0]) ? substr($order_items[0], 0, 48) : '';
    $param['userChoice4'] = isset($order_items[1]) ? substr($order_items[1], 0, 48) : '';
    $param['userChoice5'] = isset($order_items[2]) ? substr($order_items[2], 0, 48) : '';
    $param['userChoice6'] = isset($order_items[3]) ? substr($order_items[3], 0, 48) : '';
    $param['userChoice7'] = isset($order_items[4]) ? substr($order_items[4], 0, 48) : '';
    $param['userChoice8'] = isset($order_items[5]) ? substr($order_items[5], 0, 48) : '';
    $param['userChoice9'] = isset($order_items[6]) ? substr($order_items[6], 0, 48) : '';
    $param['userChoice10'] = isset($order_items[7]) ? substr($order_items[7], 0, 48) : '';

    // If we have an excess of 8 order items, overwrite last entry.
    if (isset($order_items[8])) { 
      $param['userChoice10'] = "More... For full details see order ID " . $drupal_order_id . ".";
    }

    $param['streetOne'] = $billing_address[0]->get('address_line1')->getValue();
    $param['streetTwo'] = $billing_address[0]->get('address_line2')->getValue();
    $param['city'] = $billing_address[0]->get('locality')->getValue();
    $param['state'] = $billing_address[0]->get('administrative_area')->getValue();
    $param['zip'] = $billing_address[0]->get('postal_code')->getValue();
    $param['email'] = $order->getEmail();

    if ($redirect_method == 'url') {
      $param['redirectUrl'] =  $redirect_url;
      $trans_variables = "transactionType,transactionStatus,transactionId,originalTransactionId,transactionTotalAmount,transactionDate,transactionAcountType,transactionEffectiveDate,transactionDescription,transactionResultDate,transactionResultEffectiveDate,transactionResultCode,transactionResultMessage,orderNumber,orderType,orderName,orderDescription,orderAmount,orderFee,orderAmountDue,orderDueDate,orderBalance,orderCurrentStatusBalance,orderCurrentStatusAmountDue";
      $param['redirectUrlParameters'] = $trans_variables;
      $param['retriesAllowed'] = "1";
    }
    
    // Timestamp in milliseconds.
    $param['timestamp'] = $this->quikpay_get_timestamp();

    $vars = explode(',', $variables);
    // Create hash 
    $hash_string = "";
    foreach ($vars as $key) {
      $hash_string .= $param[$key];
    }
    // If using URL method, need to form truncated hash since most of the trans_variables are not available till post-processing
    //$hash_string = $param['orderNumber'].$param['orderType'].$param['amount']; #Not working
    $param['hash'] = hash('SHA256', $hash_string . $ptkey);
    
    // Form url values.
    return $this->buildRedirectForm($form, $form_state, $url, $param, self::REDIRECT_POST);
  }

  /**
   * Helper function to get timestamp in milliseconds.
   *
   */
  protected function quikpay_get_timestamp() {

    list($msecs, $uts) = explode(' ', microtime());
    $timestamp = floor(($uts + $msecs) * 1000);
  
    // Some configs of PHP can render this as scientific notation. Stop that.
    $timestamp = number_format($timestamp, 0, '.', '');
  
    return $timestamp;
  }
}