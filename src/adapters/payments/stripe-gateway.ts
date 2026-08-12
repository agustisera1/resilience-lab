import {
  ChargeIntent,
  ChargeResult,
  Currency,
  Payment,
} from "../../domain/models/payments";
import { PaymentsGateway } from "../../ports/payments-gateway";
import {
  StripeAPI,
  StripeCharge,
  StripeChargeRequest,
  StripeErrorBody,
} from "../../stubs/stripe-api.mock";
import { toMajorUnits, toMinorUnits } from "./lib";

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

  async refund(payment: Payment): Promise<void> {}
}
