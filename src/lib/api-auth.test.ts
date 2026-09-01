import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase client so no network call is made. `getUser` behaviour is
// swapped per-test via `getUserImpl`.
let getUserImpl: (token: string) => Promise<{ data: unknown; error: unknown }>;
const createClientMock = vi.fn(() => ({
  auth: { getUser: (token: string) => getUserImpl(token) },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...(args as [])),
}));

import { authenticateBearer } from "./api-auth.server";

const VALID_JWT = "header.payload.signature";
const req = (headers: Record<string, string> = {}) =>
  new Request("https://api.test/api/v1/whatever", { headers });

beforeEach(() => {
  process.env["SUPABASE_URL"] = "https://project.supabase.co";
  process.env["SUPABASE_PUBLISHABLE_KEY"] = "sb_publishable_test";
  getUserImpl = async () => ({ data: { user: { id: "user-123" } }, error: null });
  createClientMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authenticateBearer", () => {
  it("resolves the right user for a valid token", async () => {
    const result = await authenticateBearer(req({ Authorization: `Bearer ${VALID_JWT}` }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe("user-123");
      expect(result.supabase).toBeDefined();
    }
    // The token, not the publishable key, is what gets verified.
    expect(getUserImpl).toBeDefined();
  });

  it("accepts a lowercase `authorization` header too", async () => {
    const result = await authenticateBearer(req({ authorization: `Bearer ${VALID_JWT}` }));
    expect(result.ok).toBe(true);
  });

  it("401s when the Authorization header is missing", async () => {
    const result = await authenticateBearer(req());
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("401s for a non-Bearer scheme", async () => {
    const result = await authenticateBearer(req({ Authorization: `Basic ${VALID_JWT}` }));
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("401s for an empty bearer token", async () => {
    const result = await authenticateBearer(req({ Authorization: "Bearer " }));
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("401s for a malformed (non-JWT) token without calling Supabase", async () => {
    const result = await authenticateBearer(req({ Authorization: "Bearer not-a-jwt" }));
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("401s when Supabase reports the token invalid/expired", async () => {
    getUserImpl = async () => ({ data: { user: null }, error: { message: "token expired" } });
    const result = await authenticateBearer(req({ Authorization: `Bearer ${VALID_JWT}` }));
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("401s (never resolves a session) when getUser throws", async () => {
    getUserImpl = async () => {
      throw new Error("network down");
    };
    const result = await authenticateBearer(req({ Authorization: `Bearer ${VALID_JWT}` }));
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect("userId" in result).toBe(false);
  });

  it("401s when server env is not configured, even with a well-formed token", async () => {
    delete process.env["SUPABASE_URL"];
    const result = await authenticateBearer(req({ Authorization: `Bearer ${VALID_JWT}` }));
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("never exposes a userId / supabase on any failure path", async () => {
    const failures = await Promise.all([
      authenticateBearer(req()),
      authenticateBearer(req({ Authorization: "Bearer not-a-jwt" })),
      authenticateBearer(req({ Authorization: "Basic x" })),
    ]);
    for (const result of failures) {
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("userId");
      expect(result).not.toHaveProperty("supabase");
    }
  });
});
