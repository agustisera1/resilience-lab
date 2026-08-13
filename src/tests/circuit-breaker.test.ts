import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "@/infrastructure/egress/circuit-breaker/circuit-breaker";

// Mirrors the private defaults of the constructor. The breaker exposes no way
// to configure them, so the suite has to speak the same numbers.
const FAILURE_THRESHOLD = 5;
const TIMEOUT_PERIOD = 10_000;
const RECOVERY_TIMEOUT = 15_000;

const breaker = () => globalThis.circuitBreaker;

const succeeding = () => Promise.resolve("charged");
const failing = () => Promise.reject(new Error("gateway down"));
const hanging = () => new Promise<never>(() => {});

// Burns enough failures to trip the breaker from CLOSED into OPEN.
async function tripCircuit(failures: number = FAILURE_THRESHOLD) {
  for (let i = 0; i < failures; i++) {
    await expect(CircuitBreaker.execute(failing)).rejects.toThrow();
  }
}

// Every message a console spy received, flattened for substring matching.
const messages = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => call.join(" ")).join("\n");

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // The singleton lives on globalThis, so it has to be torn down by hand
  Reflect.deleteProperty(globalThis, "circuitBreaker");

  vi.useFakeTimers();
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("init", () => {
  it("starts closed", () => {
    CircuitBreaker.init();

    expect(breaker().state).toBe("CLOSED");
  });

  it("refuses to initialize twice", () => {
    CircuitBreaker.init();

    expect(() => CircuitBreaker.init()).toThrow("already initialized");
  });

  it("refuses to execute before init", async () => {
    await expect(CircuitBreaker.execute(succeeding)).rejects.toThrow(
      "not initialized",
    );
  });
});

describe("closed circuit", () => {
  beforeEach(() => CircuitBreaker.init());

  it("returns whatever the wrapped call returns", async () => {
    await expect(CircuitBreaker.execute(succeeding)).resolves.toBe("charged");
    expect(breaker().state).toBe("CLOSED");
  });

  it("propagates the original error instead of wrapping it", async () => {
    await expect(CircuitBreaker.execute(failing)).rejects.toThrow(
      "gateway down",
    );
  });

  it("stays closed while failures sit below the threshold", async () => {
    await tripCircuit(FAILURE_THRESHOLD - 1);

    expect(breaker().state).toBe("CLOSED");
  });

  it("opens on the failure that reaches the threshold", async () => {
    await tripCircuit();

    expect(breaker().state).toBe("OPEN");
  });

  it("forgets earlier failures after a success", async () => {
    await tripCircuit(FAILURE_THRESHOLD - 1);
    await CircuitBreaker.execute(succeeding);

    // The counter restarted, so another near-miss run must not open it
    await tripCircuit(FAILURE_THRESHOLD - 1);

    expect(breaker().state).toBe("CLOSED");
  });

  it("counts a call that outlives the timeout period as a failure", async () => {
    const rejects = expect(CircuitBreaker.execute(hanging)).rejects.toThrow(
      "Request Timeout",
    );

    await vi.advanceTimersByTimeAsync(TIMEOUT_PERIOD);
    await rejects;
  });
});

describe("open circuit", () => {
  beforeEach(async () => {
    CircuitBreaker.init();
    await tripCircuit();
  });

  it("fast-fails without touching the wrapped call", async () => {
    const apiCall = vi.fn(succeeding);

    await expect(CircuitBreaker.execute(apiCall)).rejects.toThrow("fast-fail");
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("keeps cooling down until the very last millisecond", async () => {
    vi.advanceTimersByTime(RECOVERY_TIMEOUT - 1);

    await expect(CircuitBreaker.execute(succeeding)).rejects.toThrow(
      "fast-fail",
    );
    expect(breaker().state).toBe("OPEN");
  });

  it("probes the service in HALF_OPEN once the cooldown elapses", async () => {
    vi.advanceTimersByTime(RECOVERY_TIMEOUT);

    let stateDuringProbe: string | undefined;
    await CircuitBreaker.execute(async () => {
      stateDuringProbe = breaker().state;
      return "charged";
    });

    expect(stateDuringProbe).toBe("HALF_OPEN");
  });

  it("closes the circuit when the probe succeeds", async () => {
    vi.advanceTimersByTime(RECOVERY_TIMEOUT);

    await expect(CircuitBreaker.execute(succeeding)).resolves.toBe("charged");
    expect(breaker().state).toBe("CLOSED");
  });

  it("re-opens on a single failed probe, without waiting for the threshold", async () => {
    vi.advanceTimersByTime(RECOVERY_TIMEOUT);

    await expect(CircuitBreaker.execute(failing)).rejects.toThrow(
      "gateway down",
    );

    expect(breaker().state).toBe("OPEN");
  });

  it("restarts the cooldown after a failed probe", async () => {
    vi.advanceTimersByTime(RECOVERY_TIMEOUT);
    await expect(CircuitBreaker.execute(failing)).rejects.toThrow();

    // Far enough for the first cooldown, not for the one the probe restarted
    vi.advanceTimersByTime(RECOVERY_TIMEOUT - 1);

    await expect(CircuitBreaker.execute(succeeding)).rejects.toThrow(
      "fast-fail",
    );
  });
});

describe("logs", () => {
  beforeEach(() => CircuitBreaker.init());

  it("reports the configuration it booted with", () => {
    expect(messages(info)).toContain(`threshold: ${FAILURE_THRESHOLD}`);
    expect(messages(info)).toContain(`recovery: ${RECOVERY_TIMEOUT}ms`);
  });

  it("counts failures as they pile up", async () => {
    await tripCircuit(2);

    expect(messages(warn)).toContain(`Failure count: 1/${FAILURE_THRESHOLD}`);
    expect(messages(warn)).toContain(`Failure count: 2/${FAILURE_THRESHOLD}`);
  });

  it("names the transition when the circuit opens", async () => {
    await tripCircuit();

    expect(messages(error)).toContain("CLOSED -> OPEN");
  });

  it("names the transition when the probe fails", async () => {
    await tripCircuit();
    vi.advanceTimersByTime(RECOVERY_TIMEOUT);
    await expect(CircuitBreaker.execute(failing)).rejects.toThrow();

    expect(messages(error)).toContain("HALF_OPEN -> OPEN");
  });

  it("names the transition when the circuit recovers", async () => {
    await tripCircuit();
    vi.advanceTimersByTime(RECOVERY_TIMEOUT);
    await CircuitBreaker.execute(succeeding);

    expect(messages(info)).toContain("HALF_OPEN -> CLOSED");
  });

  it("reports the remaining cooldown on a fast-fail", async () => {
    await tripCircuit();
    vi.advanceTimersByTime(5_000);

    await expect(CircuitBreaker.execute(succeeding)).rejects.toThrow();

    expect(messages(warn)).toContain(
      `Circuit OPEN, retry in ${RECOVERY_TIMEOUT - 5_000}ms`,
    );
  });
});
