import { z } from "zod";
export const idSchema = z.string().uuid();
export const orderStatus = z.enum([
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
]);
export const checkoutInput = z
  .object({
    addressId: idSchema,
    slotId: idSchema,
    mode: z.enum(["simulation", "stripe_test"]),
    requestKey: idSchema,
    promoCode: z.string().trim().toUpperCase().max(30).optional(),
    acknowledgedTestOnly: z.literal(true),
  })
  .strict();
export const transitionInput = z
  .object({ status: orderStatus, note: z.string().trim().min(1).max(500) })
  .strict();
export const ticketInput = z
  .object({
    subject: z.string().trim().min(3).max(160),
    category: z.enum(["general", "order", "refund", "food_safety"]),
    body: z.string().trim().min(1).max(4000),
    orderId: idSchema.optional(),
  })
  .strict();
export const messageInput = z
  .object({
    body: z.string().trim().min(1).max(4000),
    internal: z.boolean().default(false),
  })
  .strict();
export const ticketUpdateInput = z
  .object({
    status: z.enum(["open", "in_progress", "resolved"]),
    assignToMe: z.boolean().default(false),
  })
  .strict();
export const partnerInput = z
  .object({ name: z.string().trim().min(2).max(120) })
  .strict();
export const partnerReviewInput = z
  .object({
    status: z.enum(["prospective", "review", "approved", "suspended"]),
    agreementConfirmed: z.boolean(),
  })
  .strict();
export const kitchenInput = z
  .object({ partnerId: idSchema, name: z.string().trim().min(2).max(120) })
  .strict();
export const memberInput = z
  .object({ userId: idSchema, kitchenId: idSchema })
  .strict();
export const mealInput = z
  .object({
    kitchenId: idSchema,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().min(3).max(1000),
    priceCents: z.number().int().min(100).max(100000),
    stock: z.number().int().min(0).max(10000),
    ingredients: z.array(z.string().trim().min(1).max(100)).min(1).max(80),
    allergens: z
      .array(
        z.enum([
          "Milk",
          "Egg",
          "Fish",
          "Crustacean shellfish",
          "Tree nuts",
          "Peanuts",
          "Wheat",
          "Soy",
          "Sesame",
        ]),
      )
      .max(9),
    crossContactAllergens: z
      .array(
        z.enum([
          "Milk",
          "Egg",
          "Fish",
          "Crustacean shellfish",
          "Tree nuts",
          "Peanuts",
          "Wheat",
          "Soy",
          "Sesame",
        ]),
      )
      .max(9)
      .default([]),
    crossContact: z.string().trim().min(1).max(1000),
    dietaryTags: z.array(z.string().trim().min(1).max(60)).max(20),
    evidence: z.string().trim().max(2000),
  })
  .strict();
export const mealUpdateInput = mealInput.extend({
  version: z.number().int().positive(),
});
export const mealReviewInput = z
  .object({
    status: z.enum(["approved", "hidden"]),
    allergenVerified: z.boolean(),
    dietaryVerified: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();
export const zoneInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    postalCodes: z
      .array(z.string().regex(/^\d{5}$/))
      .min(1)
      .max(100),
    enabled: z.boolean(),
    testOnly: z.literal(true),
  })
  .strict();
export const slotInput = z
  .object({
    kitchenId: idSchema,
    zoneId: idSchema,
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    cutoffAt: z.string().datetime(),
    capacity: z.number().int().min(1).max(10000),
    enabled: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.cutoffAt) > Date.now() &&
      Date.parse(v.cutoffAt) < Date.parse(v.startsAt) &&
      Date.parse(v.startsAt) < Date.parse(v.endsAt),
    "Cutoff, start and end must be in future chronological order.",
  );
export const promoInput = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,30}$/),
    percent: z.number().int().min(1).max(50),
    maxUses: z.number().int().min(1).max(100000),
    expiresAt: z.string().datetime(),
    enabled: z.boolean(),
  })
  .strict()
  .refine(
    (v) => Date.parse(v.expiresAt) > Date.now(),
    "Expiry must be in the future.",
  );
