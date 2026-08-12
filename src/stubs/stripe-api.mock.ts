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

// Test card: any card ending in 0002 gets declined, like Stripe's magic numbers
const DECLINED_LAST4 = "0002";

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

    await delay();

    const body = request as Partial<StripeChargeRequest> | null;

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

    return json(charge, 200, "Payment charged");
  }

  async refund(payment: unknown) {
    this.check();
    await delay();
    const refund = {
      ...(payment as Record<string, unknown>),
      refunded: new Date().toLocaleDateString(),
      approved: true,
      deposit: false,
    };

    return new Response(JSON.stringify(refund), {
      status: 201,
      statusText: "Refund made",
      headers,
    });
  }
}

export const StripeAPI = new Stripe();
