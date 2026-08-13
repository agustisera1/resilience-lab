import {
  ChargeIntent,
  ChargeResult,
  RefundIntent,
  RefundResult,
} from "@/domain/models/payments";
import {
  RuleViolation,
  validateCharge,
  validateRefund,
} from "@/domain/validations/payments";
import { PaymentsGateway } from "@/domain/ports/payments-gateway";
import { CircuitBreaker } from "@/infrastructure/egress/circuit-breaker/circuit-breaker";

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

  return await CircuitBreaker.execute(async () => await gateway.charge(intent));
}

export type RefundPaymentResult =
  | RefundResult
  | { status: "invalid"; violations: RuleViolation[] };

export async function refundPayment(
  intent: RefundIntent,
  gateway: PaymentsGateway,
): Promise<RefundPaymentResult> {
  const validation = validateRefund(intent);

  if (!validation.valid) {
    return { status: "invalid", violations: validation.violations };
  }

  return CircuitBreaker.execute(async () => await gateway.refund(intent));
}