export const subscriptionInput = z
  .object({
    mealCount: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    acknowledgedRecurringTestBilling: z.literal(true),
  })
  .strict();
export const subscriptionActionInput = z
  .object({ action: z.enum(["pause", "resume", "skip", "cancel"]) })
  .strict();
export type CheckoutInput = z.infer<typeof checkoutInput>;
export type MealInput = z.infer<typeof mealInput>;
export type TicketInput = z.infer<typeof ticketInput>;
export type OrderStatus = z.infer<typeof orderStatus>;
export type OrderView = {
  id: string;
  kitchenId: string;
  mode: "simulation" | "stripe_test";
  status: OrderStatus;
  paymentStatus: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  createdAt: string;
  items: {
    mealId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
  }[];
  events: { id: string; status: string; note: string; createdAt: string }[];
  slot: { startsAt: string; endsAt: string };
};
export type TicketView = {
  id: string;
  subject: string;
  category: string;
  status: string;
  orderId: string | null;
  assignedAgentId: string | null;
  createdAt: string;
  messages: {
    id: string;
    body: string;
    internal: boolean;
    authorId: string;
    createdAt: string;
  }[];
};
export type CatalogView = MealInput & {
  id: string;
  status: string;
  version: number;
  allergenVerified: boolean;
  dietaryVerified: boolean;
};
export type PortalView = {
  orders: OrderView[];
  tickets: TicketView[];
  partners: {
    id: string;
    name: string;
    status: string;
    testOnly: boolean;
    agreementConfirmed: boolean;
  }[];
  kitchens: { id: string; partnerId: string; name: string }[];
  menus: CatalogView[];
  zones: {
    id: string;
    name: string;
    postalCodes: string[];
    enabled: boolean;
    testOnly: boolean;
  }[];
  slots: {
    id: string;
    kitchenId: string;
    zoneId: string;
    startsAt: string;
    endsAt: string;
    cutoffAt: string;
    capacity: number;
    reserved: number;
    enabled: boolean;
  }[];
  promotions: {
    code: string;
    percent: number;
    maxUses: number;
    uses: number;
    expiresAt: string;
    enabled: boolean;
  }[];
  audit: { id: string; action: string; entityId: string; createdAt: string }[];
  metrics: {
    testOrders: number;
    paidTestSalesCents: number;
    refundedTestOrders: number;
    openTickets: number;
  };
};
export type SubscriptionView = {
  id: string;
  mealCount: number;
  weeklyPriceCents: number;
  status: string;
  nextBillingAt: string | null;
  skippedUntil: string | null;
};
export const slotUpdateInput = z
  .object({
    capacity: z.number().int().min(1).max(10000),
    enabled: z.boolean(),
  })
  .strict();
export const accountAdminInput = z.object({ disabled: z.boolean() }).strict();
export const roleGrantInput = z
  .object({
    role: z.enum([
      "customer",
      "restaurant_employee",
      "restaurant_manager",
      "support_agent",
      "operations_admin",
      "founder_admin",
    ]),
    enabled: z.boolean(),
  })
  .strict();
export const compensationInput = z
  .object({
    kitchenId: idSchema,
    perMealCents: z.number().int().min(0).max(100000),
    reference: z.string().trim().min(3).max(500),
  })
  .strict();
export const leadInput = z
  .object({
    kind: z.enum(["waitlist", "partner"]),
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    postalCode: z.string().regex(/^\d{5}$/),
    message: z.string().trim().max(2000).default(""),
    consent: z.literal(true),
  })
  .strict();
export const leadUpdateInput = z
  .object({ status: z.enum(["received", "review", "closed"]) })
  .strict();
