import { delay } from "./delay.js";

export type StripeMockServer = {
  url: string;
  api_key: string;
} | null;

// What the processor accepts: amounts in minor units, lowercase ISO currency
export type StripeChargeRequest = {
  amount: number;
  currency: string;
  customer: string;
  description?: string | null;
  metadata?: Record<string, string>;
  card: StripeCard;
};

export type StripeCard = {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
};

export type StripeCharge = {
  id: string;
  object: "charge";
  amount: number;
  amount_refunded: number;
  currency: string;
  customer: string;
  description: string | null;
  status: "succeeded";
  paid: boolean;
  captured: boolean;
  created: number;
  livemode: boolean;
  payment_method_details: {
    type: "card";
    card: StripeCard;
  };
  // Where the processor reports what it kept and what it owes you
  balance_transaction: {
    id: string;
    object: "balance_transaction";
    amount: number;
    fee: number;
    net: number;
    currency: string;
    created: number;
    available_on: number;
  };
  metadata: Record<string, string>;
};

// The currency is not asked for: it comes from the charge, like in the real
// API. An absent amount means the whole balance left on it
export type StripeRefundRequest = {
  charge: string;
  amount?: number;
  reason?: string | null;
  metadata?: Record<string, string>;
};

export type StripeRefund = {
  id: string;
  object: "refund";
  amount: number;
  charge: string;
  currency: string;
  reason: string | null;
  status: "succeeded";
  created: number;
  livemode: boolean;
  // The money leaves the balance, so it is reported negative. The fee of the
  // original charge is not given back: that is why fee is 0 and net is -amount.
  balance_transaction: {
    id: string;
    object: "balance_transaction";
    amount: number;
    fee: number;
    net: number;
    currency: string;
    created: number;
  };
  metadata: Record<string, string>;
};

export type StripeErrorBody = {
  error: {
    type: "invalid_request_error" | "card_error";
    code: string;
    message: string;
    charge?: string;
  };
};

const headers = { "Content-type": "application/json" };

// 2.9% + 30 minor units, the classic published rate
const FEE_RATE = 0.029;
const FEE_FIXED = 30;
const PAYOUT_DELAY = 60 * 60 * 24 * 2;

// Test cards, like Stripe's magic numbers. The first one is an answer from the
// processor; the other two are the absence of one, which is what the circuit
// breaker exists to notice: a decline is a result, an outage is a failure.
const DECLINED_LAST4 = "0002";
const OUTAGE_LAST4 = "0500";
const SLOW_LAST4 = "0001";

// Longer than the breaker's timeout_period, so the race is never close
const SLOW_DELAY = 30_000;

// A refund needs to know the charge it is undoing: its currency, and how much
// of it is still there. Lives as long as the process, which is enough for a stub
const charges = new Map<string, StripeCharge>();

