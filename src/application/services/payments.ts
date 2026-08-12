import {
  ChargeIntent,
  ChargeResult,
  Payment,
} from "../../domain/models/payments.js";
import {
  RuleViolation,
  validateCharge,
} from "../../domain/validations/payments.js";
import { PaymentsGateway } from "../../ports/payments-gateway.js";

// What the processor can answer, plus what never got as far as asking it
export type ChargePaymentResult =
  | ChargeResult
  | { status: "invalid"; violations: RuleViolation[] };

export async function chargePayment(
  intent: ChargeIntent,
  gateway: PaymentsGateway,
): Promise<ChargePaymentResult> {
  const validation = validateCharge(intent);

  if (!validation.valid) {
    return { status: "invalid", violations: validation.violations };
  }

  return await gateway.charge(intent);
}

export async function refundPayment(
  payment: Payment,
  gateway: PaymentsGateway,
) {
  return gateway.refund(payment);
}