const stamp = z.string().datetime();
export const orderViewSchema = z.object({
  id: idSchema,
  kitchenId: idSchema,
  mode: z.enum(["simulation", "stripe_test"]),
  status: orderStatus,
  paymentStatus: z.string(),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
  createdAt: stamp,
  items: z.array(
    z.object({
      mealId: z.string(),
      name: z.string(),
      quantity: z.number().int(),
      unitPriceCents: z.number().int(),
      foodSnapshot: z.record(z.unknown()).optional(),
    }),
  ),
  events: z.array(
    z.object({
      id: idSchema,
      status: z.string(),
      note: z.string(),
      createdAt: stamp,
    }),
  ),
  slot: z.object({ startsAt: stamp, endsAt: stamp }),
});
export const ticketViewSchema = z
  .object({
    id: idSchema,
    subject: z.string(),
    category: z.string(),
    status: z.string(),
    orderId: idSchema.nullable(),
    assignedAgentId: idSchema.nullable(),
    createdAt: stamp,
    messages: z.array(
      z.object({
        id: idSchema,
        body: z.string(),
        internal: z.boolean(),
        authorId: idSchema,
        createdAt: stamp,
      }),
    ),
  })
  .passthrough();
export const catalogViewSchema = mealInput.extend({
  id: z.string(),
  status: z.string(),
  version: z.number().int(),
  allergenVerified: z.boolean(),
  dietaryVerified: z.boolean(),
});
export const slotViewSchema = z.object({
  id: idSchema,
  kitchenId: idSchema,
  zoneId: idSchema,
  startsAt: stamp,
  endsAt: stamp,
  cutoffAt: stamp,
  capacity: z.number().int(),
  reserved: z.number().int(),
  postalCodes: z.array(z.string()),
});
export const subscriptionViewSchema = z
  .object({
    id: idSchema,
    mealCount: z.number().int(),
    weeklyPriceCents: z.number().int(),
    status: z.string(),
    nextBillingAt: stamp.nullable(),
    skippedUntil: stamp.nullable(),
  })
  .passthrough();
export const notificationViewSchema = z.object({
  id: idSchema,
  title: z.string(),
  body: z.string(),
  href: z.string(),
  readAt: stamp.nullable(),
  createdAt: stamp,
});
export const customerAdminViewSchema = z.object({
  id: idSchema,
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  disabledAt: stamp.nullable(),
  createdAt: stamp,
  roles: z.array(z.string()),
});
export const payableViewSchema = z.object({
  orderId: idSchema,
  kitchenId: idSchema,
  amountCents: z.number().int(),
  status: z.string(),
  createdAt: stamp,
});
export const leadViewSchema = z.object({
  id: idSchema,
  kind: z.string(),
  name: z.string(),
  email: z.string(),
  postalCode: z.string(),
  message: z.string(),
  consent: z.boolean(),
  status: z.string(),
  createdAt: stamp,
});
export const partnerViewSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    status: z.string(),
    testOnly: z.boolean(),
    agreementConfirmed: z.boolean(),
  })
  .passthrough();
export const kitchenViewSchema = z
  .object({ id: idSchema, partnerId: idSchema, name: z.string() })
  .passthrough();
export const portalViewSchema = z.object({
  orders: z.array(orderViewSchema),
  tickets: z.array(ticketViewSchema),
  partners: z.array(partnerViewSchema),
  kitchens: z.array(kitchenViewSchema),
  menus: z.array(catalogViewSchema),
  zones: z.array(zoneInput.extend({ id: idSchema, testOnly: z.boolean() })),
  slots: z.array(
    slotViewSchema.omit({ postalCodes: true }).extend({ enabled: z.boolean() }),
  ),
  promotions: z.array(
    promoInput.innerType().extend({ uses: z.number().int() }),
  ),
  audit: z.array(
    z.object({
      id: idSchema,
      action: z.string(),
      entityId: z.string(),
      createdAt: stamp,
    }),
  ),
  metrics: z.object({
    testOrders: z.number().int(),
    paidTestSalesCents: z.number().int(),
    refundedTestOrders: z.number().int(),
    openTickets: z.number().int(),
  }),
});
export const subscriptionBoxInput=z.object({subscriptionId:idSchema,addressId:idSchema,slotId:idSchema,items:z.array(z.object({mealId:z.string().regex(/^[a-z0-9-]+$/).max(100),quantity:z.number().int().min(1).max(20)}).strict()).min(1).max(50)}).strict().refine(v=>new Set(v.items.map(i=>i.mealId)).size===v.items.length,'Duplicate meals are not allowed.');