function token(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

function json(body: unknown, status: number, statusText: string) {
  return new Response(JSON.stringify(body), { status, statusText, headers });
}

class Stripe {
  private server: StripeMockServer = null;

  constructor() {
    global.stripeServer ??= {
      url: process.env.STRIPE_URL!,
      api_key: process.env.STRIPE_API_KEY!,
    };
    this.server = global.stripeServer;
  }

  private check() {
    if (!this.server) {
      return new Response(undefined, {
        status: 503,
        statusText: "Server not available",
        headers,
      });
    }
  }

  async charge(request: unknown) {
    const unavailable = this.check();
    if (unavailable) return unavailable;

    const body = request as Partial<StripeChargeRequest> | null;
    const last4 = body?.card?.last4;

    // No body and no error shape: the processor did not answer at all. The
    // adapter turns any 5xx into a throw, and that throw is what the breaker
    // counts. Checked before the delay: an outage does not make you wait.
    if (last4 === OUTAGE_LAST4) {
      return new Response(undefined, {
        status: 503,
        statusText: "Service unavailable",
        headers,
      });
    }

    // Answers, but too late to be worth anything: the breaker gives up first
    await delay(last4 === SLOW_LAST4 ? SLOW_DELAY : undefined);

    if (
      typeof body?.amount !== "number" ||
      !Number.isInteger(body.amount) ||
      body.amount <= 0 ||
      typeof body.currency !== "string" ||
      typeof body.customer !== "string" ||
      !body.card
    ) {
      const error: StripeErrorBody = {
        error: {
          type: "invalid_request_error",
          code: "parameter_invalid",
          message:
            "amount must be a positive integer in minor units, and currency, customer and card are required",
        },
      };

      console.error(JSON.stringify(error));
      return json(error, 400, "Invalid request");
    }

    if (body.card.last4 === DECLINED_LAST4) {
      const error: StripeErrorBody = {
        error: {
          type: "card_error",
          code: "card_declined",
          message: "Your card was declined.",
          charge: token("ch"),
        },
      };

      return json(error, 402, "Card declined");
    }

    const created = Math.floor(Date.now() / 1000);
    const currency = body.currency.toLowerCase();
    const fee = Math.round(body.amount * FEE_RATE) + FEE_FIXED;

    const charge: StripeCharge = {
      id: token("ch"),
      object: "charge",
      amount: body.amount,
      amount_refunded: 0,
      currency,
      customer: body.customer,
      description: body.description ?? null,
      status: "succeeded",
      paid: true,
      captured: true,
      created,
      livemode: false,
      payment_method_details: {
        type: "card",
        card: body.card,
      },
      balance_transaction: {
        id: token("txn"),
        object: "balance_transaction",
        amount: body.amount,
        fee,
        net: body.amount - fee,
        currency,
        created,
        available_on: created + PAYOUT_DELAY,
      },
      metadata: body.metadata ?? {},
    };

    charges.set(charge.id, charge);

    return json(charge, 200, "Payment charged");
  }

  async refund(request: unknown) {
    const unavailable = this.check();
    if (unavailable) return unavailable;

    await delay();

    const body = request as Partial<StripeRefundRequest> | null;
    const { amount } = body ?? {};

    if (
      typeof body?.charge !== "string" ||
      (amount !== undefined &&
        (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0))
    ) {
      const error: StripeErrorBody = {
        error: {
          type: "invalid_request_error",
          code: "parameter_invalid",
          message:
            "charge is required, and amount must be a positive integer in minor units when present",
        },
      };

      console.error(JSON.stringify(error));
      return json(error, 400, "Invalid request");
    }

    const charge = charges.get(body.charge);

    if (!charge) {
      const error: StripeErrorBody = {
        error: {
          type: "invalid_request_error",
          code: "resource_missing",
          message: `No such charge: '${body.charge}'`,
          charge: body.charge,
        },
      };

      return json(error, 404, "No such charge");
    }

    const refundable = charge.amount - charge.amount_refunded;

    if (refundable === 0) {
      const error: StripeErrorBody = {
        error: {
          type: "invalid_request_error",
          code: "charge_already_refunded",
          message: `Charge ${charge.id} has already been refunded.`,
          charge: charge.id,
        },
      };

      return json(error, 400, "Charge already refunded");
    }

    // No amount given is a full refund: whatever is left on the charge
    const refunded = amount ?? refundable;

    if (refunded > refundable) {
      const error: StripeErrorBody = {
        error: {
          type: "invalid_request_error",
          code: "amount_too_large",
          message: `Refund amount (${refunded}) is greater than the ${refundable} left on charge ${charge.id}.`,
          charge: charge.id,
        },
      };

      return json(error, 400, "Amount too large");
    }

    const created = Math.floor(Date.now() / 1000);
    charge.amount_refunded += refunded;

    const refund: StripeRefund = {
      id: token("re"),
      object: "refund",
      amount: refunded,
      charge: charge.id,
      currency: charge.currency,
      reason: body.reason ?? null,
      status: "succeeded",
      created,
      livemode: false,
      balance_transaction: {
        id: token("txn"),
        object: "balance_transaction",
        amount: -refunded,
        fee: 0,
        net: -refunded,
        currency: charge.currency,
        created,
      },
      metadata: body.metadata ?? {},
    };

    return json(refund, 200, "Refund made");
  }
}

export const StripeAPI = new Stripe();
