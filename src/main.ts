import { CircuitBreaker } from "./infrastructure/egress/circuit-breaker";
import { server as stripeServer } from "./stubs/stripe-server.mock";

const hostname = process.env.hostname;
const port = Number(process.env.port);

async function init() {
  if (!hostname || !port) {
    throw new Error("[init]: missing server config");
  }

  CircuitBreaker.init();
  stripeServer.listen(port, hostname, () => {
    console.info("[stripe]: stub server listening on port:", port);
  });
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});
