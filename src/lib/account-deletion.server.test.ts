import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  cancelCalls: [] as string[],
  cancelShouldThrow: false,
}));

vi.mock("./billing/stripe.server", () => ({
  cancelStripeSubscription: async (subscriptionId: string) => {
    h.cancelCalls.push(subscriptionId);
    if (h.cancelShouldThrow) throw new Error("Stripe unreachable");
  },
}));

import { deleteAccountCore } from "./account-deletion.server";

function fakeAdmin(opts: {
  subscriptionId?: string | null;
  rpcError?: string | null;
  deleteUserError?: Error | null;
}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const deleteUserCalls: string[] = [];

  return {
    client: {
      from: (table: string) => {
        if (table !== "profiles") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  opts.subscriptionId === undefined
                    ? null
                    : { stripe_subscription_id: opts.subscriptionId },
                error: null,
              }),
            }),
          }),
        };
      },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { error: opts.rpcError ? { message: opts.rpcError } : null };
      },
      auth: {
        admin: {
          deleteUser: async (userId: string) => {
            deleteUserCalls.push(userId);
            return { error: opts.deleteUserError ?? null };
          },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub, shape matched to what deleteAccountCore actually calls
    } as any,
    rpcCalls,
    deleteUserCalls,
  };
}

describe("deleteAccountCore", () => {
  it("cancels the Stripe subscription, runs the RPC, then deletes the auth user", async () => {
    h.cancelCalls.length = 0;
    h.cancelShouldThrow = false;
    const { client, rpcCalls, deleteUserCalls } = fakeAdmin({ subscriptionId: "sub_123" });

    await deleteAccountCore(client, "user-1");

    expect(h.cancelCalls).toEqual(["sub_123"]);
    expect(rpcCalls).toEqual([{ fn: "delete_account", args: { p_user_id: "user-1" } }]);
    expect(deleteUserCalls).toEqual(["user-1"]);
  });

  it("skips Stripe cancellation entirely when there is no subscription on file", async () => {
    h.cancelCalls.length = 0;
    h.cancelShouldThrow = false;
    const { client, deleteUserCalls } = fakeAdmin({ subscriptionId: null });

    await deleteAccountCore(client, "user-2");

    expect(h.cancelCalls).toEqual([]);
    expect(deleteUserCalls).toEqual(["user-2"]);
  });

  it("still deletes the account when Stripe cancellation fails", async () => {
    h.cancelCalls.length = 0;
    h.cancelShouldThrow = true;
    const { client, deleteUserCalls } = fakeAdmin({ subscriptionId: "sub_456" });

    await expect(deleteAccountCore(client, "user-3")).resolves.toBeUndefined();

    expect(h.cancelCalls).toEqual(["sub_456"]);
    expect(deleteUserCalls).toEqual(["user-3"]);
  });

  it("throws and never deletes the auth user if the delete_account RPC fails", async () => {
    const { client, deleteUserCalls } = fakeAdmin({ subscriptionId: null, rpcError: "boom" });

    await expect(deleteAccountCore(client, "user-4")).rejects.toThrow(/boom/);
    expect(deleteUserCalls).toEqual([]);
  });

  it("propagates an auth.admin.deleteUser error", async () => {
    const { client } = fakeAdmin({
      subscriptionId: null,
      deleteUserError: new Error("delete failed"),
    });

    await expect(deleteAccountCore(client, "user-5")).rejects.toThrow(/delete failed/);
  });
});
