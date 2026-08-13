import express, { Express } from "express";
import { chargePayment, refundPayment } from "@/application/services/payments";
import { CircuitBreaker as Circuit } from "@/infrastructure/egress/circuit-breaker/circuit-breaker";
import { getChargePayload } from "@/domain/parsing/charge-payload";
import { PaymentsGateway } from "@/domain/ports/payments-gateway";
import { getRefundPayload } from "@/domain/parsing/refund-payload";
import "dotenv/config";

export function createServer(gateway: PaymentsGateway) {
  const server: Express = express();
  server.use(express.json());
  server.post("/charge", async (req, res) => {
    const { body } = req;

    const parsingResult = getChargePayload(body);

    if (!parsingResult.ok) {
      res.status(400).json({ error: parsingResult.error });
      return;
    }

    try {
      const result = await chargePayment(parsingResult.data, gateway);

      switch (result.status) {
        case "invalid":
          res.status(422).json({ error: result.violations });
          return;
        case "failed":
          res.status(402).json(result);
          return;
        case "charged":
          res.status(200).json(result);
          return;
      }
    } catch (error) {
      // The gateway throws when the processor never answered. That is an
      // outage on their side, not a bad request on ours
      console.error("[charge]:", error);
      res.status(503).json({ error: "Payments service is not available" });
    }
  });

  server.post("/refund", async (req, res) => {
    const { body } = req;

    const parsingResult = getRefundPayload(body);

    if (!parsingResult.ok) {
      res.status(400).json({ error: parsingResult.error });
      return;
    }

    try {
      const result = await refundPayment(parsingResult.data, gateway);

      switch (result.status) {
        case "invalid":
          res.status(422).json({ error: result.violations });
          return;
        case "failed":
          res.status(402).json(result);
          return;
        case "refunded":
          res.status(200).json(result);
          return;
      }
    } catch (error) {
      // The gateway throws when the processor never answered. That is an
      // outage on their side, not a bad request on ours
      console.error("[refund]:", error);
      res.status(503).json({ error: "Payments service is not available" });
    }
  });

  // In order, last matching for not found endpoints
  server.use((req, res) => {
    res.status(404).json({ error: "Bad request" });
  });

  return server;
}
