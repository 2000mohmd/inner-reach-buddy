import { beforeEach, describe, expect, it } from "vitest";
import { unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from "./email.server";

beforeEach(() => {
  process.env["EMAIL_UNSUBSCRIBE_SECRET"] = "test-secret";
  process.env["APP_BASE_URL"] = "https://app.test";
});

describe("unsubscribe token", () => {
  it("round-trips for the same user", async () => {
    const token = await unsubscribeToken("user-1");
    expect(await verifyUnsubscribeToken("user-1", token)).toBe(true);
  });

  it("rejects a token minted for a different user", async () => {
    const token = await unsubscribeToken("user-1");
    expect(await verifyUnsubscribeToken("user-2", token)).toBe(false);
  });

  it("rejects empty / garbage / missing inputs", async () => {
    expect(await verifyUnsubscribeToken("user-1", "")).toBe(false);
    expect(await verifyUnsubscribeToken("user-1", "deadbeef")).toBe(false);
    expect(await verifyUnsubscribeToken("", "whatever")).toBe(false);
  });

  it("changes when the secret changes (can't be forged without it)", async () => {
    const a = await unsubscribeToken("user-1");
    process.env["EMAIL_UNSUBSCRIBE_SECRET"] = "a-different-secret";
    const b = await unsubscribeToken("user-1");
    expect(a).not.toBe(b);
    expect(await verifyUnsubscribeToken("user-1", a)).toBe(false);
  });

  it("builds a URL to the public route carrying u and a valid t", async () => {
    const url = await unsubscribeUrl("user-1");
    expect(url.startsWith("https://app.test/api/public/unsubscribe?u=user-1&t=")).toBe(true);
    const token = new URL(url).searchParams.get("t");
    expect(token).toBeTruthy();
    expect(await verifyUnsubscribeToken("user-1", token as string)).toBe(true);
  });
});
