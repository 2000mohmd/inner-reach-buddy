import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyStripeWebhook } from "./stripe.server";

const SECRET = "whsec_test_secret";

async function sign(payload: string, timestamp: number, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("verifyStripeWebhook", () => {
  beforeEach(() => {
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
  });
  afterEach(() => {
    delete process.env["STRIPE_WEBHOOK_SECRET"];
  });

  it("accepts a correctly signed, fresh payload", async () => {
    const body = JSON.stringify({
      id: "evt_1",
      type: "customer.subscription.updated",
      data: { object: {} },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await sign(body, timestamp, SECRET);

    const event = await verifyStripeWebhook(body, `t=${timestamp},v1=${signature}`);
    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("customer.subscription.updated");
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const body = JSON.stringify({ id: "evt_2", type: "x", data: { object: {} } });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await sign(body, timestamp, "whsec_wrong");

    await expect(verifyStripeWebhook(body, `t=${timestamp},v1=${signature}`)).rejects.toThrow(
      /signature mismatch/i,
    );
  });

  it("rejects a tampered body even with a validly-formatted signature", async () => {
    const original = JSON.stringify({ id: "evt_3", type: "x", data: { object: { amount: 100 } } });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await sign(original, timestamp, SECRET);
    const tampered = JSON.stringify({
      id: "evt_3",
      type: "x",
      data: { object: { amount: 999999 } },
    });

    await expect(verifyStripeWebhook(tampered, `t=${timestamp},v1=${signature}`)).rejects.toThrow(
      /signature mismatch/i,
    );
  });

  it("rejects a replayed (stale) timestamp outside tolerance", async () => {
    const body = JSON.stringify({ id: "evt_4", type: "x", data: { object: {} } });
    const staleTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes old
    const signature = await sign(body, staleTimestamp, SECRET);

    await expect(verifyStripeWebhook(body, `t=${staleTimestamp},v1=${signature}`)).rejects.toThrow(
      /tolerance/i,
    );
  });

  it("rejects a missing signature header", async () => {
    await expect(verifyStripeWebhook("{}", null)).rejects.toThrow(/missing/i);
  });

  it("throws when STRIPE_WEBHOOK_SECRET isn't configured", async () => {
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    await expect(verifyStripeWebhook("{}", "t=1,v1=abc")).rejects.toThrow(/not configured/i);
  });
});
