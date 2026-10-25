import { beforeEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { createGlanceClient } from "../src/data/convexClient";

const fake = vi.hoisted(() => ({
  mutation: vi.fn(), query: vi.fn(), close: vi.fn(), onUpdate: vi.fn(), localQueryResult: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    mutation = fake.mutation;
    query = fake.query;
    close = fake.close;
    watchQuery() { return { onUpdate: fake.onUpdate, localQueryResult: fake.localQueryResult }; }
  },
}));
beforeEach(() => { vi.resetAllMocks(); fake.onUpdate.mockReturnValue(fake.unsubscribe); fake.localQueryResult.mockReturnValue(undefined); });
it("passes bearer credentials in args rather than URLs and forwards lease metadata", async () => {
  const client = createGlanceClient("https://example.convex.cloud");
  const lease = { leaseUntil: 5000, serverNow: 1000 };
  fake.mutation.mockResolvedValueOnce({ ticketId: "ticket", issuedAt: 0, expiresAt: 5000 }).mockResolvedValueOnce(lease);
  expect(await client.heartbeat("a".repeat(64), "conversation")).toEqual(lease);
  const [ref, args] = fake.mutation.mock.calls[0];
  expect(getFunctionName(ref)).toBe("glance:presenceTicket");
  expect(args).toEqual({ token: "a".repeat(64), conversationId: "conversation" });
  const [ackRef, ackArgs] = fake.mutation.mock.calls[1];
  expect(getFunctionName(ackRef)).toBe("glance:heartbeat");
  expect(ackArgs).toEqual({ token: "a".repeat(64), conversationId: "conversation", ticketId: "ticket" });
});
it("does not request or acknowledge a ticket after local withdrawal", async () => {
  const client = createGlanceClient("https://example.convex.cloud");
  expect(await client.heartbeat("token", "conversation", () => false)).toBeNull();
  expect(fake.mutation).not.toHaveBeenCalled();
});
it("does not acknowledge a ticket request that arrives after local withdrawal", async () => {
  const client = createGlanceClient("https://example.convex.cloud");
  let stillConsenting = true;
  fake.mutation.mockImplementationOnce(async () => {
    stillConsenting = false;
    return { ticketId: "late-ticket", issuedAt: 9000, expiresAt: 14000 };
  });
  expect(await client.heartbeat("token", "conversation", () => stillConsenting)).toBeNull();
  expect(fake.mutation).toHaveBeenCalledTimes(1);
  expect(getFunctionName(fake.mutation.mock.calls[0][0])).toBe("glance:presenceTicket");
});
it("does not deliver a renewal when withdrawal happened while the ACK was in flight", async () => {
  const client = createGlanceClient("https://example.convex.cloud");
  let stillConsenting = true;
  fake.mutation.mockResolvedValueOnce({ ticketId: "ticket", issuedAt: 0, expiresAt: 5000 });
  fake.mutation.mockImplementationOnce(async () => {
    stillConsenting = false;
    return { leaseUntil: 5000, serverNow: 4000 };
  });
  expect(await client.heartbeat("token", "conversation", () => stillConsenting)).toBeNull();
  expect(fake.mutation).toHaveBeenCalledTimes(2);
});
it("subscription delivers values, reports errors, and unsubscribes", () => {
  const client = createGlanceClient("https://example.convex.cloud");
  const onValue = vi.fn(); const onError = vi.fn();
  const unsubscribe = client.subscribe("token", undefined, onValue, onError);
  const notify = fake.onUpdate.mock.calls[0][0];
  const value = { me: {}, events: [], members: [], conversations: [] };
  fake.localQueryResult.mockReturnValue(value);
  notify();
  expect(onValue).toHaveBeenCalledWith(value);
  fake.localQueryResult.mockImplementation(() => { throw new Error("offline"); });
  notify();
  expect(onError).toHaveBeenCalledWith(new Error("offline"));
  unsubscribe();
  expect(fake.unsubscribe).toHaveBeenCalledOnce();
});
