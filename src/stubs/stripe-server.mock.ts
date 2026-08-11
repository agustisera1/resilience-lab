import express, { Express } from "express";
import "dotenv/config";
import { chargePayment, refundPayment } from "../application/services/payments";

const server: Express = express();
server.use(express.json());

server.post("/charge", async (req, res) => {
  const { body } = req;

  // headers, fields sanitization and checks here

  const response = await chargePayment(body);
  res.status(response.status);
  if (response.ok) {
    res.json(response.data);
  } else {
    res.json({ error: response.error });
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
