import express, { Express } from "express";
import { chargePayment, refundPayment } from "../application/services/payments";
import { CircuitBreaker as Circuit } from "../infrastructure/egress/circuit-breaker";
import "dotenv/config";
import { getChargePayload } from "../application/services/adapters";

const server: Express = express();
server.use(express.json());

server.post("/charge", async (req, res) => {
  const { body } = req;

  // headers, fields sanitization and checks here

  const paymentsAvailable = Circuit.checkServiceAvailability("payments");
  if (!paymentsAvailable) {
    res.status(503).json({ error: "Payments service is not available" });
    return;
  }

  const parsingResult = getChargePayload(body);

  if (!parsingResult.ok) {
    res.status(400).json({ error: parsingResult.error });
  } else {
    const response = await chargePayment(parsingResult.data);
    console.log(response);
    res.status(response.status);
    response.ok ? res.json(response.data) : res.json({ error: response.error });
  }
});

server.post("/refund", async (req, res) => {
  const { body } = req;

  // headers, fields sanitization and checks here

  const response = await refundPayment(body);
  res.status(response.status);
  if (response.ok) {
    res.json(response.data);
  } else {
    res.json({ error: response.error });
  }
});

// In order, last matching for not found endpoints
server.use((req, res) => {
  res.status(404).json({ error: "Bad request" });
});

export { server };
