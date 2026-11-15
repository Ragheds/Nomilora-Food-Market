import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { Server } from "node:http";
import * as schema from "@workspace/db/schema";
import type { db as productionDb } from "@workspace/db";
import { createAccountStore } from "../src/lib/account-store";
import { AuthFailure, verifySupabaseToken } from "../src/lib/auth";
import { createApp } from "../src/app";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const store = createAccountStore(db as unknown as typeof productionDb);
let server: Server;
let base = "";
const preferences = {
  eatingStyles: ["Vegan"],
  goals: [],
  cuisines: [],
  strictAllergens: ["Peanuts"],
  dislikes: [],
  mealsPerWeek: "One-time",
  preferredMealTypes: ["Dinner"],
};
const address = {
  label: "Home",
  recipientName: "Customer A",
  street1: "1 Test Way",
  city: "Queens",
  region: "NY",
  postalCode: "11101",
  isDefault: true,
};
async function call(
  path = "",
  token = "customer-a",
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: response.status === 204 ? undefined : await response.json(),
    headers: response.headers,
  };
}
before(async () => {
  const migrationsFolder = fileURLToPath(
    new URL("../../../lib/db/migrations", import.meta.url),
  );
  await migrate(db, { migrationsFolder });
  await migrate(db, { migrationsFolder });
  const app = createApp({
    origins: ["http://localhost:5173"],
    store: async () => store,
    verify: async (token) => {
      if (!["customer-a", "customer-b"].includes(token))
        throw new AuthFailure(401, "Invalid token.");
      return { subject: token, email: `${token}@example.test` };
    },
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const bound = server.address();
  base = `http://127.0.0.1:${typeof bound === "object" && bound ? bound.port : 0}/api/account`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await pg.close();
});

test("anonymous and forged bearer tokens cannot create accounts", async () => {
  assert.equal((await call("", "")).status, 401);
  assert.equal((await call("", "forged")).status, 401);
  assert.equal((await db.select().from(schema.appUsers)).length, 0);
});
test("verified identities get only the customer role; private responses are never cached", async () => {
  const a = await call();
  const b = await call("", "customer-b");
  assert.equal(a.status, 200);
  assert.notEqual(a.data.id, b.data.id);
  assert.deepEqual(a.data.roles, ["customer"]);
  assert.equal(a.headers.get("cache-control"), "no-store");
  for (const area of ["admin", "support", "partner"])
    assert.equal(
      (
        await call(`/access/${area}`, "customer-a", "GET", undefined, {
          "X-Role": "founder_admin",
        })
      ).status,
      403,
    );
});
test("profiles, dietary preferences, favorites and baskets persist and stay isolated", async () => {
  assert.equal(
    (
      await call("/profile", "customer-a", "PUT", {
        displayName: "A",
        phoneNumber: "5550101",
      })
    ).status,
    204,
  );
  assert.equal(
    (await call("/preferences", "customer-a", "PUT", preferences)).status,
    204,
  );
  assert.equal(
    (await call("/favorites/lemon-chicken-rice", "customer-a", "PUT")).status,
    204,
  );
  assert.equal(
    (
      await call("/cart", "customer-a", "PUT", {
        items: [{ mealId: "lemon-chicken-rice", quantity: 3 }],
      })
    ).status,
    204,
  );
  const a = (await call()).data;
  const b = (await call("", "customer-b")).data;
  assert.equal(a.displayName, "A");
  assert.deepEqual(a.preferences, preferences);
  assert.deepEqual(a.cart, { "lemon-chicken-rice": 3 });
  assert.deepEqual(a.favorites, ["lemon-chicken-rice"]);
  assert.equal(b.displayName, "");
  assert.deepEqual(b.cart, {});
  assert.deepEqual(b.favorites, []);
  assert.deepEqual(b.preferences.strictAllergens, []);
  assert.equal(
    (
      await call("/profile", "customer-a", "PUT", {
        displayName: "hijack",
        phoneNumber: "",
        userId: b.id,
        role: "founder_admin",
      })
    ).status,
    400,
  );
});
test("basket replacement validates catalog, quantities, duplicate lines and untrusted prices atomically", async () => {
  for (const items of [
    [{ mealId: "missing", quantity: 1 }],
    [{ mealId: "lemon-chicken-rice", quantity: 21 }],
    [{ mealId: "lemon-chicken-rice", quantity: 1, priceCents: 1 }],
    [
      { mealId: "lemon-chicken-rice", quantity: 1 },
      { mealId: "lemon-chicken-rice", quantity: 2 },
    ],
  ])
    assert.equal(
      (await call("/cart", "customer-a", "PUT", { items })).status,
      400,
    );
  assert.deepEqual((await call()).data.cart, { "lemon-chicken-rice": 3 });
  assert.equal(
    (await call("/cart", "customer-a", "PUT", { items: [] })).status,
    204,
  );
  assert.deepEqual((await call()).data.cart, {});
});
test("address edits and deletion enforce ownership, validation and one default per account", async () => {
  const first = await call("/addresses", "customer-a", "POST", address);
  assert.equal(first.status, 201);
  assert.equal(
    (await call(`/addresses/${first.data.id}`, "customer-b", "PUT", address))
      .status,
    404,
  );
  assert.equal(
    (await call(`/addresses/${first.data.id}`, "customer-b", "DELETE")).status,
    404,
  );
  assert.equal(
    (await call("/addresses/not-a-uuid", "customer-a", "PUT", address)).status,
    400,
  );
  assert.equal(
    (
      await call("/addresses", "customer-a", "POST", {
        ...address,
        verifiedAt: "now",
      })
    ).status,
    400,
  );
  const second = await call("/addresses", "customer-a", "POST", {
    ...address,
    label: "Office",
  });
  assert.equal(second.status, 201);
  const addresses = (await call()).data.addresses;
  assert.equal(addresses.length, 2);
  assert.equal(addresses.filter((item: any) => item.isDefault).length, 1);
  assert.equal((await call("", "customer-b")).data.addresses.length, 0);
  assert.equal(
    (await call(`/addresses/${second.data.id}`, "customer-a", "DELETE")).status,
    204,
  );
});
test("roles come from PostgreSQL on every request; support has no admin or partner access", async () => {
  const user = (await call("", "customer-b")).data;
  await db
    .insert(schema.userRoles)
    .values({ userId: user.id, role: "support_agent" });
  assert.equal((await call("/access/support", "customer-b")).status, 200);
  assert.equal((await call("/access/admin", "customer-b")).status, 403);
  assert.equal((await call("/access/partner", "customer-b")).status, 403);
  await db
    .delete(schema.userRoles)
    .where(eq(schema.userRoles.role, "support_agent"));
  assert.equal((await call("/access/support", "customer-b")).status, 403);
});
test("foreign origins, oversized JSON and malformed input fail safely", async () => {
  assert.equal(
    (
      await call("", "customer-a", "GET", undefined, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("", "customer-a", "GET", undefined, {
        Origin: "http://localhost:5173",
      })
    ).headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  assert.equal(
    (
      await call("/profile", "customer-a", "PUT", {
        displayName: "x".repeat(40000),
        phoneNumber: "",
      })
    ).status,
    413,
  );
  const malformed = await fetch(base + "/profile", {
    method: "PUT",
    headers: {
      Authorization: "Bearer customer-a",
      "Content-Type": "application/json",
    },
    body: "{",
  });
  assert.equal(malformed.status, 400);
});
test("Supabase verification rejects unconfirmed users, invalid tokens, and unavailable Auth", async () => {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "public-test-key";
  try {
    globalThis.fetch = async () =>
      Response.json({
        id: "11111111-1111-4111-8111-111111111111",
        email: "a@example.test",
        email_confirmed_at: null,
      });
    await assert.rejects(
      () => verifySupabaseToken("invalid"),
      (error: any) => error.status === 403,
    );
    globalThis.fetch = async () => new Response("", { status: 401 });
    await assert.rejects(
      () => verifySupabaseToken("invalid"),
      (error: any) => error.status === 401,
    );
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    await assert.rejects(
      () => verifySupabaseToken("invalid"),
      (error: any) => error.status === 503,
    );
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://project.supabase.co/auth/v1/user");
      assert.equal(
        new Headers(options?.headers).get("authorization"),
        "Bearer valid",
      );
      return Response.json({
        id: "11111111-1111-4111-8111-111111111111",
        email: "a@example.test",
        email_confirmed_at: "2026-11-15",
        user_metadata: { role: "founder_admin" },
      });
    };
    assert.deepEqual(await verifySupabaseToken("valid"), {
      subject: "11111111-1111-4111-8111-111111111111",
      email: "a@example.test",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});

test("rate limits cannot be bypassed with an untrusted forwarded IP header", async () => {
  let status = 0;
  for (let i = 0; i < 130; i++) {
    status = (
      await call("", "invalid", "GET", undefined, {
        "X-Forwarded-For": `192.0.2.${i}`,
      })
    ).status;
    if (status === 429) break;
  }
  assert.equal(status, 429);
});
