<?php

namespace Drupal\webspark_blocks\Plugin\Validation\Constraint;

use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * Validates the Anchor URL fragment field value.
 */
class AnchorUrlFragmentValidator extends ConstraintValidator {

  /**
   * {@inheritdoc}
   */
  public function validate($items, Constraint $constraint): void {
    foreach ($items as $item) {
      if ($item->value !== NULL && $item->value !== '' && !AnchorUrlFragment::isValid($item->value)) {
        $this->context->addViolation($constraint->invalidMessage);
      }
    }
  }

}
