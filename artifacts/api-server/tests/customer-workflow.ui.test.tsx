import React from "react";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as tables from "@workspace/db/schema";
import type { db as ProductionDb } from "@workspace/db";
import { createAccountStore } from "../src/lib/account-store";
import { createOperationsStore } from "../src/lib/operations-store";
import { createApp } from "../src/app";
import App from "../../nomilora/src/App";
const state = vi.hoisted(() => ({ subject: "ui-customer" }));
vi.mock("../../nomilora/src/lib/auth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    ready: true,
    recovery: false,
    error: "",
    session: {
      user: { id: state.subject, email: `${state.subject}@example.test` },
      access_token: state.subject,
    },
  }),
  supabase: null,
  accountRequest: (
    subject: string,
    path = "",
    method = "GET",
    body?: unknown,
  ) => request(subject, `/api/account${path}`, method, body),
  marketRequest: (subject: string, path = "", method = "GET", body?: unknown) =>
    request(subject, `/api/market${path}`, method, body),
}));
const nativeFetch = globalThis.fetch;
let base = "";
let server: Server;
const pg = new PGlite(),
  db = drizzle(pg, { schema: tables });
const accounts = createAccountStore(db as unknown as typeof ProductionDb),
  operations = createOperationsStore(db as unknown as typeof ProductionDb);
async function request(
  subject: string,
  path: string,
  method: string,
  body?: unknown,
) {
  const r = await nativeFetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${subject}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const result = await r.json();
    throw new Error(result.error);
  }
  return r.status === 204 ? undefined : r.json();
}
beforeAll(async () => {
  window.scrollTo = vi.fn();
  window.matchMedia = vi
    .fn()
    .mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  await migrate(db, {
    migrationsFolder: resolve(process.cwd(), "../../lib/db/migrations"),
  });
  const customer = await accounts.identify({
    subject: "ui-customer",
    email: "ui-customer@example.test",
  });
  const agent = await accounts.identify({
    subject: "ui-agent",
    email: "ui-agent@example.test",
  });
  await db
    .insert(tables.userRoles)
    .values({ userId: agent.id, role: "support_agent" });
  await accounts.address(customer.id, {
    label: "Test home",
    recipientName: "Fixture User",
    street1: "1 Fixture Way",
    street2: "",
    city: "Queens",
    region: "NY",
    postalCode: "11101",
    countryCode: "US",
    deliveryInstructions: "",
    phoneNumber: "",
    isDefault: true,
  });
  await operations.seedTestData();
  const app = createApp({
    origins: ["http://localhost:5173"],
    store: async () => accounts,
    operations: async () => operations,
    verify: async (token) => ({
      subject: token,
      email: `${token}@example.test`,
      mfaVerified: true,
    }),
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) =>
    nativeFetch(
      typeof url === "string" && url.startsWith("/") ? base + url : url,
      init,
    )) as typeof fetch;
});
afterAll(async () => {
  cleanup();
  globalThis.fetch = nativeFetch;
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await pg.close();
});

test("customer creates a persistent test order, gets a support reply, and never sees internal staff notes", async () => {
  window.history.replaceState(null, "", "/market");
  render(<App />);
  await screen.findByRole("heading", { name: "Illustrative test meals" });
  fireEvent.click(screen.getAllByRole("button", { name: /^Add/ })[0]);
  await waitFor(() =>
    expect(screen.getByText("Account changes saved.")).toBeTruthy(),
  );
  const selectAddress = screen.getByLabelText(
    "Saved address",
  ) as HTMLSelectElement;
  fireEvent.change(selectAddress, {
    target: { value: selectAddress.options[1].value },
  });
  const selectSlot = screen.getByLabelText(
    "Test preparation window",
  ) as HTMLSelectElement;
  await waitFor(() => expect(selectSlot.options.length).toBeGreaterThan(1));
  fireEvent.change(selectSlot, {
    target: { value: selectSlot.options[1].value },
  });
  fireEvent.click(
    screen.getByLabelText(/I understand this creates a test record only/),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Record no-charge test order" }),
  );
  await screen.findByRole("heading", { name: "Saved test orders" });
  await screen.findByText(/Payment: not charged/);
  expect((await db.select().from(tables.orders)).length).toBe(1);
  fireEvent.click(screen.getByRole("link", { name: "Get help" }));
  await screen.findByRole("heading", { name: "Open a support ticket" });
  fireEvent.change(screen.getByLabelText("Subject"), {
    target: { value: "Question about my test order" },
  });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Please check this test order." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));
  await screen.findByRole("heading", { name: "Question about my test order" });
  const [ticket] = await db.select().from(tables.supportTickets);
  const agent = await accounts.identify({
    subject: "ui-agent",
    email: "ui-agent@example.test",
  });
  await operations.message(
    { id: agent.id, roles: ["support_agent"] },
    ticket.id,
    "This internal investigation is private.",
    true,
  );
  cleanup();
  state.subject = "ui-agent";
  window.history.replaceState(null, "", "/workspace");
  render(<App />);
  await screen.findByRole("button", { name: "support" });
  fireEvent.click(screen.getByRole("button", { name: "support" }));
  await screen.findByText("This internal investigation is private.");
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Your test order has been checked." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Your test order has been checked.");
  cleanup();
  state.subject = "ui-customer";
  window.history.replaceState(null, "", "/help");
  render(<App />);
  await screen.findByText("Your test order has been checked.");
  expect(
    screen.queryByText("This internal investigation is private."),
  ).toBeNull();
  expect(screen.getByText("Please check this test order.")).toBeTruthy();
});
