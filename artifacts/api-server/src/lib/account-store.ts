import { and, eq } from "drizzle-orm";
import type { db as database } from "@workspace/db";
import {
  appUsers,
  customerProfiles,
  customerPreferences,
  userRoles,
  shoppingCarts,
  shoppingCartItems,
  savedMeals,
  customerAddresses,
} from "@workspace/db/schema";
import type {
  Account,
  AddressInput,
  Preferences,
} from "@workspace/api-zod/account";
import type { Identity } from "./auth";

export function createAccountStore(db: typeof database) {
  const lock = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
  ) => {
    await tx
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.id, userId))
      .for("update");
  };
  return {
    async identify(identity: Identity) {
      return db.transaction(async (tx) => {
        const [user] = await tx
          .insert(appUsers)
          .values({
            authProvider: "supabase",
            authSubject: identity.subject,
            email: identity.email,
          })
          .onConflictDoUpdate({
            target: [appUsers.authProvider, appUsers.authSubject],
            set: { email: identity.email, updatedAt: new Date() },
          })
          .returning();
        await tx
          .insert(customerProfiles)
          .values({ userId: user.id })
          .onConflictDoNothing();
        await tx
          .insert(customerPreferences)
          .values({ userId: user.id })
          .onConflictDoNothing();
        await tx
          .insert(shoppingCarts)
          .values({ userId: user.id })
          .onConflictDoNothing();
        await tx
          .insert(userRoles)
          .values({ userId: user.id, role: "customer" })
          .onConflictDoNothing();
        const roles = await tx
          .select()
          .from(userRoles)
          .where(eq(userRoles.userId, user.id));
        return { id: user.id, roles: roles.map((row) => row.role) };
      });
    },
    async read(userId: string): Promise<Account> {
      // A coherent snapshot even if another tab is replacing the basket.
      return db.transaction(async (tx) => {
        await lock(tx, userId);
        const [user] = await tx
          .select()
          .from(appUsers)
          .where(eq(appUsers.id, userId));
        const [profile] = await tx
          .select()
          .from(customerProfiles)
          .where(eq(customerProfiles.userId, userId));
        const [preferences] = await tx
          .select()
          .from(customerPreferences)
          .where(eq(customerPreferences.userId, userId));
        const roles = await tx
          .select()
          .from(userRoles)
          .where(eq(userRoles.userId, userId));
        const favorites = await tx
          .select()
          .from(savedMeals)
          .where(eq(savedMeals.userId, userId));
        const [cart] = await tx
          .select()
          .from(shoppingCarts)
          .where(eq(shoppingCarts.userId, userId));
        const items = await tx
          .select()
          .from(shoppingCartItems)
          .where(eq(shoppingCartItems.cartId, cart.id));
        const addresses = await tx
          .select()
          .from(customerAddresses)
          .where(eq(customerAddresses.userId, userId));
        return {
          id: user.id,
          email: user.email,
          displayName: user.displayName ?? "",
          phoneNumber: profile.phoneNumber ?? "",
          roles: roles.map((row) => row.role),
          preferences: {
            eatingStyles:
              preferences.eatingStyles as Preferences["eatingStyles"],
            goals: preferences.goals as Preferences["goals"],
            cuisines: preferences.cuisines as Preferences["cuisines"],
            strictAllergens:
              preferences.strictAllergens as Preferences["strictAllergens"],
            dislikes: preferences.dislikes,
            mealsPerWeek:
              preferences.mealsPerWeek as Preferences["mealsPerWeek"],
            preferredMealTypes:
              preferences.preferredMealTypes as Preferences["preferredMealTypes"],
          },
          favorites: favorites.map((row) => row.mealId),
          cart: Object.fromEntries(
            items.map((row) => [row.mealId, row.quantity]),
          ),
          addresses: addresses.map((row) => ({
            id: row.id,
            label: row.label,
            recipientName: row.recipientName,
            phoneNumber: row.phoneNumber ?? "",
            street1: row.street1,
            street2: row.street2 ?? "",
            city: row.city,
            region: row.region,
            postalCode: row.postalCode,
            countryCode: "US",
            deliveryInstructions: row.deliveryInstructions ?? "",
            isDefault: row.isDefault,
          })),
        };
      });
    },
    async profile(
      userId: string,
      input: { displayName: string; phoneNumber: string },
    ) {
      await db.transaction(async (tx) => {
        await lock(tx, userId);
        await tx
          .update(appUsers)
          .set({ displayName: input.displayName, updatedAt: new Date() })
          .where(eq(appUsers.id, userId));
        await tx
          .update(customerProfiles)
          .set({ phoneNumber: input.phoneNumber, updatedAt: new Date() })
          .where(eq(customerProfiles.userId, userId));
      });
    },
    async preferences(userId: string, preferences: Preferences) {
      await db.transaction(async (tx) => {
        await lock(tx, userId);
        await tx
          .update(customerPreferences)
          .set({ ...preferences, updatedAt: new Date() })
          .where(eq(customerPreferences.userId, userId));
      });
    },
    async cart(userId: string, items: { mealId: string; quantity: number }[]) {
      await db.transaction(async (tx) => {
        await lock(tx, userId);
        const [cart] = await tx
          .select()
          .from(shoppingCarts)
          .where(eq(shoppingCarts.userId, userId));
        await tx
          .delete(shoppingCartItems)
          .where(eq(shoppingCartItems.cartId, cart.id));
        if (items.length)
          await tx
            .insert(shoppingCartItems)
            .values(items.map((item) => ({ ...item, cartId: cart.id })));
        await tx
          .update(shoppingCarts)
          .set({ updatedAt: new Date() })
          .where(eq(shoppingCarts.id, cart.id));
      });
    },
    async favorite(userId: string, mealId: string, enabled: boolean) {
      if (enabled)
        await db
          .insert(savedMeals)
          .values({ userId, mealId })
          .onConflictDoNothing();
      else
        await db
          .delete(savedMeals)
          .where(
            and(eq(savedMeals.userId, userId), eq(savedMeals.mealId, mealId)),
          );
    },
    async address(userId: string, input: AddressInput, addressId?: string) {
      return db.transaction(async (tx) => {
        await lock(tx, userId);
        if (addressId) {
          const existing = await tx
            .select({ id: customerAddresses.id })
            .from(customerAddresses)
            .where(
              and(
                eq(customerAddresses.id, addressId),
                eq(customerAddresses.userId, userId),
              ),
            );
          if (!existing.length) return null;
        } else {
          const existing = await tx
            .select({ id: customerAddresses.id })
            .from(customerAddresses)
            .where(eq(customerAddresses.userId, userId));
          if (existing.length >= 20) throw new Error("ADDRESS_LIMIT");
        }
        if (input.isDefault)
          await tx
            .update(customerAddresses)
            .set({ isDefault: false })
            .where(eq(customerAddresses.userId, userId));
        const rows = addressId
          ? await tx
              .update(customerAddresses)
              .set({ ...input, verifiedAt: null, updatedAt: new Date() })
              .where(
                and(
                  eq(customerAddresses.id, addressId),
                  eq(customerAddresses.userId, userId),
                ),
              )
              .returning({ id: customerAddresses.id })
          : await tx
              .insert(customerAddresses)
              .values({ ...input, userId })
              .returning({ id: customerAddresses.id });
        return rows[0].id;
      });
    },
    async deleteAddress(userId: string, addressId: string) {
      const rows = await db
        .delete(customerAddresses)
        .where(
          and(
            eq(customerAddresses.id, addressId),
            eq(customerAddresses.userId, userId),
          ),
        )
        .returning({ id: customerAddresses.id });
      return rows.length > 0;
    },
  };
}
export type AccountStore = ReturnType<typeof createAccountStore>;
