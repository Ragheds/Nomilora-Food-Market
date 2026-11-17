import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as t from "@workspace/db/schema";
import { createAccountStore } from "../src/lib/account-store";
import { createOperationsStore } from "../src/lib/operations-store";

// Opt-in only: refuses hosted databases and existing application schemas.
test(
  "PostgreSQL driver serializes competing checkouts without overselling",
  { skip: !process.env.TEST_DATABASE_URL, timeout: 30000 },
  async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      "Tests require a loopback PostgreSQL service",
    );
    assert.equal(url.pathname, "/nomilora_test");
    process.env.DATABASE_URL = url.toString();
    const { db, pool } = await import("@workspace/db");
    try {
      const existing = await db.execute(
        sql`select tablename from pg_tables where schemaname='public'`,
      );
      assert.equal(
        existing.rows.length,
        0,
        "Refusing to mutate a nonempty test database",
      );
      const migrationsFolder = fileURLToPath(
        new URL("../../../lib/db/migrations", import.meta.url),
      );
      await migrate(db, { migrationsFolder });
      await migrate(db, { migrationsFolder });
      const accounts = createAccountStore(db),
        operations = createOperationsStore(db);
      const fixture = await operations.seedTestData();
      const customers = await Promise.all(
        ["race-one", "race-two"].map(async (subject) => {
          const identity = await accounts.identify({
            subject,
            email: `${subject}@example.test`,
          });
          const addressId = await accounts.address(identity.id, {
            label: "Test",
            recipientName: "Fixture",
            street1: "1 Test Street",
            street2: "",
            city: "Queens",
            region: "NY",
            postalCode: "11101",
            countryCode: "US",
            phoneNumber: "",
            deliveryInstructions: "",
            isDefault: true,
          });
          await accounts.cart(identity.id, [
            { mealId: "lemon-chicken-rice", quantity: 1 },
          ]);
          return {
            actor: { id: identity.id, roles: ["customer"] as ["customer"] },
            input: {
              addressId: addressId!,
              slotId: fixture.slotId,
              mode: "simulation" as const,
              requestKey: randomUUID(),
              acknowledgedTestOnly: true as const,
            },
          };
        }),
      );
      await db
        .update(t.catalogMeals)
        .set({ stock: 1 })
        .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
      await db
        .update(t.deliverySlots)
        .set({ capacity: 1 })
        .where(eq(t.deliverySlots.id, fixture.slotId));
      const results = await Promise.allSettled(
        customers.map((c) => operations.checkout(c.actor, c.input)),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const winner = results.findIndex((r) => r.status === "fulfilled");
      const first = results[winner];
      assert.equal(first.status, "fulfilled");
      if (first.status === "fulfilled")
        assert.equal(
          (
            await operations.checkout(
              customers[winner].actor,
              customers[winner].input,
            )
          ).id,
          first.value.id,
        );
      const [meal] = await db
        .select()
        .from(t.catalogMeals)
        .where(eq(t.catalogMeals.id, "lemon-chicken-rice"));
      const [slot] = await db
        .select()
        .from(t.deliverySlots)
        .where(eq(t.deliverySlots.id, fixture.slotId));
      assert.equal(meal.stock, 0);
      assert.equal(slot.reserved, 1);
      assert.equal((await db.select().from(t.orders)).length, 1);
    } finally {
      await pool.end();
    }
  },
);
