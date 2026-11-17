import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import type { Server } from "node:http";
import type { db as ProductionDb } from "@workspace/db";
import * as t from "@workspace/db/schema";
import { createApp } from "../src/app";
import { createAccountStore } from "../src/lib/account-store";
import { createOperationsStore, type Actor } from "../src/lib/operations-store";
import { AuthFailure } from "../src/lib/auth";
const pg = new PGlite(),
  db = drizzle(pg, { schema: t });
const accounts = createAccountStore(db as unknown as typeof ProductionDb),
  operations = createOperationsStore(db as unknown as typeof ProductionDb);
let server: Server,
  base: string,
  fixtures: Awaited<ReturnType<typeof operations.seedTestData>>;
const actors: Record<string, Actor> = {};
const addressIds: Record<string, string> = {};
const address = {
  label: "Home",
  recipientName: "Fixture customer",
  street1: "1 Test Street",
  city: "Queens",
  region: "NY",
  postalCode: "11101",
  countryCode: "US" as const,
  phoneNumber: "",
  street2: "",
  deliveryInstructions: "",
  isDefault: true,
};
async function call(path: string, token = "a", method = "GET", body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: r.status,
    data: r.status === 204 ? undefined : await r.json(),
  };
}
async function basket(token = "a", quantity = 2) {
  await accounts.cart(actors[token].id, [
    { mealId: "lemon-chicken-rice", quantity },
  ]);
}
function checkout(
  token = "a",
  mode: "simulation" | "stripe_test" = "simulation",
) {
  return {
    addressId: addressIds[token],
    slotId: fixtures.slotId,
    mode,
    requestKey: randomUUID(),
    acknowledgedTestOnly: true as const,
  };
}
async function signed(event: object) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_TEST_WEBHOOK_SECRET!,
  });
  const r = await fetch(base + "/api/payments/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
  return { status: r.status, data: await r.json() };
}
before(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL("../../../lib/db/migrations", import.meta.url),
    ),
  });
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL("../../../lib/db/migrations", import.meta.url),
    ),
  });
  for (const name of ["a", "b", "admin", "support", "partner-a", "partner-b"]) {
    const identity = await accounts.identify({
      subject: name,
      email: `${name}@example.test`,
    });
    const role =
      name === "admin"
        ? "founder_admin"
        : name === "support"
          ? "support_agent"
          : name.startsWith("partner")
            ? "restaurant_manager"
            : "customer";
    if (role !== "customer")
      await db.insert(t.userRoles).values({ userId: identity.id, role });
    actors[name] = {
      id: identity.id,
      roles: role === "customer" ? ["customer"] : ["customer", role],
    };
    addressIds[name] = (await accounts.address(identity.id, address))!;
  }
  fixtures = await operations.seedTestData();
  await db
    .insert(t.kitchenMembers)
    .values({ userId: actors["partner-a"].id, kitchenId: fixtures.kitchenId });
  const app = createApp({
    store: async () => accounts,
    operations: async () => operations,
    verify: async (token) => {
      const name = token === "admin-without-mfa" ? "admin" : token;
      if (!actors[name]) throw new AuthFailure(401, "Invalid fixture identity");
      return {
        subject: name,
        email: `${name}@example.test`,
        mfaVerified: token !== "admin-without-mfa",
      };
    },
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  process.env.STRIPE_TEST_SECRET_KEY = "sk_test_nomilora_fixture_not_real";
  process.env.STRIPE_TEST_WEBHOOK_SECRET = "whsec_nomilora_fixture_not_real";
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  await pg.close();
  delete process.env.STRIPE_TEST_SECRET_KEY;
  delete process.env.STRIPE_TEST_WEBHOOK_SECRET;
});
let firstOrder = "";
test("checkout stores immutable prices, reserves inventory and capacity, and replays the same request safely", async () => {
  await basket();
  const request = checkout();
  const before = (
    await db
      .select()
      .from(t.catalogMeals)
      .where(eq(t.catalogMeals.id, "lemon-chicken-rice"))
  )[0];
  const result = await call("/api/market/orders", "a", "POST", request);
  assert.equal(result.status, 200);
  firstOrder = result.data.orderId;
  assert.equal(
    (await call("/api/market/orders", "a", "POST", request)).data.orderId,
    firstOrder,
  );
  assert.equal(
    (
      await call("/api/market/orders", "a", "POST", {
        ...request,
        promoCode: "CHANGED",
      })
    ).status,
    409,
  );
  const order = (await call(`/api/market/orders/${firstOrder}`)).data;
  assert.equal(order.totalCents, before.priceCents * 2);
  assert.equal(order.items[0].unitPriceCents, before.priceCents);
  assert.equal(order.paymentStatus, "not_charged");
  assert.equal(
    (
      await db
        .select()
        .from(t.catalogMeals)
        .where(eq(t.catalogMeals.id, before.id))
    )[0].stock,
    before.stock - 2,
  );
  assert.equal(
    (
      await db
        .select()
        .from(t.deliverySlots)
        .where(eq(t.deliverySlots.id, fixtures.slotId))
    )[0].reserved,
    2,
  );
  assert.deepEqual((await accounts.read(actors.a.id)).cart, {});
  await db
    .update(t.catalogMeals)
    .set({ priceCents: before.priceCents + 100 })
    .where(eq(t.catalogMeals.id, before.id));
  assert.equal(
    (await call(`/api/market/orders/${firstOrder}`)).data.totalCents,
    before.priceCents * 2,
  );
  await db
    .update(t.catalogMeals)
    .set({ priceCents: before.priceCents })
    .where(eq(t.catalogMeals.id, before.id));
});
test("ownership and role checks prevent customer and cross-kitchen order access", async () => {
  assert.equal(
    (await call(`/api/market/orders/${firstOrder}`, "b")).status,
    404,
  );
  assert.equal(
    (await call(`/api/market/orders/${firstOrder}`, "partner-b")).status,
    404,
  );
  assert.equal(
    (await call(`/api/market/orders/${firstOrder}`, "partner-a")).status,
    200,
  );
  assert.equal(
    (
      await call(`/api/market/orders/${firstOrder}/transition`, "a", "POST", {
        status: "preparing",
        note: "attempt",
      })
    ).status,
    409,
  );
  assert.equal((await call("/api/market/portal", "a")).status, 403);
  const partner = (await call("/api/market/portal", "partner-a")).data;
  assert.equal(partner.orders.length, 1);
  assert.equal("addressSnapshot" in partner.orders[0], false);
  assert.deepEqual(partner.partners, []);
});
test("test order state machine enforces preparation and delivery roles", async () => {
  for (const status of ["confirmed", "preparing", "ready"])
    assert.equal(
      (
        await call(
          `/api/market/orders/${firstOrder}/transition`,
          "partner-a",
          "POST",
          { status, note: `test ${status}` },
        )
      ).status,
      204,
    );
  assert.equal(
    (
      await call(
        `/api/market/orders/${firstOrder}/transition`,
        "partner-a",
        "POST",
        { status: "out_for_delivery", note: "attempt" },
      )
    ).status,
    403,
  );
  for (const status of ["out_for_delivery", "delivered"])
    assert.equal(
      (
        await call(
          `/api/market/orders/${firstOrder}/transition`,
          "admin",
          "POST",
          { status, note: `simulated ${status}` },
        )
      ).status,
      204,
    );
  assert.equal(
    (
      await call(
        `/api/market/orders/${firstOrder}/transition`,
        "admin",
        "POST",
        { status: "placed", note: "rewind" },
      )
    ).status,
    409,
  );
});
test("invalid addresses, strict allergies, unavailable inventory and slot capacity roll back without reservations", async () => {
  await basket();
  const request = checkout();
  assert.equal(
    (
      await call("/api/market/orders", "a", "POST", {
        ...request,
        addressId: addressIds.b,
      })
    ).status,
    400,
  );
  const prefs = (await accounts.read(actors.a.id)).preferences;
  await accounts.preferences(actors.a.id, {
    ...prefs,
    strictAllergens: ["Peanuts"],
  });
  assert.equal(
    (await call("/api/market/orders", "a", "POST", request)).status,
    409,
  );
  await accounts.preferences(actors.a.id, prefs);
  await db
    .update(t.catalogMeals)
    .set({ stock: 1 })
    .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
  assert.equal(
    (await call("/api/market/orders", "a", "POST", request)).status,
    409,
  );
  assert.equal(
    (
      await db
        .select()
        .from(t.catalogMeals)
        .where(eq(t.catalogMeals.id, "lemon-chicken-rice"))
    )[0].stock,
    1,
  );
  await db
    .update(t.catalogMeals)
    .set({ stock: 100 })
    .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
  await db
    .update(t.deliverySlots)
    .set({ capacity: 3 })
    .where(eq(t.deliverySlots.id, fixtures.slotId));
  assert.equal(
    (await call("/api/market/orders", "a", "POST", request)).status,
    409,
  );
  await db
    .update(t.deliverySlots)
    .set({ capacity: 100 })
    .where(eq(t.deliverySlots.id, fixtures.slotId));
});
test("cancellation releases reservations exactly once and cannot refund a simulation", async () => {
  await basket("b");
  const created = await call("/api/market/orders", "b", "POST", checkout("b"));
  const id = created.data.orderId;
  const before = (
    await db
      .select()
      .from(t.catalogMeals)
      .where(eq(t.catalogMeals.id, "lemon-chicken-rice"))
  )[0].stock;
  assert.equal(
    (
      await call(`/api/market/orders/${id}/transition`, "b", "POST", {
        status: "canceled",
        note: "test cancellation",
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await call(`/api/market/orders/${id}/transition`, "b", "POST", {
        status: "canceled",
        note: "duplicate cancellation",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await db
        .select()
        .from(t.catalogMeals)
        .where(eq(t.catalogMeals.id, "lemon-chicken-rice"))
    )[0].stock,
    before + 2,
  );
  assert.equal(
    (await call(`/api/market/orders/${id}/refund`, "admin", "POST")).status,
    409,
  );
});
test("test promotions are priced on the server and enforce expiry and redemption limits", async () => {
  await operations.savePromo(actors.admin, {
    code: "TEST10",
    percent: 10,
    maxUses: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    enabled: true,
  });
  await basket();
  const first = await call("/api/market/orders", "a", "POST", {
    ...checkout(),
    promoCode: "TEST10",
  });
  assert.equal(first.status, 200);
  const record = (await call(`/api/market/orders/${first.data.orderId}`)).data;
  assert.equal(record.discountCents, Math.floor(record.subtotalCents / 10));
  await basket();
  assert.equal(
    (
      await call("/api/market/orders", "a", "POST", {
        ...checkout(),
        promoCode: "TEST10",
      })
    ).status,
    409,
  );
});
test("ticket messages stay scoped, internal notes stay private, and linked orders must belong to the requester", async () => {
  assert.equal(
    (
      await call("/api/market/tickets", "b", "POST", {
        subject: "Wrong order",
        category: "order",
        body: "attempt",
        orderId: firstOrder,
      })
    ).status,
    404,
  );
  const created = await call("/api/market/tickets", "a", "POST", {
    subject: "Test meal question",
    category: "food_safety",
    body: "Customer message",
    orderId: firstOrder,
  });
  assert.equal(created.status, 200);
  const id = created.data.id;
  assert.equal((await call(`/api/market/tickets/${id}`, "b")).status, 404);
  assert.equal(
    (
      await call(`/api/market/tickets/${id}/messages`, "a", "POST", {
        body: "hide this",
        internal: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/api/market/tickets/${id}`, "support", "PUT", {
        status: "in_progress",
        assignToMe: true,
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await call(`/api/market/tickets/${id}/messages`, "support", "POST", {
        body: "Private investigation",
        internal: true,
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await call(`/api/market/tickets/${id}/messages`, "support", "POST", {
        body: "Public reply",
        internal: false,
      })
    ).status,
    204,
  );
  const customer = (await call(`/api/market/tickets/${id}`)).data;
  assert.equal(customer.messages.length, 2);
  assert.ok(customer.messages.every((m: any) => !m.internal));
  assert.equal(
    (await call(`/api/market/tickets/${id}`, "support")).data.messages.length,
    3,
  );
  assert.equal(
    (
      await call(`/api/market/tickets/${id}`, "a", "PUT", {
        status: "resolved",
        assignToMe: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/api/market/tickets/${id}`, "support", "PUT", {
        status: "resolved",
        assignToMe: true,
      })
    ).status,
    204,
  );
  assert.equal(
    (
      await call(`/api/market/tickets/${id}/messages`, "a", "POST", {
        body: "late message",
        internal: false,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(`/api/market/tickets/${id}`, "a", "PUT", {
        status: "open",
        assignToMe: false,
      })
    ).status,
    204,
  );
});
test("notifications cannot be read or marked by a different customer", async () => {
  const notes = (await call("/api/market/notifications")).data;
  assert.ok(notes.length > 0);
  assert.equal(
    (await call(`/api/market/notifications/${notes[0].id}/read`, "b", "PUT"))
      .status,
    404,
  );
  assert.equal(
    (await call(`/api/market/notifications/${notes[0].id}/read`, "a", "PUT"))
      .status,
    204,
  );
});
test("prospective restaurants including Olia remain private without agreement and even approved real menus stay unpublished", async () => {
  const prospect = await call("/api/market/partners", "admin", "POST", {
    name: "Olia Greens — private prospect",
  });
  assert.equal(prospect.status, 200);
  assert.equal(
    (
      await call(`/api/market/partners/${prospect.data.id}`, "admin", "PUT", {
        status: "approved",
        agreementConfirmed: false,
      })
    ).status,
    409,
  );
  const k = await operations.createKitchen(
    actors.admin,
    prospect.data.id,
    "Private draft kitchen",
  );
  const menu = {
    kitchenId: k.id,
    name: "Private draft meal",
    description: "Not an agreed public offering",
    priceCents: 1500,
    stock: 5,
    ingredients: ["Illustrative ingredient"],
    allergens: [],
    crossContact: "Unknown",
    crossContactAllergens: [],
    dietaryTags: [],
    evidence: "",
  };
  const id = await operations.saveMeal(actors.admin, menu);
  await operations.submitMeal(actors.admin, id);
  await operations.reviewMeal(actors.admin, id, "approved", false, false, 2);
  assert.ok(!(await operations.catalog()).some((meal) => meal.id === id));
  assert.equal(
    (await call("/api/market/menus", "partner-b", "POST", menu)).status,
    403,
  );
});
test("menu edits invalidate approvals and require version checks and evidence for verification", async () => {
  const menu = {
    kitchenId: fixtures.kitchenId,
    name: "Partner draft soup",
    description: "A test-only soup draft",
    priceCents: 1200,
    stock: 8,
    ingredients: ["Tomato"],
    allergens: [],
    crossContact: "Unknown",
    crossContactAllergens: [],
    dietaryTags: ["vegan"],
    evidence: "",
  };
  const id = await operations.saveMeal(actors["partner-a"], menu);
  await operations.submitMeal(actors["partner-a"], id);
  assert.equal(
    (
      await call(`/api/market/menus/${id}/review`, "partner-a", "POST", {
        status: "approved",
        allergenVerified: false,
        dietaryVerified: false,
        version: 2,
      })
    ).status,
    403,
  );
  await assert.rejects(() =>
    operations.reviewMeal(actors.admin, id, "approved", true, true, 2),
  );
  await operations.reviewMeal(actors.admin, id, "approved", false, false, 2);
  assert.ok((await operations.catalog()).some((meal) => meal.id === id));
  await assert.rejects(() =>
    operations.saveMeal(actors["partner-a"], menu, id, 1),
  );
  await operations.saveMeal(actors["partner-a"], menu, id, 3);
  assert.ok(!(await operations.catalog()).some((meal) => meal.id === id));
  const [record] = await db
    .select()
    .from(t.catalogMeals)
    .where(eq(t.catalogMeals.id, id));
  assert.equal(record.status, "draft");
  assert.equal(record.allergenVerified, false);
});
test("signed Stripe test events enforce amount/session binding and deduplicate payment and refund effects", async () => {
  await basket();
  const order = await operations.checkout(
    actors.a,
    checkout("a", "stripe_test"),
  );
  await operations.setStripeSession(order.id, "cs_test_fixture");
  const payload = {
    id: "evt_nomilora_paid",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_fixture",
        object: "checkout.session",
        currency: "usd",
        amount_total: order.totalCents,
        payment_status: "paid",
        payment_intent: "pi_test_fixture",
        metadata: { nomiloraOrderId: order.id },
      },
    },
  };
  const bad = await fetch(base + "/api/payments/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": "invalid",
    },
    body: JSON.stringify(payload),
  });
  assert.equal(bad.status, 400);
  assert.equal((await signed({ ...payload, livemode: true })).status, 400);
  assert.equal(
    (
      await signed({
        ...payload,
        data: { object: { ...payload.data.object, amount_total: 1 } },
      })
    ).status,
    409,
  );
  assert.equal((await signed(payload)).status, 200);
  assert.equal((await signed(payload)).data.duplicate, true);
  assert.equal(
    (await call(`/api/market/orders/${order.id}`)).data.paymentStatus,
    "paid",
  );
  assert.equal(
    (
      await call(`/api/market/orders/${order.id}/transition`, "a", "POST", {
        status: "canceled",
        note: "paid cancel attempt",
      })
    ).status,
    409,
  );
  const refund = {
    id: "evt_nomilora_refund",
    object: "event",
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_test",
        object: "charge",
        refunded: true,
        currency: "usd",
        amount_refunded: order.totalCents,
        payment_intent: "pi_test_fixture",
      },
    },
  };
  assert.equal((await signed(refund)).status, 200);
  assert.equal((await signed(refund)).data.duplicate, true);
  assert.equal(
    (await call(`/api/market/orders/${order.id}`)).data.status,
    "refunded",
  );
});
test("expired test checkout releases capacity once and missing Stripe configuration does not reserve inventory", async () => {
  await basket();
  const order = await operations.checkout(
    actors.a,
    checkout("a", "stripe_test"),
  );
  await operations.setStripeSession(order.id, "cs_test_expired");
  const payload = {
    id: "evt_expired",
    object: "event",
    type: "checkout.session.expired",
    livemode: false,
    data: {
      object: {
        id: "cs_test_expired",
        object: "checkout.session",
        currency: "usd",
        amount_total: order.totalCents,
        payment_status: "unpaid",
        metadata: { nomiloraOrderId: order.id },
      },
    },
  };
  assert.equal((await signed(payload)).status, 200);
  assert.equal((await signed(payload)).data.duplicate, true);
  assert.equal(
    (await operations.orderView(actors.a, order.id)).status,
    "payment_failed",
  );
  delete process.env.STRIPE_TEST_SECRET_KEY;
  const before = (await db.select().from(t.orders)).length;
  assert.equal(
    (
      await call(
        "/api/market/orders",
        "a",
        "POST",
        checkout("a", "stripe_test"),
      )
    ).status,
    503,
  );
  assert.equal((await db.select().from(t.orders)).length, before);
  process.env.STRIPE_TEST_SECRET_KEY = "sk_test_nomilora_fixture_not_real";
});

test("staff MFA, founder-only role grants and disabled-account enforcement are independent of client claims", async () => {
  assert.equal(
    (await call("/api/market/portal", "admin-without-mfa")).status,
    403,
  );
  assert.equal(
    (
      await call(`/api/market/customers/${actors.b.id}/role`, "a", "PUT", {
        role: "founder_admin",
        enabled: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(`/api/market/customers/${actors.b.id}/role`, "admin", "PUT", {
        role: "support_agent",
        enabled: true,
      })
    ).status,
    204,
  );
  assert.equal((await call("/api/market/portal", "b")).status, 200);
  assert.equal(
    (
      await call(`/api/market/customers/${actors.b.id}/role`, "admin", "PUT", {
        role: "support_agent",
        enabled: false,
      })
    ).status,
    204,
  );
  assert.equal((await call("/api/market/portal", "b")).status, 403);
  assert.equal(
    (
      await call(`/api/market/customers/${actors.admin.id}`, "admin", "PUT", {
        disabled: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(`/api/market/customers/${actors.b.id}`, "admin", "PUT", {
        disabled: true,
      })
    ).status,
    204,
  );
  assert.equal((await call("/api/account", "b")).status, 403);
  assert.equal(
    (
      await call(`/api/market/customers/${actors.b.id}`, "admin", "PUT", {
        disabled: false,
      })
    ).status,
    204,
  );
  assert.equal((await call("/api/account", "b")).status, 200);
});
test("inquiry forms require consent and only administrators can read the founder queue", async () => {
  const values = {
    kind: "partner",
    name: "Prospective owner",
    email: "owner@example.test",
    postalCode: "11101",
    message: "Private partnership inquiry",
    consent: true,
  };
  assert.equal(
    (
      await call("/api/launch-inquiries", "a", "POST", {
        ...values,
        consent: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("/api/launch-inquiries", "a", "POST", values)).status,
    201,
  );
  assert.equal((await call("/api/market/leads", "support")).status, 403);
  const leads = await call("/api/market/leads", "admin");
  assert.equal(leads.status, 200);
  assert.equal(leads.data[0].status, "received");
  assert.equal(
    (
      await call(`/api/market/leads/${leads.data[0].id}`, "admin", "PUT", {
        status: "review",
      })
    ).status,
    204,
  );
});
test("test compensation is snapshotted and partner payables never initiate a transfer", async () => {
  await operations.compensation(
    actors.admin,
    fixtures.kitchenId,
    800,
    "Fictional test allocation",
  );
  await basket("b", 1);
  const order = await operations.checkout(actors.b, checkout("b"));
  await operations.compensation(
    actors.admin,
    fixtures.kitchenId,
    900,
    "Changed future test allocation",
  );
  for (const status of [
    "confirmed",
    "preparing",
    "ready",
    "out_for_delivery",
    "delivered",
  ] as const)
    await operations.transition(
      actors.admin,
      order.id,
      status,
      "Simulated test transition",
    );
  const payables = await operations.payables(actors["partner-a"]);
  const recorded = payables.find((row) => row.orderId === order.id)!;
  assert.equal(recorded.amountCents, 800);
  assert.equal((await operations.payables(actors["partner-b"])).length, 0);
  await operations.settleTestPayable(actors.admin, order.id);
  assert.equal(
    (await operations.payables(actors.admin)).find(
      (row) => row.orderId === order.id,
    )!.status,
    "settled_test",
  );
  await assert.rejects(() =>
    operations.settleTestPayable(actors.admin, order.id),
  );
});
test("configured capacity windows cannot overlap or shrink below existing reservations", async () => {
  const [slot] = await db
    .select()
    .from(t.deliverySlots)
    .where(eq(t.deliverySlots.id, fixtures.slotId));
  await assert.rejects(() =>
    operations.createSlot(actors.admin, {
      kitchenId: fixtures.kitchenId,
      zoneId: fixtures.zoneId,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      cutoffAt: slot.cutoffAt.toISOString(),
      capacity: 10,
      enabled: true,
    }),
  );
  await assert.rejects(() =>
    operations.updateSlot(actors.admin, slot.id, 1, true),
  );
  await operations.updateSlot(actors.admin, slot.id, slot.capacity, false);
  await basket();
  assert.equal(
    (await call("/api/market/orders", "a", "POST", checkout())).status,
    409,
  );
  await operations.updateSlot(actors.admin, slot.id, slot.capacity, true);
});

test("verified dietary and cross-contact declarations drive browsing, recommendations, cart validation and checkout consistently", async () => {
  const meal = {
    kitchenId: fixtures.kitchenId,
    name: "Verified test lentils",
    description: "Fictional evidence for automated testing only",
    priceCents: 1400,
    stock: 10,
    ingredients: ["Lentils"],
    allergens: [],
    crossContact: "Reviewed fictional separate test preparation",
    crossContactAllergens: [],
    dietaryTags: ["vegan"],
    evidence:
      "Automated fictional fixture evidence — not real food verification",
  };
  const id = await operations.saveMeal(actors.admin, meal);
  await operations.submitMeal(actors.admin, id);
  await operations.reviewMeal(actors.admin, id, "approved", true, true, 2);
  const response = await call(`/api/meals/${id}`);
  assert.equal(response.status, 200);
  assert.equal(response.data.allergenStatus, "verified");
  assert.equal(response.data.priceCents, 1400);
  const prefs = {
    ...(await accounts.read(actors.a.id)).preferences,
    eatingStyles: ["Vegan"] as const,
    strictAllergens: ["Peanuts"] as const,
  };
  const recs = await call("/api/recommendations", "a", "POST", prefs);
  assert.equal(recs.status, 200);
  assert.ok(recs.data.recommendations.some((item: any) => item.mealId === id));
  await accounts.preferences(actors.a.id, {
    ...prefs,
    eatingStyles: ["Vegan"],
    strictAllergens: ["Peanuts"],
  });
  assert.equal(
    (
      await call("/api/account/cart", "a", "PUT", {
        items: [{ mealId: id, quantity: 1 }],
      })
    ).status,
    204,
  );
  const order = await call("/api/market/orders", "a", "POST", checkout());
  assert.equal(order.status, 200);
  await operations.saveMeal(
    actors.admin,
    { ...meal, crossContactAllergens: ["Peanuts"] },
    id,
    3,
  );
  await operations.submitMeal(actors.admin, id);
  await operations.reviewMeal(actors.admin, id, "approved", true, true, 5);
  const recsAfter = await call("/api/recommendations", "a", "POST", prefs);
  assert.ok(
    !recsAfter.data.recommendations.some((item: any) => item.mealId === id),
  );
  await accounts.cart(actors.a.id, [{ mealId: id, quantity: 1 }]);
  assert.equal(
    (await call("/api/market/orders", "a", "POST", checkout())).status,
    409,
  );
  const old = (
    await db
      .select()
      .from(t.orderItems)
      .where(eq(t.orderItems.orderId, order.data.orderId))
  )[0];
  assert.deepEqual((old.foodSnapshot as any).crossContactAllergens, []);
  await accounts.preferences(actors.a.id, {
    ...prefs,
    eatingStyles: [],
    strictAllergens: [],
  });
});

test("Stripe SDK uses server-priced weekly test billing and enforces pause, skip, resume and cancellation", async () => {
  const { subscriptionCheckout, subscriptionAction, processWebhook } =
    await import("../src/lib/payments");
  process.env.PAYMENT_RETURN_ORIGIN = "http://localhost:5173";
  process.env.APP_ORIGINS = "http://localhost:5173";
  const calls: { path: string; method: string; body: URLSearchParams }[] = [];
  let subscriptionRecordId = "";
  let paused: any = null;
  let canceled = false;
  const periodEnd = Math.floor(Date.now() / 1000) + 7 * 86400;
  const current = () => ({
    id: "sub_test_local",
    object: "subscription",
    status: canceled ? "canceled" : "active",
    livemode: false,
    pause_collection: paused,
    metadata: { nomiloraSubscriptionId: subscriptionRecordId },
    items: { data: [{ id: "si_test_local", current_period_end: periodEnd }] },
  });
  const transport: typeof fetch = async (url, options) => {
    const path = new URL(String(url)).pathname;
    const body = new URLSearchParams(String(options?.body ?? ""));
    const method = options?.method ?? "GET";
    calls.push({ path, method, body });
    if (path === "/v1/checkout/sessions" && method === "POST") {
      assert.equal(body.get("mode"), "subscription");
      assert.equal(
        body.get("line_items[0][price_data][recurring][interval]"),
        "week",
      );
      assert.equal(body.get("line_items[0][price_data][unit_amount]"), "7500");
      subscriptionRecordId = body.get("metadata[nomiloraSubscriptionId]")!;
      return Response.json({
        id: "cs_test_sub_local",
        object: "checkout.session",
        status: "open",
        url: "https://checkout.stripe.com/c/test-fixture",
        livemode: false,
      });
    }
    if (path === "/v1/subscriptions/sub_test_local") {
      if (method === "DELETE") canceled = true;
      if (method === "POST")
        paused = body.has("pause_collection[behavior]")
          ? {
              behavior: body.get("pause_collection[behavior]"),
              ...(body.has("pause_collection[resumes_at]")
                ? {
                    resumes_at: Number(
                      body.get("pause_collection[resumes_at]"),
                    ),
                  }
                : {}),
            }
          : null;
      return Response.json(current());
    }
    throw new Error(`Unexpected test-only SDK request ${method} ${path}`);
  };
  const stripe = new Stripe("sk_test_nomilora_mock_transport", {
    httpClient: Stripe.createFetchHttpClient(transport),
    maxNetworkRetries: 0,
  });
  const started = await subscriptionCheckout(
    operations,
    actors.b,
    5,
    undefined,
    stripe,
  );
  assert.equal(started.id, subscriptionRecordId);
  const payload = JSON.stringify({
    id: "evt_test_sub_paid",
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_test_sub_local",
        object: "checkout.session",
        mode: "subscription",
        currency: "usd",
        amount_total: 7500,
        payment_status: "paid",
        subscription: "sub_test_local",
        metadata: { nomiloraSubscriptionId: started.id },
      },
    },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_TEST_WEBHOOK_SECRET!,
  });
  await processWebhook(operations, Buffer.from(payload), signature, stripe);
  assert.equal(
    (await operations.subscriptionForUser(actors.b, started.id)).status,
    "active",
  );
  await subscriptionAction(operations, actors.b, started.id, "pause", stripe);
  assert.equal(
    (await operations.subscriptionForUser(actors.b, started.id)).status,
    "paused",
  );
  assert.equal(paused.behavior, "void");
  await subscriptionAction(operations, actors.b, started.id, "resume", stripe);
  assert.equal(
    (await operations.subscriptionForUser(actors.b, started.id)).status,
    "active",
  );
  assert.equal(paused, null);
  await subscriptionAction(operations, actors.b, started.id, "skip", stripe);
  assert.equal(paused.resumes_at, periodEnd + 3600);
  assert.equal(
    (
      await operations.subscriptionForUser(actors.b, started.id)
    ).skippedUntil!.getTime(),
    (periodEnd + 3600) * 1000,
  );
  await assert.rejects(() =>
    subscriptionAction(operations, actors.a, started.id, "cancel", stripe),
  );
  await subscriptionAction(operations, actors.b, started.id, "cancel", stripe);
  assert.equal(
    (await operations.subscriptionForUser(actors.b, started.id)).status,
    "canceled",
  );
  await operations.paymentEvent({
    id: "evt_late_active",
    type: "customer.subscription.updated",
    subscriptionId: "sub_test_local",
    subscriptionStatus: "active",
  });
  assert.equal(
    (await operations.subscriptionForUser(actors.b, started.id)).status,
    "canceled",
  );
  assert.ok(calls.some((call) => call.method === "DELETE"));
  delete process.env.PAYMENT_RETURN_ORIGIN;
  delete process.env.APP_ORIGINS;
});

test("verified weekly invoices wait for a box, fulfill exactly once, and preserve the shopping basket", async () => {
  const periodStart = new Date(Math.floor(Date.now() / 1000) * 1000);
  const periodEnd = new Date(periodStart.getTime() + 7 * 86400000);
  const [plan] = await db
    .insert(t.subscriptions)
    .values({
      userId: actors.b.id,
      mealCount: 5,
      weeklyPriceCents: 7500,
      status: "active",
      stripeSubscriptionId: "sub_test_box",
      nextBillingAt: periodEnd,
    })
    .returning();
  await db
    .update(t.catalogMeals)
    .set({ stock: 50, status: "approved" })
    .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
  await db
    .update(t.deliverySlots)
    .set({ capacity: 1000, enabled: true })
    .where(eq(t.deliverySlots.id, fixtures.slotId));
  await basket("b", 2);
  const invoice = {
    id: "in_test_weekly_box",
    eventId: "evt_test_weekly_box",
    subscriptionRecordId: plan.id,
    stripeSubscriptionId: "sub_test_box",
    amountCents: 7500,
    periodStart,
    periodEnd,
    paymentIntentId: "pi_test_weekly_box",
  };
  const { processWebhook } = await import("../src/lib/payments");
  const providerInvoice = {
    id: invoice.id,
    object: "invoice",
    currency: "usd",
    status: "paid",
    livemode: false,
    amount_paid: 7500,
    parent: {
      subscription_details: {
        metadata: { nomiloraSubscriptionId: plan.id },
        subscription: "sub_test_box",
      },
    },
    lines: {
      data: [
        {
          amount: 7500,
          period: {
            start: periodStart.getTime() / 1000,
            end: periodEnd.getTime() / 1000,
          },
        },
      ],
    },
    payments: {
      data: [
        {
          status: "paid",
          payment: {
            type: "payment_intent",
            payment_intent: "pi_test_weekly_box",
          },
        },
      ],
    },
  };
  let retrieved = 0;
  const transport: typeof fetch = async (url) => {
    assert.equal(new URL(String(url)).pathname, `/v1/invoices/${invoice.id}`);
    retrieved++;
    return Response.json(providerInvoice);
  };
  const stripe = new Stripe("sk_test_nomilora_mock_invoice", {
    httpClient: Stripe.createFetchHttpClient(transport),
    maxNetworkRetries: 0,
  });
  const payload = JSON.stringify({
    id: invoice.eventId,
    object: "event",
    type: "invoice.paid",
    livemode: false,
    data: { object: providerInvoice },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_TEST_WEBHOOK_SECRET!,
  });
  assert.deepEqual(
    await processWebhook(operations, Buffer.from(payload), signature, stripe),
    { orderId: null },
  );
  assert.equal(retrieved, 1);
  await assert.rejects(() =>
    processWebhook(operations, Buffer.from(payload), "forged", stripe),
  );

  assert.equal(
    (await operations.subscriptionBoxes(actors.b)).invoices.find(
      (i) => i.id === invoice.id,
    )?.status,
    "needs_attention",
  );
  const input = {
    subscriptionId: plan.id,
    addressId: addressIds.b,
    slotId: fixtures.slotId,
    items: [{ mealId: "lemon-chicken-rice", quantity: 5 }],
  };
  await assert.rejects(() => operations.saveSubscriptionBox(actors.a, input));
  await operations.saveSubscriptionBox(actors.b, input);
  const saved = await operations.subscriptionBoxes(actors.b);
  const paid = saved.invoices.find((i) => i.id === invoice.id)!;
  assert.equal(paid.status, "fulfilled");
  assert.ok(paid.orderId);
  const [order] = await db
    .select()
    .from(t.orders)
    .where(eq(t.orders.id, paid.orderId!));
  assert.equal(order.paymentStatus, "paid");
  assert.equal(order.totalCents, 7500);
  assert.equal(order.stripeInvoiceId, invoice.id);
  const lines = await db
    .select()
    .from(t.orderItems)
    .where(eq(t.orderItems.orderId, order.id));
  assert.equal(lines[0].unitPriceCents, 1500);
  assert.equal(lines[0].quantity, 5);
  const cart = await call("/api/account", "b");
  assert.equal(cart.data.cart["lemon-chicken-rice"], 2);
  const [meal] = await db
    .select()
    .from(t.catalogMeals)
    .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
  assert.equal(meal.stock, 45);
  assert.equal(
    await operations.recordSubscriptionInvoice({
      ...invoice,
      eventId: "evt_test_weekly_duplicate",
    }),
    order.id,
  );
  const [afterMeal] = await db
    .select()
    .from(t.catalogMeals)
    .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
  assert.equal(afterMeal.stock, 45);
  await assert.rejects(() => operations.saveSubscriptionBox(actors.b, input));
  await assert.rejects(() =>
    operations.recordSubscriptionInvoice({ ...invoice, amountCents: 1 }),
  );
  assert.ok(
    !(await operations.subscriptionBoxes(actors.a)).invoices.some(
      (i) => i.id === invoice.id,
    ),
  );
});

test("paid box stock failures roll back reservations and recover without charging again", async () => {
  const periodStart = new Date(Math.floor(Date.now() / 1000) * 1000),
    periodEnd = new Date(periodStart.getTime() + 7 * 86400000);
  const [plan] = await db
    .insert(t.subscriptions)
    .values({
      userId: actors.a.id,
      mealCount: 5,
      weeklyPriceCents: 7500,
      status: "active",
      stripeSubscriptionId: "sub_test_recover",
      nextBillingAt: periodEnd,
    })
    .returning();
  const box = {
    subscriptionId: plan.id,
    addressId: addressIds.a,
    slotId: fixtures.slotId,
    items: [{ mealId: "lemon-chicken-rice", quantity: 5 }],
  };
  await operations.saveSubscriptionBox(actors.a, box);
  const [slotBefore] = await db
    .select()
    .from(t.deliverySlots)
    .where(eq(t.deliverySlots.id, fixtures.slotId));
  await db
    .update(t.catalogMeals)
    .set({ stock: 0 })
    .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
  const invoice = {
    id: "in_test_recover",
    eventId: "evt_test_recover",
    subscriptionRecordId: plan.id,
    stripeSubscriptionId: "sub_test_recover",
    amountCents: 7500,
    periodStart,
    periodEnd,
    paymentIntentId: "pi_test_recover",
  };
  assert.equal(await operations.recordSubscriptionInvoice(invoice), null);
  const [slotAfter] = await db
    .select()
    .from(t.deliverySlots)
    .where(eq(t.deliverySlots.id, fixtures.slotId));
  assert.equal(slotAfter.reserved, slotBefore.reserved);
  assert.equal(
    (await operations.subscriptionBoxes(actors.a)).invoices.find(
      (i) => i.id === invoice.id,
    )?.status,
    "needs_attention",
  );
  await db
    .update(t.catalogMeals)
    .set({ stock: 20 })
    .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
  const orderId = await operations.fulfillSubscriptionInvoice(invoice.id);
  assert.ok(orderId);
  assert.equal(
    await operations.fulfillSubscriptionInvoice(invoice.id),
    orderId,
  );
});
