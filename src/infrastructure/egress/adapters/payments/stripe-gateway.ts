import {
  ChargeIntent,
  ChargeResult,
  Currency,
  RefundIntent,
  RefundResult,
} from "@/domain/models/payments";
import { PaymentsGateway } from "@/domain/ports/payments-gateway";
import {
  StripeAPI,
  StripeCharge,
  StripeChargeRequest,
  StripeErrorBody,
  StripeRefund,
  StripeRefundRequest,
} from "@/stubs/stripe-api.mock";
import { toMajorUnits, toMinorUnits } from "./money";

export function getStripeChargePayload(
  intent: ChargeIntent,
): StripeChargeRequest {
  return {
    amount: toMinorUnits(intent.amount),
    currency: intent.currency,
    customer: intent.customer_id,
    description: intent.description,
    metadata: intent.metadata,
    card: {
      brand: intent.method.brand,
      last4: intent.method.last4,
      exp_month: intent.method.exp_month,
      exp_year: intent.method.exp_year,
    },
  };
}

export function getStripeRefundPayload(
  intent: RefundIntent,
): StripeRefundRequest {
  const payload: StripeRefundRequest = {
    // There is no payments store yet, so the id the caller holds is the
    // processor's own charge id
    charge: intent.payment_id,
    reason: intent.reason,
    metadata: intent.metadata,
  };

  // A null amount is a full refund: the processor resolves it from the charge
  if (intent.amount !== null) {
    payload.amount = toMinorUnits(intent.amount);
  }

  return payload;
}

// The processor answers in its own terms: minor units, lowercase currency,
// epoch seconds. Nothing of that shape survives past this function.
function toChargeResult(charge: StripeCharge): ChargeResult {
  const { balance_transaction: transaction } = charge;

  return {
    status: "charged",
    processor_payment_id: charge.id,
    currency: charge.currency.toUpperCase() as Currency,
    amount: toMajorUnits(charge.amount),
    fee: toMajorUnits(transaction.fee),
    net: toMajorUnits(transaction.net),
    created_at: new Date(charge.created * 1000).toISOString(),
  };
}

function toFailedResult(body: StripeErrorBody): ChargeResult {
  const { error } = body;

  return {
    status: "failed",
    // A decline still gets a charge id; a malformed request never gets one
    processor_payment_id: error.charge ?? null,
    failure: {
      code: error.code,
      message: error.message,
      // A declined card and a bad request both fail the same way on a retry.
      // What is worth retrying never reaches here: it throws below
      retryable: false,
    },
  };
}

// Same trip back as toChargeResult. The fee of the original charge is not
// returned, so there is nothing to subtract here: amount is the whole movement.
function toRefundResult(refund: StripeRefund): RefundResult {
  return {
    status: "refunded",
    processor_refund_id: refund.id,
    processor_payment_id: refund.charge,
    currency: refund.currency.toUpperCase() as Currency,
    amount: toMajorUnits(refund.amount),
    created_at: new Date(refund.created * 1000).toISOString(),
  };
}

function toFailedRefundResult(body: StripeErrorBody): RefundResult {
  const { error } = body;

  return {
    status: "failed",
    // Unlike a declined charge, a rejected refund is never given an id: the
    // processor does not name a movement it did not make
    processor_refund_id: null,
    failure: {
      code: error.code,
      message: error.message,
      // Same as a charge: what is worth retrying throws before reaching here
      retryable: false,
    },
  };
}

export class StripeGateway implements PaymentsGateway {
  async charge(intent: ChargeIntent): Promise<ChargeResult> {
    const payload = getStripeChargePayload(intent);
    const response = await StripeAPI.charge(payload);

    if (response.status >= 500) {
      throw new Error(
        `[stripe]: unavailable, ${response.status} ${response.statusText}`,
      );
    }
    // From here the processor did answer, so every path is a ChargeResult
    return response.ok
      ? toChargeResult((await response.json()) as StripeCharge)
      : toFailedResult((await response.json()) as StripeErrorBody);
  }

  async refund(intent: RefundIntent): Promise<RefundResult> {
    const payload = getStripeRefundPayload(intent);
    const response = await StripeAPI.refund(payload);

    if (response.status >= 500) {
      throw new Error(
        `[stripe]: unavailable, ${response.status} ${response.statusText}`,
      );
    }

    return response.ok
      ? toRefundResult((await response.json()) as StripeRefund)
      : toFailedRefundResult((await response.json()) as StripeErrorBody);
  }
}
