import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { appUsers } from "./accounts";
const created = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const restaurantPartners = pgTable("restaurant_partners", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  status: text("status", {
    enum: ["prospective", "review", "approved", "suspended"],
  })
    .notNull()
    .default("prospective"),
  testOnly: boolean("test_only").notNull().default(false),
  agreementConfirmed: boolean("agreement_confirmed").notNull().default(false),
  createdAt: created(),
});
export const kitchens = pgTable("kitchens", {
  id: uuid("id").defaultRandom().primaryKey(),
  partnerId: uuid("partner_id")
    .notNull()
    .references(() => restaurantPartners.id),
  name: text("name").notNull(),
  createdAt: created(),
});
export const kitchenMembers = pgTable(
  "kitchen_members",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    kitchenId: uuid("kitchen_id")
      .notNull()
      .references(() => kitchens.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kitchenId] })],
);
export const catalogMeals = pgTable(
  "catalog_meals",
  {
    id: text("id").primaryKey(),
    kitchenId: uuid("kitchen_id")
      .notNull()
      .references(() => kitchens.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    priceCents: integer("price_cents").notNull(),
    stock: integer("stock").notNull().default(0),
    status: text("status", {
      enum: ["draft", "submitted", "approved", "hidden"],
    })
      .notNull()
      .default("draft"),
    ingredients: text("ingredients")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    allergens: text("allergens")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    allergenVerified: boolean("allergen_verified").notNull().default(false),
    dietaryVerified: boolean("dietary_verified").notNull().default(false),
    dietaryTags: text("dietary_tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    crossContactAllergens: text("cross_contact_allergens")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    crossContact: text("cross_contact").notNull().default("Unknown"),
    evidence: text("evidence").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: created(),
  },
  (t) => [
    index("catalog_kitchen_idx").on(t.kitchenId),
    check(
      "catalog_money_stock_check",
      sql`${t.priceCents} > 0 AND ${t.stock} >= 0`,
    ),
  ],
);
export const deliveryZones = pgTable("delivery_zones", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  postalCodes: text("postal_codes").array().notNull(),
  testOnly: boolean("test_only").notNull().default(true),
  enabled: boolean("enabled").notNull().default(false),
});
export const deliverySlots = pgTable(
  "delivery_slots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kitchenId: uuid("kitchen_id")
      .notNull()
      .references(() => kitchens.id),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => deliveryZones.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    reserved: integer("reserved").notNull().default(0),
    enabled: boolean("enabled").notNull().default(false),
  },
  (t) => [
    check(
      "slot_capacity_check",
      sql`${t.capacity} > 0 AND ${t.reserved} >= 0 AND ${t.reserved} <= ${t.capacity}`,
    ),
    check(
      "slot_time_check",
      sql`${t.cutoffAt} < ${t.startsAt} AND ${t.startsAt} < ${t.endsAt}`,
    ),
  ],
);
export const promotions = pgTable(
  "promotions",
  {
    code: text("code").primaryKey(),
    percent: integer("percent").notNull(),
    maxUses: integer("max_uses").notNull(),
    uses: integer("uses").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [
    check(
      "promotion_limits_check",
      sql`${t.percent} BETWEEN 1 AND 50 AND ${t.maxUses} > 0 AND ${t.uses} >= 0 AND ${t.uses} <= ${t.maxUses}`,
    ),
  ],
);
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    kitchenId: uuid("kitchen_id")
      .notNull()
      .references(() => kitchens.id),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => deliverySlots.id),
    mode: text("mode", { enum: ["simulation", "stripe_test"] }).notNull(),
    status: text("status", {
      enum: [
        "awaiting_payment",
        "placed",
        "confirmed",
        "preparing",
        "ready",
        "out_for_delivery",
        "delivered",
        "canceled",
        "payment_failed",
        "refunded",
      ],
    }).notNull(),
    paymentStatus: text("payment_status", {
      enum: ["not_charged", "pending", "paid", "failed", "refunded"],
    }).notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    partnerAllocationCents: integer("partner_allocation_cents")
      .notNull()
      .default(0),
    addressSnapshot: jsonb("address_snapshot").notNull(),
    requestKey: uuid("request_key").notNull(),
    requestHash: text("request_hash").notNull(),
    promoCode: text("promo_code").references(() => promotions.code),
    reservationReleased: boolean("reservation_released")
      .notNull()
      .default(false),
    stripeInvoiceId: text("stripe_invoice_id"),
    stripeSessionId: text("stripe_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("order_request_unique").on(t.userId, t.requestKey),
    uniqueIndex("order_stripe_session_unique").on(t.stripeSessionId),
    uniqueIndex("order_stripe_invoice_unique").on(t.stripeInvoiceId),
    index("order_customer_idx").on(t.userId),
    index("order_kitchen_idx").on(t.kitchenId),
    check(
      "order_amount_check",
      sql`${t.subtotalCents} >= 0 AND ${t.discountCents} >= 0 AND ${t.totalCents} = ${t.subtotalCents} - ${t.discountCents} AND ${t.totalCents} >= 0`,
    ),
  ],
);
export const orderItems = pgTable(
  "order_items",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    mealId: text("meal_id")
      .notNull()
      .references(() => catalogMeals.id),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    mealVersion: integer("meal_version").notNull(),
    foodSnapshot: jsonb("food_snapshot")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.mealId] }),
    check(
      "order_item_quantity_check",
      sql`${t.quantity} BETWEEN 1 AND 20 AND ${t.unitPriceCents} > 0`,
    ),
  ],
);
export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => appUsers.id),
    status: text("status").notNull(),
    note: text("note").notNull(),
    createdAt: created(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId)],
);
export const paymentEvents = pgTable("payment_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  createdAt: created(),
});
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    mealCount: integer("meal_count").notNull(),
    weeklyPriceCents: integer("weekly_price_cents").notNull(),
    status: text("status", {
      enum: ["checkout_pending", "active", "past_due", "paused", "canceled"],
    })
      .notNull()
      .default("checkout_pending"),
    stripeSessionId: text("stripe_session_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    nextBillingAt: timestamp("next_billing_at", { withTimezone: true }),
    skippedUntil: timestamp("skipped_until", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    check(
      "subscription_plan_check",
      sql`${t.mealCount} IN (5,10,15) AND ${t.weeklyPriceCents} > 0`,
    ),
    uniqueIndex("subscription_stripe_unique").on(t.stripeSubscriptionId),
    index("subscription_user_idx").on(t.userId),
  ],
);
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id),
    orderId: uuid("order_id").references(() => orders.id),
    subject: text("subject").notNull(),
    category: text("category", {
      enum: ["general", "order", "refund", "food_safety"],
    }).notNull(),
    status: text("status", { enum: ["open", "in_progress", "resolved"] })
      .notNull()
      .default("open"),
    assignedAgentId: uuid("assigned_agent_id").references(() => appUsers.id),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tickets_customer_idx").on(t.userId),
    index("tickets_status_idx").on(t.status),
  ],
);
export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => appUsers.id),
    body: text("body").notNull(),
    internal: boolean("internal").notNull().default(false),
    createdAt: created(),
  },
  (t) => [index("messages_ticket_idx").on(t.ticketId)],
);
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index("notifications_user_idx").on(t.userId)],
);
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").references(() => appUsers.id),
  action: text("action").notNull(),
  entityId: text("entity_id").notNull(),
  createdAt: created(),
});
export const partnerCompensation = pgTable(
  "partner_compensation",
  {
    kitchenId: uuid("kitchen_id")
      .primaryKey()
      .references(() => kitchens.id),
    perMealCents: integer("per_meal_cents").notNull(),
    reference: text("reference").notNull(),
  },
  (t) => [check("compensation_amount_check", sql`${t.perMealCents} >= 0`)],
);
export const partnerPayables = pgTable(
  "partner_payables",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => orders.id),
    kitchenId: uuid("kitchen_id")
      .notNull()
      .references(() => kitchens.id),
    amountCents: integer("amount_cents").notNull(),
    status: text("status", { enum: ["recorded", "adjusted", "settled_test"] })
      .notNull()
      .default("recorded"),
    createdAt: created(),
  },
  (t) => [check("payable_amount_check", sql`${t.amountCents} >= 0`)],
);
export const launchLeads = pgTable(
  "launch_leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind", { enum: ["waitlist", "partner"] }).notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    postalCode: text("postal_code").notNull(),
    message: text("message").notNull().default(""),
    consent: boolean("consent").notNull(),
    status: text("status", { enum: ["received", "review", "closed"] })
      .notNull()
      .default("received"),
    createdAt: created(),
  },
  (t) => [index("leads_status_idx").on(t.status)],
);

