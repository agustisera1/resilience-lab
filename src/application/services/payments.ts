import { ChargeIntent, Payment } from "../../domain/models/payments.js";
import { getStripeChargePayload } from "../../adapters/payments/adapters.js";
import { ServiceResponse } from "../../domain/models/service-response.js";
import { validateCharge } from "../../domain/validations/payments.js";
import { StripeAPI, StripeCharge } from "../../stubs/stripe-api.mock.js";

export async function chargePayment(
  chargeIntent: ChargeIntent,
): Promise<ServiceResponse<StripeCharge>> {
  const validation = validateCharge(chargeIntent);

  if (!validation.valid) {
    return {
      ok: false,
      error: `${validation.violations.forEach((error, index) => `[${index}]: ${error}_`)}`,
      status: 422, // Unprocessable entity|content
    };
  }

  const data = getStripeChargePayload(chargeIntent); // Use an adapter for the service
  const response = await StripeAPI.charge(data);
  if (response.ok) {
    return {
      ok: true,
      data: await response.json(),
      status: response.status,
    };
  } else {
    return {
      ok: false,
      error: response.statusText,
      status: response.status,
    };
  }
}

export async function refundPayment(payment: Payment) {
  const response = await StripeAPI.refund(payment);

  if (response.ok) {
    return {
      ok: true,
      data: await response.json(),
      status: response.status,
    };
  } else {
    return {
      ok: false,
      error: response.statusText,
      status: response.status,
    };
  }
}
