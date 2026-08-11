import { delay } from "./delay.js";

type StripeMockServer = {
  url: string;
  api_key: string;
} | null;

declare global {
  var stripeServer: StripeMockServer;
}

export type Payment = {
  amount: string;
  total: string;
  fee: string;
  timestamp: string;
};

const headers = { "Content-type": "application/json" };

class Stripe {
  private server: StripeMockServer = null;

  constructor() {
    if (!global.stripeServer) {
      const connection = {
        url: process.env.STRIPE_URL!,
        api_key: process.env.STRIPE_API_KEY!,
      };
      global.stripeServer = connection;
      this.server = global.stripeServer;
    }
  }

  async check() {
    if (!this.server)
      return new Response(undefined, {
        status: 503,
        statusText: "Server not available",
        headers,
      });
  }

  async charge(payment: unknown) {
    this.check();
    await delay();
    return new Response(JSON.stringify(payment), {
      status: 200,
      headers,
      statusText: "Payment charged",
    });
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
