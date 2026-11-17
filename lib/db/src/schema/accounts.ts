import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const applicationRole = pgEnum("application_role", [
  "customer",
  "restaurant_employee",
  "restaurant_manager",
  "support_agent",
  "operations_admin",
  "founder_admin",
]);

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authProvider: text("auth_provider").notNull(),
    authSubject: text("auth_subject").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("app_users_auth_identity_unique").on(
      table.authProvider,
      table.authSubject,
    ),
    uniqueIndex("app_users_email_unique").on(table.email),
  ],
);

export const customerProfiles = pgTable("customer_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customerPreferences = pgTable("customer_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => appUsers.id, { onDelete: "cascade" }),
  eatingStyles: text("eating_styles")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  goals: text("goals")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  cuisines: text("cuisines")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  preferredMealTypes: text("preferred_meal_types")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  strictAllergens: text("strict_allergens")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  dislikes: text("dislikes")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  mealsPerWeek: text("meals_per_week").notNull().default("One-time"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    recipientName: text("recipient_name").notNull(),
    phoneNumber: text("phone_number"),
    street1: text("street_1").notNull(),
    street2: text("street_2"),
    city: text("city").notNull(),
    region: text("region").notNull(),
    postalCode: text("postal_code").notNull(),
    countryCode: text("country_code").notNull().default("US"),
    deliveryInstructions: text("delivery_instructions"),
    isDefault: boolean("is_default").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("customer_addresses_user_idx").on(table.userId),
    uniqueIndex("customer_addresses_one_default_per_user_unique")
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
  ],
);

export const shoppingCarts = pgTable(
  "shopping_carts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("shopping_carts_user_unique").on(table.userId)],
);

export const shoppingCartItems = pgTable(
  "shopping_cart_items",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => shoppingCarts.id, { onDelete: "cascade" }),
    mealId: text("meal_id").notNull(),
    quantity: smallint("quantity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.cartId, table.mealId] }),
    check(
      "shopping_cart_items_quantity_check",
      sql`${table.quantity} between 1 and 20`,
    ),
  ],
);

export const savedMeals = pgTable(
  "saved_meals",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    mealId: text("meal_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.mealId] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    role: applicationRole("role").notNull(),
    grantedByUserId: uuid("granted_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role] }),
    index("user_roles_role_idx").on(table.role),
  ],
);

export type AppUser = typeof appUsers.$inferSelect;
export type CustomerProfile = typeof customerProfiles.$inferSelect;
export type CustomerPreference = typeof customerPreferences.$inferSelect;
export type CustomerAddress = typeof customerAddresses.$inferSelect;
export type ShoppingCart = typeof shoppingCarts.$inferSelect;
export type ShoppingCartItem = typeof shoppingCartItems.$inferSelect;
export type SavedMeal = typeof savedMeals.$inferSelect;
export type UserRole = typeof userRoles.$inferSelect;
