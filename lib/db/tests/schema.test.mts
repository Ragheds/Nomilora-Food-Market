import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, after } from "node:test";
import { eq } from "drizzle-orm";
import {
  appUsers,
  customerAddresses,
  customerPreferences,
  customerProfiles,
  db,
  pool,
  savedMeals,
  shoppingCartItems,
  shoppingCarts,
  userRoles,
} from "../src/index.ts";

after(async () => {
  await pool.end();
});

test("PostgreSQL account data stays scoped to its owning user", async () => {
  const rollback = new Error("rollback test transaction");
  await assert.rejects(
    db.transaction(async (tx) => {
      const testKey = randomUUID();
      const [firstUser, secondUser] = await tx
        .insert(appUsers)
        .values([
          { authProvider: "schema-test", authSubject: `${testKey}:one` },
          { authProvider: "schema-test", authSubject: `${testKey}:two` },
        ])
        .returning();

      await tx.insert(customerProfiles).values([
        { userId: firstUser.id, phoneNumber: "5550101" },
        { userId: secondUser.id, phoneNumber: "5550102" },
      ]);
      await tx.insert(customerPreferences).values([
        {
          userId: firstUser.id,
          eatingStyles: ["Vegan"],
          strictAllergens: ["Peanuts"],
        },
        { userId: secondUser.id, eatingStyles: ["Vegetarian"] },
      ]);
      const [firstCart] = await tx
        .insert(shoppingCarts)
        .values({ userId: firstUser.id })
        .returning();
      await tx.insert(shoppingCartItems).values({
        cartId: firstCart.id,
        mealId: "demo-meal",
        quantity: 2,
      });
      await tx.insert(savedMeals).values({
        userId: firstUser.id,
        mealId: "demo-meal",
      });
      await tx.insert(customerAddresses).values({
        userId: firstUser.id,
        label: "Test address",
        recipientName: "Test user",
        street1: "1 Test Way",
        city: "Queens",
        region: "NY",
        postalCode: "11101",
        isDefault: true,
      });
      await tx.insert(userRoles).values({
        userId: firstUser.id,
        role: "customer",
      });

      const firstPreferences = await tx
        .select()
        .from(customerPreferences)
        .where(eq(customerPreferences.userId, firstUser.id));
      const secondPreferences = await tx
        .select()
        .from(customerPreferences)
        .where(eq(customerPreferences.userId, secondUser.id));
      const secondCarts = await tx
        .select()
        .from(shoppingCarts)
        .where(eq(shoppingCarts.userId, secondUser.id));
      const secondFavorites = await tx
        .select()
        .from(savedMeals)
        .where(eq(savedMeals.userId, secondUser.id));
      const secondAddresses = await tx
        .select()
        .from(customerAddresses)
        .where(eq(customerAddresses.userId, secondUser.id));
      const firstRoles = await tx
        .select()
        .from(userRoles)
        .where(eq(userRoles.userId, firstUser.id));

      assert.deepEqual(firstPreferences[0].eatingStyles, ["Vegan"]);
      assert.deepEqual(firstPreferences[0].strictAllergens, ["Peanuts"]);
      assert.deepEqual(secondPreferences[0].eatingStyles, ["Vegetarian"]);
      assert.equal(secondCarts.length, 0);
      assert.equal(secondFavorites.length, 0);
      assert.equal(secondAddresses.length, 0);
      assert.deepEqual(firstRoles.map(({ role }) => role), ["customer"]);
      assert.equal(
        (
          await tx
            .select()
            .from(shoppingCartItems)
            .where(eq(shoppingCartItems.cartId, firstCart.id))
        )[0].quantity,
        2,
      );
      throw rollback;
    }),
    (error) => error === rollback,
  );
});