export const subscriptionBoxes = pgTable('subscription_boxes', {
 id: uuid('id').defaultRandom().primaryKey(), subscriptionId: uuid('subscription_id').notNull().references(()=>subscriptions.id),
 periodStart: timestamp('period_start',{withTimezone:true}).notNull(), periodEnd: timestamp('period_end',{withTimezone:true}).notNull(),
 addressId: uuid('address_id').notNull(), slotId: uuid('slot_id').notNull().references(()=>deliverySlots.id), items: jsonb('items').$type<{mealId:string;quantity:number}[]>().notNull(),
 status:text('status',{enum:['draft','fulfilled','needs_attention']}).notNull().default('draft'), orderId:uuid('order_id').references(()=>orders.id), note:text('note').notNull().default(''), updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('subscription_box_period_unique').on(t.subscriptionId,t.periodStart)]);
export const subscriptionInvoices=pgTable('subscription_invoices',{
 id:text('id').primaryKey(),subscriptionId:uuid('subscription_id').notNull().references(()=>subscriptions.id),amountCents:integer('amount_cents').notNull(),periodStart:timestamp('period_start',{withTimezone:true}).notNull(),periodEnd:timestamp('period_end',{withTimezone:true}).notNull(),paymentIntentId:text('payment_intent_id'),
 status:text('status',{enum:['paid','fulfilled','needs_attention']}).notNull().default('paid'),orderId:uuid('order_id').references(()=>orders.id),note:text('note').notNull().default(''),createdAt:created(),
},t=>[check('subscription_invoice_amount_check',sql`${t.amountCents} > 0 AND ${t.periodStart} < ${t.periodEnd}`)]);
