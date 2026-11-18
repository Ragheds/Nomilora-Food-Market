import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  lt,
  gt,
  sql,
} from "drizzle-orm";
import type { db as Database } from "@workspace/db";
import * as t from "@workspace/db/schema";
import type { Role } from "@workspace/api-zod/account";
import type {
  CheckoutInput,
  MealInput,
  OrderStatus,
  TicketInput,
} from "@workspace/api-zod/operations";
import { nomiloraMeals } from "./nomilora-catalog";
export type Actor = { id: string; roles: Role[] };
export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const isAdmin = (a: Actor) =>
  a.roles.some((role) => ["founder_admin", "operations_admin"].includes(role));
export const isSupport = (a: Actor) =>
  isAdmin(a) || a.roles.includes("support_agent");
export const isPartner = (a: Actor) =>
  a.roles.some((role) =>
    ["restaurant_employee", "restaurant_manager"].includes(role),
  );
function demand(ok: unknown, status: number, message: string): asserts ok {
  if (!ok) throw new DomainError(status, message);
}
type Tx = Parameters<Parameters<typeof Database.transaction>[0]>[0];
const audit = async (
  tx: Tx,
  actorId: string | null,
  action: string,
  entityId: string,
) => {
  await tx.insert(t.auditEvents).values({ actorId, action, entityId });
};
const notify = async (
  tx: Tx,
  userId: string,
  title: string,
  body: string,
  href: string,
) => {
  await tx.insert(t.notifications).values({ userId, title, body, href });
};
const userLock = async (tx: Tx, id: string) => {
  await tx
    .select({ id: t.appUsers.id })
    .from(t.appUsers)
    .where(eq(t.appUsers.id, id))
    .for("update");
};
const transitions: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ["canceled", "payment_failed"],
  placed: ["confirmed", "canceled"],
  confirmed: ["preparing", "canceled"],
  preparing: ["ready"],
  ready: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: [],
  canceled: [],
  payment_failed: [],
  refunded: [],
};
const strictStyles: Record<string, string[]> = {
  Vegan: ["vegan"],
  Vegetarian: ["vegan", "vegetarian"],
  Pescatarian: ["vegan", "vegetarian", "pescatarian"],
  "Halal preference": ["halal"],
  "Kosher preference": ["kosher"],
  "Low Carb": ["low carb"],
  Keto: ["keto"],
  "Dairy avoidance": ["dairy free"],
  "Gluten avoidance": ["gluten free"],
};
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function createOperationsStore(db: typeof Database) {
  async function kitchenIds(actor: Actor) {
    if (isAdmin(actor))
      return (await db.select({ id: t.kitchens.id }).from(t.kitchens)).map(
        (row) => row.id,
      );
    if (!isPartner(actor)) return [];
    return (
      await db
        .select()
        .from(t.kitchenMembers)
        .where(eq(t.kitchenMembers.userId, actor.id))
    ).map((row) => row.kitchenId);
  }
  async function canKitchen(actor: Actor, id: string) {
    return isAdmin(actor) || (await kitchenIds(actor)).includes(id);
  }
  async function scopedOrder(
    actor: Actor,
    id: string,
    tx: typeof db | Tx = db,
  ) {
    const [order] = await tx.select().from(t.orders).where(eq(t.orders.id, id));
    demand(order, 404, "Order not found.");
    demand(
      order.userId === actor.id ||
        isSupport(actor) ||
        (isPartner(actor) &&
          (await kitchenIds(actor)).includes(order.kitchenId)),
      404,
      "Order not found.",
    );
    return order;
  }
  async function release(tx: Tx, order: typeof t.orders.$inferSelect) {
    if (order.reservationReleased) return;
    await tx
      .select({ id: t.deliverySlots.id })
      .from(t.deliverySlots)
      .where(eq(t.deliverySlots.id, order.slotId))
      .for("update");
    const lines = await tx
      .select()
      .from(t.orderItems)
      .where(eq(t.orderItems.orderId, order.id));
    for (const line of lines.sort((a, b) => a.mealId.localeCompare(b.mealId)))
      await tx
        .update(t.catalogMeals)
        .set({ stock: sql`${t.catalogMeals.stock} + ${line.quantity}` })
        .where(eq(t.catalogMeals.id, line.mealId));
    const count = lines.reduce((n, line) => n + line.quantity, 0);
    await tx
      .update(t.deliverySlots)
      .set({ reserved: sql`${t.deliverySlots.reserved} - ${count}` })
      .where(eq(t.deliverySlots.id, order.slotId));
    await tx
      .update(t.orders)
      .set({ reservationReleased: true })
      .where(eq(t.orders.id, order.id));
  }
  async function orderView(actor: Actor, id: string) {
    const order = await scopedOrder(actor, id);
    const [slot] = await db
      .select()
      .from(t.deliverySlots)
      .where(eq(t.deliverySlots.id, order.slotId));
    const [items, events] = await Promise.all([
      db
        .select({
          mealId: t.orderItems.mealId,
          name: t.orderItems.name,
          quantity: t.orderItems.quantity,
          unitPriceCents: t.orderItems.unitPriceCents,
          foodSnapshot: t.orderItems.foodSnapshot,
        })
        .from(t.orderItems)
        .where(eq(t.orderItems.orderId, id)),
      db
        .select({
          id: t.orderEvents.id,
          status: t.orderEvents.status,
          note: t.orderEvents.note,
          createdAt: t.orderEvents.createdAt,
        })
        .from(t.orderEvents)
        .where(eq(t.orderEvents.orderId, id))
        .orderBy(asc(t.orderEvents.createdAt)),
    ]);
    // Portals receive no customer's saved address, email, phone or full profile.
    return {
      id: order.id,
      kitchenId: order.kitchenId,
      mode: order.mode,
      status: order.status,
      paymentStatus: order.paymentStatus,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      totalCents: order.totalCents,
      createdAt: order.createdAt,
      items,
      events,
      slot: { startsAt: slot.startsAt, endsAt: slot.endsAt },
    };
  }
  async function ticketView(actor: Actor, id: string) {
    const [ticket] = await db
      .select()
      .from(t.supportTickets)
      .where(eq(t.supportTickets.id, id));
    demand(
      ticket && (ticket.userId === actor.id || isSupport(actor)),
      404,
      "Ticket not found.",
    );
    const messages = await db
      .select({
        id: t.supportMessages.id,
        body: t.supportMessages.body,
        internal: t.supportMessages.internal,
        authorId: t.supportMessages.authorId,
        createdAt: t.supportMessages.createdAt,
      })
      .from(t.supportMessages)
      .where(
        and(
          eq(t.supportMessages.ticketId, id),
          ...(isSupport(actor) ? [] : [eq(t.supportMessages.internal, false)]),
        ),
      )
      .orderBy(desc(t.supportMessages.createdAt))
      .limit(500);
    messages.reverse();
    return { ...ticket, messages };
  }
  type SubscriptionSource = {
    items: { mealId: string; quantity: number }[];
    unitPriceCents: number;
    invoiceId: string;
    paymentIntentId: string | null;
  };
  async function placeOrder(
    tx: Tx,
    actor: Actor,
    input: CheckoutInput,
    source?: SubscriptionSource,
  ) {
    const hash = createHash("sha256")
      .update(JSON.stringify({ input, source: source ?? null }))
      .digest("hex");

    await userLock(tx, actor.id);
    const [owner] = await tx
      .select()
      .from(t.appUsers)
      .where(eq(t.appUsers.id, actor.id));
    demand(
      owner && !owner.disabledAt,
      403,
      "The account is not available for order placement.",
    );
    const [existing] = await tx
      .select()
      .from(t.orders)
      .where(
        and(
          eq(t.orders.userId, actor.id),
          eq(t.orders.requestKey, input.requestKey),
        ),
      );
    if (existing) {
      demand(
        existing.requestHash === hash,
        409,
        "This request key was already used for a different checkout.",
      );
      return existing;
    }
    const [address] = await tx
      .select()
      .from(t.customerAddresses)
      .where(
        and(
          eq(t.customerAddresses.id, input.addressId),
          eq(t.customerAddresses.userId, actor.id),
        ),
      );
    demand(address, 400, "Select one of your saved addresses.");
    const [cart] = await tx
      .select()
      .from(t.shoppingCarts)
      .where(eq(t.shoppingCarts.userId, actor.id));
    const items = source
      ? source.items.slice().sort((a, b) => a.mealId.localeCompare(b.mealId))
      : cart
        ? await tx
            .select()
            .from(t.shoppingCartItems)
            .where(eq(t.shoppingCartItems.cartId, cart.id))
            .orderBy(asc(t.shoppingCartItems.mealId))
        : [];
    demand(items.length, 400, "Your saved basket is empty.");
    const [slot] = await tx
      .select()
      .from(t.deliverySlots)
      .where(eq(t.deliverySlots.id, input.slotId))
      .for("update");
    demand(
      slot &&
        slot.enabled &&
        slot.cutoffAt > new Date() &&
        slot.startsAt > new Date(),
      409,
      "This test window is unavailable or its cutoff has passed.",
    );
    const [zone] = await tx
      .select()
      .from(t.deliveryZones)
      .where(eq(t.deliveryZones.id, slot.zoneId))
      .for("share");
    demand(
      zone?.testOnly &&
        zone.enabled &&
        zone.postalCodes.includes(address.postalCode.slice(0, 5)),
      409,
      "This address is outside the configured test zone. No real delivery is available.",
    );
    const [kitchen] = await tx
      .select()
      .from(t.kitchens)
      .where(eq(t.kitchens.id, slot.kitchenId));
    const [partner] = await tx
      .select()
      .from(t.restaurantPartners)
      .where(eq(t.restaurantPartners.id, kitchen.partnerId))
      .for("share");
    demand(
      partner.testOnly &&
        partner.status === "approved" &&
        partner.agreementConfirmed,
      409,
      "Only the fictional test kitchen can accept test orders.",
    );
    const meals = await tx
      .select()
      .from(t.catalogMeals)
      .where(
        inArray(
          t.catalogMeals.id,
          items.map((item) => item.mealId),
        ),
      )
      .orderBy(asc(t.catalogMeals.id))
      .for("update");
    const [preferences] = await tx
      .select()
      .from(t.customerPreferences)
      .where(eq(t.customerPreferences.userId, actor.id));
    const lines = items.map((item) => {
      const meal = meals.find((meal) => meal.id === item.mealId);
      demand(
        meal && meal.status === "approved" && meal.kitchenId === slot.kitchenId,
        409,
        "All meals must belong to the selected approved test kitchen.",
      );
      demand(
        meal.stock >= item.quantity,
        409,
        `${meal.name} does not have enough test inventory.`,
      );
      if (preferences?.strictAllergens.length)
        demand(
          meal.allergenVerified &&
            !/unknown/i.test(meal.crossContact) &&
            !preferences.strictAllergens.some(
              (allergen) =>
                meal.allergens.includes(allergen) ||
                meal.crossContactAllergens.includes(allergen),
            ),
          409,
          "Verified allergy information is unavailable or conflicts with your saved preferences.",
        );
      for (const style of preferences?.eatingStyles ?? []) {
        const tags = strictStyles[style];
        if (tags)
          demand(
            meal.dietaryVerified &&
              tags.some((tag) => meal.dietaryTags.map(normalize).includes(tag)),
            409,
            "A meal does not meet your verified dietary preferences.",
          );
      }
      return {
        mealId: meal.id,
        name: meal.name,
        quantity: item.quantity,
        unitPriceCents: source?.unitPriceCents ?? meal.priceCents,
        mealVersion: meal.version,
        foodSnapshot: {
          ingredients: meal.ingredients,
          allergens: meal.allergens,
          crossContactAllergens: meal.crossContactAllergens,
          crossContact: meal.crossContact,
          allergenVerified: meal.allergenVerified,
          dietaryTags: meal.dietaryTags,
          dietaryVerified: meal.dietaryVerified,
        },
      };
    });
    const quantity = lines.reduce((n, line) => n + line.quantity, 0);
    demand(
      slot.capacity - slot.reserved >= quantity,
      409,
      "This test window has insufficient kitchen capacity.",
    );
    const [terms] = await tx
      .select()
      .from(t.partnerCompensation)
      .where(eq(t.partnerCompensation.kitchenId, slot.kitchenId));
    const subtotalCents = lines.reduce(
      (n, line) => n + line.quantity * line.unitPriceCents,
      0,
    );
    let discountCents = 0;
    if (input.promoCode) {
      const [promo] = await tx
        .select()
        .from(t.promotions)
        .where(eq(t.promotions.code, input.promoCode))
        .for("update");
      demand(
        promo &&
          promo.enabled &&
          promo.expiresAt > new Date() &&
          promo.uses < promo.maxUses,
        409,
        "This test promotion is invalid, expired or fully used.",
      );
      discountCents = Math.floor((subtotalCents * promo.percent) / 100);
      await tx
        .update(t.promotions)
        .set({ uses: sql`${t.promotions.uses} + 1` })
        .where(eq(t.promotions.code, promo.code));
    }
    const [order] = await tx
      .insert(t.orders)
      .values({
        userId: actor.id,
        kitchenId: slot.kitchenId,
        slotId: slot.id,
        mode: input.mode,
        stripeInvoiceId: source?.invoiceId ?? null,
        stripePaymentIntentId: source?.paymentIntentId ?? null,
        status: source
          ? "placed"
          : input.mode === "simulation"
            ? "placed"
            : "awaiting_payment",
        paymentStatus: source
          ? "paid"
          : input.mode === "simulation"
            ? "not_charged"
            : "pending",
        subtotalCents,
        discountCents,
        totalCents: subtotalCents - discountCents,
        partnerAllocationCents: (terms?.perMealCents ?? 0) * quantity,
        addressSnapshot: {
          recipientName: address.recipientName,
          street1: address.street1,
          street2: address.street2,
          city: address.city,
          region: address.region,
          postalCode: address.postalCode,
        },
        requestKey: input.requestKey,
        requestHash: hash,
        promoCode: input.promoCode || null,
      })
      .returning();
    await tx
      .insert(t.orderItems)
      .values(lines.map((line) => ({ ...line, orderId: order.id })));
    for (const line of lines)
      await tx
        .update(t.catalogMeals)
        .set({ stock: sql`${t.catalogMeals.stock} - ${line.quantity}` })
        .where(eq(t.catalogMeals.id, line.mealId));
    await tx
      .update(t.deliverySlots)
      .set({ reserved: sql`${t.deliverySlots.reserved} + ${quantity}` })
      .where(eq(t.deliverySlots.id, slot.id));
    await tx.insert(t.orderEvents).values({
      orderId: order.id,
      actorId: actor.id,
      status: order.status,
      note: "Test order created. No real meal preparation or delivery.",
    });
    // Retain the basket while payment is pending; a verified paid event clears its matching lines.
    if (input.mode === "simulation")
      await tx
        .delete(t.shoppingCartItems)
        .where(eq(t.shoppingCartItems.cartId, cart.id));
    await notify(
      tx,
      actor.id,
      "Test order recorded",
      `Reference ${order.id}. No real delivery.`,
      "/activity",
    );
    await audit(tx, actor.id, "test_order.created", order.id);
    return order;
  }
  return {
    kitchenIds,
    canKitchen,
    orderView,
    ticketView,
    async hasCatalog() {
      return (
        (
          await db
            .select({ id: t.catalogMeals.id })
            .from(t.catalogMeals)
            .limit(1)
        ).length > 0
      );
    },
    async catalog() {
      return db
        .select({
          id: t.catalogMeals.id,
          kitchenId: t.catalogMeals.kitchenId,
          name: t.catalogMeals.name,
          description: t.catalogMeals.description,
          priceCents: t.catalogMeals.priceCents,
          stock: t.catalogMeals.stock,
          status: t.catalogMeals.status,
          version: t.catalogMeals.version,
          ingredients: t.catalogMeals.ingredients,
          allergens: t.catalogMeals.allergens,
          crossContact: t.catalogMeals.crossContact,
          crossContactAllergens: t.catalogMeals.crossContactAllergens,
          allergenVerified: t.catalogMeals.allergenVerified,
          dietaryVerified: t.catalogMeals.dietaryVerified,
          dietaryTags: t.catalogMeals.dietaryTags,
          evidence: t.catalogMeals.evidence,
        })
        .from(t.catalogMeals)
        .innerJoin(t.kitchens, eq(t.kitchens.id, t.catalogMeals.kitchenId))
        .innerJoin(
          t.restaurantPartners,
          eq(t.restaurantPartners.id, t.kitchens.partnerId),
        )
        .where(
          and(
            eq(t.catalogMeals.status, "approved"),
            eq(t.restaurantPartners.status, "approved"),
            eq(t.restaurantPartners.agreementConfirmed, true),
            eq(t.restaurantPartners.testOnly, true),
          ),
        );
    },
    async slots() {
      return db
        .select({
          id: t.deliverySlots.id,
          kitchenId: t.deliverySlots.kitchenId,
          zoneId: t.deliverySlots.zoneId,
          startsAt: t.deliverySlots.startsAt,
          endsAt: t.deliverySlots.endsAt,
          cutoffAt: t.deliverySlots.cutoffAt,
          capacity: t.deliverySlots.capacity,
          reserved: t.deliverySlots.reserved,
          postalCodes: t.deliveryZones.postalCodes,
        })
        .from(t.deliverySlots)
        .innerJoin(
          t.deliveryZones,
          eq(t.deliveryZones.id, t.deliverySlots.zoneId),
        )
        .where(
          and(
            eq(t.deliverySlots.enabled, true),
            eq(t.deliveryZones.enabled, true),
            eq(t.deliveryZones.testOnly, true),
          ),
        );
    },
    async listOrders(actor: Actor) {
      const ids = await kitchenIds(actor);
      const where =
        isAdmin(actor) || isSupport(actor)
          ? undefined
          : isPartner(actor)
            ? inArray(t.orders.kitchenId, ids)
            : eq(t.orders.userId, actor.id);
      const rows = await db
        .select({ id: t.orders.id })
        .from(t.orders)
        .where(where)
        .orderBy(desc(t.orders.createdAt))
        .limit(100);
      return Promise.all(rows.map((row) => orderView(actor, row.id)));
    },
    async checkout(actor: Actor, input: CheckoutInput) {
      return db.transaction((tx) => placeOrder(tx, actor, input));
    },
    async transition(
      actor: Actor,
      id: string,
      status: OrderStatus,
      note: string,
    ) {
      const authorized = await scopedOrder(actor, id);
      const partner =
        isPartner(actor) &&
        (await kitchenIds(actor)).includes(authorized.kitchenId);
      return db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(t.orders)
          .where(eq(t.orders.id, id))
          .for("update");
        demand(
          transitions[order.status].includes(status),
          409,
          "This order transition is not allowed.",
        );

        demand(
          isAdmin(actor) ||
            (partner &&
              ["confirmed", "preparing", "ready", "canceled"].includes(
                status,
              )) ||
            (authorized.userId === actor.id &&
              status === "canceled" &&
              ["awaiting_payment", "placed", "confirmed"].includes(
                order.status,
              )),
          403,
          "You cannot make this order update.",
        );
        demand(
          !(status === "canceled" && order.paymentStatus === "paid"),
          409,
          "A paid test order requires a verified test refund. Open a support ticket.",
        );
        if (status === "canceled" || status === "payment_failed")
          await release(tx, order);
        await tx.update(t.orders).set({ status }).where(eq(t.orders.id, id));
        if (status === "delivered")
          await tx
            .insert(t.partnerPayables)
            .values({
              orderId: id,
              kitchenId: order.kitchenId,
              amountCents: order.partnerAllocationCents,
            })
            .onConflictDoNothing();
        await tx
          .insert(t.orderEvents)
          .values({ orderId: id, actorId: actor.id, status, note });
        await notify(
          tx,
          order.userId,
          "Test order updated",
          `Status: ${status}. ${note}`,
          "/activity",
        );
        await audit(tx, actor.id, `test_order.${status}`, id);
      });
    },
    async setStripeSession(id: string, sessionId: string) {
      const rows = await db
        .update(t.orders)
        .set({ stripeSessionId: sessionId })
        .where(
          and(eq(t.orders.id, id), eq(t.orders.status, "awaiting_payment")),
        )
        .returning();
      return rows.length > 0;
    },
    async abortCheckout(id: string) {
      await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(t.orders)
          .where(eq(t.orders.id, id))
          .for("update");
        if (!order || order.status !== "awaiting_payment") return;
        await release(tx, order);
        await tx
          .update(t.orders)
          .set({ status: "payment_failed", paymentStatus: "failed" })
          .where(eq(t.orders.id, id));
        await tx.insert(t.orderEvents).values({
          orderId: id,
          status: "payment_failed",
          note: "Checkout session creation failed. Inventory released.",
        });
      });
    },
    async orderForPayment(actor: Actor, id: string) {
      const order = await scopedOrder(actor, id);
      demand(
        order.userId === actor.id || isAdmin(actor),
        403,
        "Payment access denied.",
      );
      return order;
    },
    async paymentEvent(event: {
      id: string;
      type: string;
      sessionId?: string;
      orderId?: string;
      paymentIntentId?: string;
      amount?: number;
      paid?: boolean;
      refund?: boolean;
      failed?: boolean;
      subscriptionId?: string;
      subscriptionStatus?: "active" | "past_due" | "paused" | "canceled";
      nextBillingAt?: Date;
      subscriptionRecordId?: string;
      skippedUntil?: Date | null;
    }) {
      return db.transaction(async (tx) => {
        const inserted = await tx
          .insert(t.paymentEvents)
          .values({ id: event.id, type: event.type })
          .onConflictDoNothing()
          .returning();
        if (!inserted.length) return { duplicate: true };
        if (event.subscriptionId || event.subscriptionRecordId) {
          const [subscription] = await tx
            .select()
            .from(t.subscriptions)
            .where(
              event.subscriptionRecordId
                ? eq(t.subscriptions.id, event.subscriptionRecordId)
                : eq(
                    t.subscriptions.stripeSubscriptionId,
                    event.subscriptionId!,
                  ),
            )
            .for("update");
          if (subscription && subscription.status !== "canceled") {
            if (event.sessionId)
              demand(
                subscription.stripeSessionId === event.sessionId,
                409,
                "Subscription session mismatch.",
              );
            if (event.amount !== undefined)
              demand(
                subscription.weeklyPriceCents === event.amount,
                409,
                "Subscription amount mismatch.",
              );
            await tx
              .update(t.subscriptions)
              .set({
                ...(event.subscriptionId
                  ? { stripeSubscriptionId: event.subscriptionId }
                  : {}),
                status: event.subscriptionStatus ?? "active",
                ...(event.nextBillingAt
                  ? { nextBillingAt: event.nextBillingAt }
                  : {}),
                ...(event.skippedUntil !== undefined
                  ? { skippedUntil: event.skippedUntil }
                  : {}),
              })
              .where(eq(t.subscriptions.id, subscription.id));
            await notify(
              tx,
              subscription.userId,
              "Test subscription updated",
              `Billing status: ${event.subscriptionStatus ?? "active"}. No real delivery is scheduled.`,
              "/activity",
            );
          }
        }
        if (!event.orderId && !event.paymentIntentId)
          return { duplicate: false };
        const [order] = await tx
          .select()
          .from(t.orders)
          .where(
            event.orderId
              ? eq(t.orders.id, event.orderId)
              : eq(t.orders.stripePaymentIntentId, event.paymentIntentId!),
          )
          .for("update");
        if (!order && !event.orderId) return { ignored: true };
        demand(
          order?.mode === "stripe_test",
          409,
          "Payment event does not match a test order.",
        );
        if (event.sessionId)
          demand(
            order.stripeSessionId === event.sessionId,
            409,
            "Checkout session mismatch.",
          );
        if (event.amount !== undefined)
          demand(
            event.amount === order.totalCents,
            409,
            "Payment total mismatch.",
          );
        if (event.paid && order.status === "awaiting_payment") {
          await tx
            .update(t.orders)
            .set({
              paymentStatus: "paid",
              status: "placed",
              stripePaymentIntentId: event.paymentIntentId ?? null,
            })
            .where(eq(t.orders.id, order.id));
          await tx.insert(t.orderEvents).values({
            orderId: order.id,
            status: "placed",
            note: "Stripe test payment verified by signed webhook.",
          });
          const [cart] = await tx
            .select()
            .from(t.shoppingCarts)
            .where(eq(t.shoppingCarts.userId, order.userId));
          const lines = await tx
            .select()
            .from(t.orderItems)
            .where(eq(t.orderItems.orderId, order.id));
          for (const line of lines)
            if (cart)
              await tx
                .delete(t.shoppingCartItems)
                .where(
                  and(
                    eq(t.shoppingCartItems.cartId, cart.id),
                    eq(t.shoppingCartItems.mealId, line.mealId),
                    eq(t.shoppingCartItems.quantity, line.quantity),
                  ),
                );
          await notify(
            tx,
            order.userId,
            "Test payment verified",
            "Your test order is recorded. No real food or delivery.",
            "/activity",
          );
        } else if (event.failed && order.status === "awaiting_payment") {
          await release(tx, order);
          await tx
            .update(t.orders)
            .set({ paymentStatus: "failed", status: "payment_failed" })
            .where(eq(t.orders.id, order.id));
          await tx.insert(t.orderEvents).values({
            orderId: order.id,
            status: "payment_failed",
            note: "Test payment failed or checkout expired.",
          });
        } else if (event.refund && order.paymentStatus === "paid") {
          if (["placed", "confirmed"].includes(order.status))
            await release(tx, order);
          await tx
            .update(t.orders)
            .set({ paymentStatus: "refunded", status: "refunded" })
            .where(eq(t.orders.id, order.id));
          await tx
            .update(t.partnerPayables)
            .set({ amountCents: 0, status: "adjusted" })
            .where(eq(t.partnerPayables.orderId, order.id));
          await tx.insert(t.orderEvents).values({
            orderId: order.id,
            status: "refunded",
            note: "Full Stripe test refund verified.",
          });
          await notify(
            tx,
            order.userId,
            "Test refund verified",
            "A full test refund was verified by Stripe.",
            "/activity",
          );
        }
        await audit(tx, null, `stripe.${event.type}`, order.id);
        return { duplicate: false };
      });
    },
    async listTickets(actor: Actor) {
      const rows = await db
        .select({ id: t.supportTickets.id })
        .from(t.supportTickets)
        .where(
          isSupport(actor) ? undefined : eq(t.supportTickets.userId, actor.id),
        )
        .orderBy(desc(t.supportTickets.updatedAt))
        .limit(100);
      return Promise.all(rows.map((row) => ticketView(actor, row.id)));
    },
    async createTicket(actor: Actor, input: TicketInput) {
      if (input.orderId) {
        const order = await scopedOrder(actor, input.orderId);
        demand(
          order.userId === actor.id,
          403,
          "Only your own order can be linked.",
        );
      }
      return db.transaction(async (tx) => {
        const [ticket] = await tx
          .insert(t.supportTickets)
          .values({
            userId: actor.id,
            subject: input.subject,
            category: input.category,
            orderId: input.orderId,
          })
          .returning();
        await tx.insert(t.supportMessages).values({
          ticketId: ticket.id,
          authorId: actor.id,
          body: input.body,
        });
        const agents = await tx
          .select({ userId: t.userRoles.userId })
          .from(t.userRoles)
          .where(
            inArray(t.userRoles.role, [
              "support_agent",
              "operations_admin",
              "founder_admin",
            ]),
          );
        for (const id of new Set(agents.map((row) => row.userId)))
          await notify(
            tx,
            id,
            input.category === "food_safety"
              ? "Food safety escalation"
              : "New support ticket",
            input.subject,
            "/workspace",
          );
        await audit(tx, actor.id, "ticket.created", ticket.id);
        return ticket.id;
      });
    },
    async message(actor: Actor, id: string, body: string, internal: boolean) {
      const ticket = await ticketView(actor, id);
      demand(
        !internal || isSupport(actor),
        403,
        "Internal messages are restricted to support staff.",
      );
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(t.supportTickets)
          .where(eq(t.supportTickets.id, id))
          .for("update");
        demand(
          locked.status !== "resolved",
          409,
          "Reopen this ticket before sending another message.",
        );
        await tx
          .insert(t.supportMessages)
          .values({ ticketId: id, authorId: actor.id, body, internal });
        await tx
          .update(t.supportTickets)
          .set({ updatedAt: new Date() })
          .where(eq(t.supportTickets.id, id));
        if (isSupport(actor) && !internal)
          await notify(
            tx,
            ticket.userId,
            "Support replied",
            ticket.subject,
            "/help",
          );
        else if (ticket.assignedAgentId && !isSupport(actor))
          await notify(
            tx,
            ticket.assignedAgentId,
            "Customer replied",
            ticket.subject,
            "/workspace",
          );
        await audit(
          tx,
          actor.id,
          internal ? "ticket.internal_note" : "ticket.message",
          id,
        );
      });
    },
    async updateTicket(
      actor: Actor,
      id: string,
      status: "open" | "in_progress" | "resolved",
      assignToMe: boolean,
    ) {
      const ticket = await ticketView(actor, id);
      demand(
        isSupport(actor) ||
          (ticket.userId === actor.id && status === "open" && !assignToMe),
        403,
        "Only support can assign or resolve a ticket.",
      );
      await db.transaction(async (tx) => {
        await tx
          .update(t.supportTickets)
          .set({
            status,
            ...(assignToMe ? { assignedAgentId: actor.id } : {}),
            updatedAt: new Date(),
          })
          .where(eq(t.supportTickets.id, id));
        await audit(tx, actor.id, `ticket.${status}`, id);
      });
    },
    async notificationList(actor: Actor) {
      return db
        .select({
          id: t.notifications.id,
          title: t.notifications.title,
          body: t.notifications.body,
          href: t.notifications.href,
          readAt: t.notifications.readAt,
          createdAt: t.notifications.createdAt,
        })
        .from(t.notifications)
        .where(eq(t.notifications.userId, actor.id))
        .orderBy(desc(t.notifications.createdAt))
        .limit(100);
    },
    async readNotification(actor: Actor, id: string) {
      const rows = await db
        .update(t.notifications)
        .set({ readAt: new Date() })
        .where(
          and(eq(t.notifications.id, id), eq(t.notifications.userId, actor.id)),
        )
        .returning();
      demand(rows.length, 404, "Notification not found.");
    },
    async createPartner(actor: Actor, name: string) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(t.restaurantPartners)
          .values({ name })
          .returning();
        await audit(tx, actor.id, "partner.prospect_created", row.id);
        return row;
      });
    },
    async reviewPartner(
      actor: Actor,
      id: string,
      status: "prospective" | "review" | "approved" | "suspended",
      agreementConfirmed: boolean,
    ) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(t.restaurantPartners)
          .where(eq(t.restaurantPartners.id, id))
          .for("update");
        demand(row, 404, "Partner not found.");
        demand(
          status !== "approved" || agreementConfirmed,
          409,
          "An agreement must be confirmed before approval.",
        );
        await tx
          .update(t.restaurantPartners)
          .set({ status, agreementConfirmed })
          .where(eq(t.restaurantPartners.id, id));
        await audit(tx, actor.id, `partner.${status}`, id);
      });
    },
    async createKitchen(actor: Actor, partnerId: string, name: string) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      const [partner] = await db
        .select()
        .from(t.restaurantPartners)
        .where(eq(t.restaurantPartners.id, partnerId));
      demand(partner, 404, "Partner not found.");
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(t.kitchens)
          .values({ partnerId, name })
          .returning();
        await audit(tx, actor.id, "kitchen.created", row.id);
        return row;
      });
    },
    async assignKitchen(
      actor: Actor,
      userId: string,
      kitchenId: string,
      remove = false,
    ) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      const roles = await db
        .select()
        .from(t.userRoles)
        .where(
          and(
            eq(t.userRoles.userId, userId),
            inArray(t.userRoles.role, [
              "restaurant_employee",
              "restaurant_manager",
            ]),
          ),
        );
      demand(
        roles.length,
        409,
        "The user must already have a trusted restaurant role.",
      );
      await db.transaction(async (tx) => {
        if (remove)
          await tx
            .delete(t.kitchenMembers)
            .where(
              and(
                eq(t.kitchenMembers.userId, userId),
                eq(t.kitchenMembers.kitchenId, kitchenId),
              ),
            );
        else
          await tx
            .insert(t.kitchenMembers)
            .values({ userId, kitchenId })
            .onConflictDoNothing();
        await audit(
          tx,
          actor.id,
          remove ? "kitchen.member_removed" : "kitchen.member_assigned",
          kitchenId,
        );
      });
    },
    async saveMeal(
      actor: Actor,
      input: MealInput,
      id?: string,
      version?: number,
    ) {
      demand(
        await canKitchen(actor, input.kitchenId),
        403,
        "This kitchen is not assigned to you.",
      );
      return db.transaction(async (tx) => {
        if (id) {
          const [meal] = await tx
            .select()
            .from(t.catalogMeals)
            .where(eq(t.catalogMeals.id, id))
            .for("update");
          demand(
            meal && meal.kitchenId === input.kitchenId,
            404,
            "Meal not found.",
          );
          demand(
            meal.version === version,
            409,
            "This menu changed. Reload before editing.",
          );
          await tx
            .update(t.catalogMeals)
            .set({
              ...input,
              status: "draft",
              allergenVerified: false,
              dietaryVerified: false,
              version: meal.version + 1,
            })
            .where(eq(t.catalogMeals.id, id));
        } else {
          id = `draft-${randomUUID()}`;
          await tx.insert(t.catalogMeals).values({ ...input, id });
        }
        await audit(tx, actor.id, "menu.draft_saved", id);
        return id;
      });
    },
    async submitMeal(actor: Actor, id: string) {
      const [meal] = await db
        .select()
        .from(t.catalogMeals)
        .where(eq(t.catalogMeals.id, id));
      demand(
        meal && (await canKitchen(actor, meal.kitchenId)),
        404,
        "Meal not found.",
      );
      demand(meal.status === "draft", 409, "Only a draft can be submitted.");
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(t.catalogMeals)
          .where(eq(t.catalogMeals.id, id))
          .for("update");
        demand(
          current.status === "draft",
          409,
          "Only a draft can be submitted.",
        );
        await tx
          .update(t.catalogMeals)
          .set({
            status: "submitted",
            version: sql`${t.catalogMeals.version} + 1`,
          })
          .where(
            and(eq(t.catalogMeals.id, id), eq(t.catalogMeals.status, "draft")),
          );
        await audit(tx, actor.id, "menu.submitted", id);
      });
    },
    async reviewMeal(
      actor: Actor,
      id: string,
      status: "approved" | "hidden",
      allergenVerified: boolean,
      dietaryVerified: boolean,
      version: number,
    ) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      await db.transaction(async (tx) => {
        const [meal] = await tx
          .select()
          .from(t.catalogMeals)
          .where(eq(t.catalogMeals.id, id))
          .for("update");
        demand(meal, 404, "Meal not found.");
        demand(
          meal.version === version,
          409,
          "This menu changed. Reload before reviewing.",
        );
        demand(
          status !== "approved" || meal.status === "submitted",
          409,
          "Submit this draft before approving it.",
        );
        demand(
          !(allergenVerified || dietaryVerified) ||
            meal.evidence.trim().length > 0,
          409,
          "Verification requires recorded evidence.",
        );
        if (allergenVerified)
          demand(
            meal.crossContact.trim() && !/unknown/i.test(meal.crossContact),
            409,
            "Cross-contact information must be documented.",
          );
        await tx
          .update(t.catalogMeals)
          .set({
            status,
            allergenVerified,
            dietaryVerified,
            version: meal.version + 1,
          })
          .where(eq(t.catalogMeals.id, id));
        await audit(tx, actor.id, `menu.${status}`, id);
      });
    },
    async createZone(
      actor: Actor,
      input: {
        name: string;
        postalCodes: string[];
        enabled: boolean;
        testOnly: true;
      },
    ) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(t.deliveryZones)
          .values(input)
          .returning();
        await audit(tx, actor.id, "test_zone.created", row.id);
        return row;
      });
    },
    async createSlot(
      actor: Actor,
      input: {
        kitchenId: string;
        zoneId: string;
        startsAt: string;
        endsAt: string;
        cutoffAt: string;
        capacity: number;
        enabled: boolean;
      },
    ) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      const [zone] = await db
        .select()
        .from(t.deliveryZones)
        .where(eq(t.deliveryZones.id, input.zoneId));
      demand(
        zone?.testOnly,
        409,
        "Only test-only service zones can be scheduled.",
      );
      return db.transaction(async (tx) => {
        await tx
          .select({ id: t.kitchens.id })
          .from(t.kitchens)
          .where(eq(t.kitchens.id, input.kitchenId))
          .for("update");
        const overlapping = await tx
          .select({ id: t.deliverySlots.id })
          .from(t.deliverySlots)
          .where(
            and(
              eq(t.deliverySlots.kitchenId, input.kitchenId),
              eq(t.deliverySlots.enabled, true),
              lt(t.deliverySlots.startsAt, new Date(input.endsAt)),
              gt(t.deliverySlots.endsAt, new Date(input.startsAt)),
            ),
          );
        demand(
          !input.enabled || !overlapping.length,
          409,
          "This kitchen already has an enabled test window that overlaps.",
        );
        const [row] = await tx
          .insert(t.deliverySlots)
          .values({
            ...input,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            cutoffAt: new Date(input.cutoffAt),
          })
          .returning();
        await audit(tx, actor.id, "test_slot.created", row.id);
        return row;
      });
    },
    async savePromo(
      actor: Actor,
      input: {
        code: string;
        percent: number;
        maxUses: number;
        expiresAt: string;
        enabled: boolean;
      },
    ) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(t.promotions)
          .where(eq(t.promotions.code, input.code))
          .for("update");
        demand(
          !existing || input.maxUses >= existing.uses,
          409,
          "The use limit cannot be below prior redemptions.",
        );
        await tx
          .insert(t.promotions)
          .values({ ...input, expiresAt: new Date(input.expiresAt) })
          .onConflictDoUpdate({
            target: t.promotions.code,
            set: { ...input, expiresAt: new Date(input.expiresAt) },
          });
        await audit(tx, actor.id, "promotion.saved", input.code);
      });
    },
    async portal(actor: Actor) {
      demand(
        isAdmin(actor) || isSupport(actor) || isPartner(actor),
        403,
        "Staff permission required.",
      );
      const ids = await kitchenIds(actor);
      const [partners, kitchenRows, menus, zones, slots, promos, audits] =
        await Promise.all([
          isAdmin(actor) ? db.select().from(t.restaurantPartners) : [],
          isAdmin(actor)
            ? db.select().from(t.kitchens)
            : db.select().from(t.kitchens).where(inArray(t.kitchens.id, ids)),
          isAdmin(actor) || isPartner(actor)
            ? db
                .select()
                .from(t.catalogMeals)
                .where(
                  isAdmin(actor)
                    ? undefined
                    : inArray(t.catalogMeals.kitchenId, ids),
                )
            : [],
          isAdmin(actor) ? db.select().from(t.deliveryZones) : [],
          isAdmin(actor) || isPartner(actor)
            ? db
                .select()
                .from(t.deliverySlots)
                .where(
                  isAdmin(actor)
                    ? undefined
                    : inArray(t.deliverySlots.kitchenId, ids),
                )
            : [],
          isAdmin(actor) ? db.select().from(t.promotions) : [],
          isAdmin(actor)
            ? db
                .select({
                  id: t.auditEvents.id,
                  action: t.auditEvents.action,
                  entityId: t.auditEvents.entityId,
                  createdAt: t.auditEvents.createdAt,
                })
                .from(t.auditEvents)
                .orderBy(desc(t.auditEvents.createdAt))
                .limit(100)
            : [],
        ]);
      const orderRows = await this.listOrders(actor);
      const ticketRows = isSupport(actor) ? await this.listTickets(actor) : [];
      return {
        orders: orderRows,
        tickets: ticketRows,
        partners,
        kitchens: kitchenRows,
        menus,
        zones,
        slots,
        promotions: promos,
        audit: audits,
        metrics: {
          testOrders: orderRows.length,
          paidTestSalesCents: orderRows
            .filter((o) => o.paymentStatus === "paid")
            .reduce((n, o) => n + o.totalCents, 0),
          refundedTestOrders: orderRows.filter(
            (o) => o.paymentStatus === "refunded",
          ).length,
          openTickets: ticketRows.filter(
            (ticket) => ticket.status !== "resolved",
          ).length,
        },
      };
    },
    async listSubscriptions(actor: Actor) {
      return db
        .select()
        .from(t.subscriptions)
        .where(eq(t.subscriptions.userId, actor.id))
        .orderBy(desc(t.subscriptions.createdAt))
        .limit(50);
    },
    async createSubscription(actor: Actor, mealCount: 5 | 10 | 15) {
      return db.transaction(async (tx) => {
        await userLock(tx, actor.id);
        const existing = await tx
          .select()
          .from(t.subscriptions)
          .where(
            and(
              eq(t.subscriptions.userId, actor.id),
              inArray(t.subscriptions.status, [
                "checkout_pending",
                "active",
                "paused",
                "past_due",
              ]),
            ),
          );
        demand(
          !existing.length,
          409,
          "You already have an active or pending test plan.",
        );
        const [row] = await tx
          .insert(t.subscriptions)
          .values({
            userId: actor.id,
            mealCount,
            weeklyPriceCents: mealCount * 1500,
          })
          .returning();
        await audit(tx, actor.id, "test_subscription.created", row.id);
        return row;
      });
    },
    async subscriptionForUser(actor: Actor, id: string) {
      const [row] = await db
        .select()
        .from(t.subscriptions)
        .where(
          and(eq(t.subscriptions.id, id), eq(t.subscriptions.userId, actor.id)),
        );
      demand(row, 404, "Subscription not found.");
      return row;
    },
    async updateSubscription(
      id: string,
      change: Partial<
        Pick<
          typeof t.subscriptions.$inferInsert,
          | "status"
          | "stripeSessionId"
          | "stripeSubscriptionId"
          | "nextBillingAt"
          | "skippedUntil"
        >
      >,
    ) {
      await db
        .update(t.subscriptions)
        .set(change)
        .where(
          and(
            eq(t.subscriptions.id, id),
            ...(change.status === "canceled"
              ? []
              : [ne(t.subscriptions.status, "canceled")]),
          ),
        );
    },
    async listCustomers(actor: Actor) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      const users = await db
        .select({
          id: t.appUsers.id,
          email: t.appUsers.email,
          displayName: t.appUsers.displayName,
          disabledAt: t.appUsers.disabledAt,
          createdAt: t.appUsers.createdAt,
        })
        .from(t.appUsers)
        .orderBy(desc(t.appUsers.createdAt))
        .limit(100);
      const roles = await db.select().from(t.userRoles);
      return users.map((user) => ({
        ...user,
        roles: roles
          .filter((role) => role.userId === user.id)
          .map((role) => role.role),
      }));
    },
    async manageCustomer(actor: Actor, id: string, disabled: boolean) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      demand(actor.id !== id, 409, "You cannot disable your own account.");
      const roles = await db
        .select()
        .from(t.userRoles)
        .where(eq(t.userRoles.userId, id));
      demand(
        !roles.some((row) => row.role === "founder_admin") ||
          actor.roles.includes("founder_admin"),
        403,
        "Only a founder can manage a founder account.",
      );
      await db.transaction(async (tx) => {
        const rows = await tx
          .update(t.appUsers)
          .set({ disabledAt: disabled ? new Date() : null })
          .where(eq(t.appUsers.id, id))
          .returning();
        demand(rows.length, 404, "Account not found.");
        await audit(
          tx,
          actor.id,
          disabled ? "account.disabled" : "account.enabled",
          id,
        );
      });
    },
    async grantRole(actor: Actor, id: string, role: Role, enabled: boolean) {
      demand(
        actor.roles.includes("founder_admin"),
        403,
        "Only a founder administrator can change application roles.",
      );
      demand(
        id !== actor.id,
        409,
        "Self-service role changes are not permitted.",
      );
      await db.transaction(async (tx) => {
        const [user] = await tx
          .select()
          .from(t.appUsers)
          .where(eq(t.appUsers.id, id));
        demand(user, 404, "Account not found.");
        if (enabled)
          await tx
            .insert(t.userRoles)
            .values({ userId: id, role, grantedByUserId: actor.id })
            .onConflictDoNothing();
        else
          await tx
            .delete(t.userRoles)
            .where(and(eq(t.userRoles.userId, id), eq(t.userRoles.role, role)));
        await audit(
          tx,
          actor.id,
          `role.${enabled ? "grant" : "revoke"}.${role}`,
          id,
        );
      });
    },
    async updateSlot(
      actor: Actor,
      id: string,
      capacity: number,
      enabled: boolean,
    ) {
      const [slot] = await db
        .select()
        .from(t.deliverySlots)
        .where(eq(t.deliverySlots.id, id));
      demand(
        slot && (await canKitchen(actor, slot.kitchenId)),
        404,
        "Test window not found.",
      );
      await db.transaction(async (tx) => {
        await tx
          .select({ id: t.kitchens.id })
          .from(t.kitchens)
          .where(eq(t.kitchens.id, slot.kitchenId))
          .for("update");
        const [current] = await tx
          .select()
          .from(t.deliverySlots)
          .where(eq(t.deliverySlots.id, id))
          .for("update");
        const overlaps = await tx
          .select({ id: t.deliverySlots.id })
          .from(t.deliverySlots)
          .where(
            and(
              eq(t.deliverySlots.kitchenId, slot.kitchenId),
              ne(t.deliverySlots.id, id),
              eq(t.deliverySlots.enabled, true),
              lt(t.deliverySlots.startsAt, current.endsAt),
              gt(t.deliverySlots.endsAt, current.startsAt),
            ),
          );
        demand(
          !enabled || !overlaps.length,
          409,
          "This window would overlap an enabled kitchen window.",
        );
        demand(
          capacity >= current.reserved,
          409,
          "Capacity cannot be lower than existing reservations.",
        );
        await tx
          .update(t.deliverySlots)
          .set({ capacity, enabled })
          .where(eq(t.deliverySlots.id, id));
        await audit(
          tx,
          actor.id,
          enabled ? "test_slot.updated" : "test_slot.blocked",
          id,
        );
      });
    },
    async compensation(
      actor: Actor,
      kitchenId: string,
      perMealCents: number,
      reference: string,
    ) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      await db.transaction(async (tx) => {
        await tx
          .insert(t.partnerCompensation)
          .values({ kitchenId, perMealCents, reference })
          .onConflictDoUpdate({
            target: t.partnerCompensation.kitchenId,
            set: { perMealCents, reference },
          });
        await audit(tx, actor.id, "test_compensation.updated", kitchenId);
      });
    },
    async payables(actor: Actor) {
      const ids = await kitchenIds(actor);
      demand(
        isAdmin(actor) || isPartner(actor),
        403,
        "Partner accounting permission required.",
      );
      return db
        .select()
        .from(t.partnerPayables)
        .where(
          isAdmin(actor)
            ? undefined
            : inArray(t.partnerPayables.kitchenId, ids),
        )
        .orderBy(desc(t.partnerPayables.createdAt))
        .limit(100);
    },
    async settleTestPayable(actor: Actor, id: string) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      await db.transaction(async (tx) => {
        const rows = await tx
          .update(t.partnerPayables)
          .set({ status: "settled_test" })
          .where(
            and(
              eq(t.partnerPayables.orderId, id),
              eq(t.partnerPayables.status, "recorded"),
            ),
          )
          .returning();
        demand(rows.length, 409, "No outstanding test payable exists.");
        await audit(tx, actor.id, "test_settlement.recorded_no_transfer", id);
      });
    },
    async createLead(input: {
      kind: "waitlist" | "partner";
      name: string;
      email: string;
      postalCode: string;
      message: string;
      consent: true;
    }) {
      const [row] = await db
        .insert(t.launchLeads)
        .values(input)
        .returning({ id: t.launchLeads.id });
      return row;
    },
    async leads(actor: Actor) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      return db
        .select()
        .from(t.launchLeads)
        .orderBy(desc(t.launchLeads.createdAt))
        .limit(100);
    },
    async updateLead(
      actor: Actor,
      id: string,
      status: "received" | "review" | "closed",
    ) {
      demand(isAdmin(actor), 403, "Admin permission required.");
      await db.transaction(async (tx) => {
        const rows = await tx
          .update(t.launchLeads)
          .set({ status })
          .where(eq(t.launchLeads.id, id))
          .returning();
        demand(rows.length, 404, "Inquiry not found.");
        await audit(tx, actor.id, `lead.${status}`, id);
      });
    },
    async subscriptionBoxes(actor: Actor) {
      const plans = await db
        .select({ id: t.subscriptions.id })
        .from(t.subscriptions)
        .where(eq(t.subscriptions.userId, actor.id));
      const ids = plans.map((plan) => plan.id);
      const [boxes, invoices] = await Promise.all([
        db
          .select()
          .from(t.subscriptionBoxes)
          .where(inArray(t.subscriptionBoxes.subscriptionId, ids))
          .orderBy(desc(t.subscriptionBoxes.periodStart))
          .limit(100),
        db
          .select()
          .from(t.subscriptionInvoices)
          .where(inArray(t.subscriptionInvoices.subscriptionId, ids))
          .orderBy(desc(t.subscriptionInvoices.periodStart))
          .limit(100),
      ]);
      return { boxes, invoices };
    },
    async saveSubscriptionBox(
      actor: Actor,
      input: {
        subscriptionId: string;
        addressId: string;
        slotId: string;
        items: { mealId: string; quantity: number }[];
      },
    ) {
      const box = await db.transaction(async (tx) => {
        await userLock(tx, actor.id);
        const [plan] = await tx
          .select()
          .from(t.subscriptions)
          .where(
            and(
              eq(t.subscriptions.id, input.subscriptionId),
              eq(t.subscriptions.userId, actor.id),
            ),
          )
          .for("update");
        demand(
          plan && plan.status !== "canceled" && plan.nextBillingAt,
          409,
          "A verified test billing period is required before saving a weekly box.",
        );
        demand(
          input.items.reduce((n, i) => n + i.quantity, 0) === plan.mealCount,
          400,
          "The selected meal count must match your billing plan.",
        );
        const [address] = await tx
          .select()
          .from(t.customerAddresses)
          .where(
            and(
              eq(t.customerAddresses.id, input.addressId),
              eq(t.customerAddresses.userId, actor.id),
            ),
          );
        demand(address, 400, "Select one of your saved addresses.");
        const [slot] = await tx
          .select()
          .from(t.deliverySlots)
          .where(eq(t.deliverySlots.id, input.slotId));
        demand(
          slot && slot.enabled && slot.cutoffAt > new Date(),
          409,
          "Choose an open test window before its cutoff.",
        );
        const meals = await tx
          .select()
          .from(t.catalogMeals)
          .where(
            inArray(
              t.catalogMeals.id,
              input.items.map((i) => i.mealId),
            ),
          );
        demand(
          meals.length === input.items.length &&
            meals.every(
              (meal) =>
                meal.status === "approved" && meal.kitchenId === slot.kitchenId,
            ),
          409,
          "All box meals must be approved for the selected test kitchen.",
        );
        const week = 7 * 86400000;
        let end = plan.nextBillingAt.getTime();
        while (slot.startsAt.getTime() >= end) end += week;
        while (slot.startsAt.getTime() < end - week) end -= week;
        const periodStart = new Date(end - week),
          periodEnd = new Date(end);
        const [existing] = await tx
          .select()
          .from(t.subscriptionBoxes)
          .where(
            and(
              eq(t.subscriptionBoxes.subscriptionId, plan.id),
              eq(t.subscriptionBoxes.periodStart, periodStart),
            ),
          )
          .for("update");
        demand(
          !existing || (!existing.orderId && existing.status !== "fulfilled"),
          409,
          "This weekly test box already created an order and cannot be edited.",
        );
        const [row] = await tx
          .insert(t.subscriptionBoxes)
          .values({ ...input, periodStart, periodEnd })
          .onConflictDoUpdate({
            target: [
              t.subscriptionBoxes.subscriptionId,
              t.subscriptionBoxes.periodStart,
            ],
            set: {
              addressId: input.addressId,
              slotId: input.slotId,
              items: input.items,
              status: "draft",
              note: "",
              updatedAt: new Date(),
            },
          })
          .returning();
        await audit(tx, actor.id, "subscription_box.saved", row.id);
        return row;
      });
      const invoices = await db
        .select()
        .from(t.subscriptionInvoices)
        .where(
          and(
            eq(t.subscriptionInvoices.subscriptionId, input.subscriptionId),
            eq(t.subscriptionInvoices.periodStart, box.periodStart),
          ),
        );
      for (const invoice of invoices)
        await this.fulfillSubscriptionInvoice(invoice.id);
      return box.id;
    },
    async recordSubscriptionInvoice(input: {
      id: string;
      eventId: string;
      subscriptionRecordId: string;
      stripeSubscriptionId: string;
      amountCents: number;
      periodStart: Date;
      periodEnd: Date;
      paymentIntentId: string | null;
    }) {
      await db.transaction(async (tx) => {
        const [plan] = await tx
          .select()
          .from(t.subscriptions)
          .where(eq(t.subscriptions.id, input.subscriptionRecordId))
          .for("update");
        demand(
          plan,
          409,
          "The paid test invoice is not linked to a known plan.",
        );
        demand(
          !plan.stripeSubscriptionId ||
            plan.stripeSubscriptionId === input.stripeSubscriptionId,
          409,
          "Subscription invoice mismatch.",
        );
        demand(
          input.amountCents === plan.weeklyPriceCents,
          409,
          "The test invoice amount does not match the recorded weekly price.",
        );
        demand(
          input.periodStart < input.periodEnd,
          409,
          "The invoice period is invalid.",
        );
        await tx
          .insert(t.paymentEvents)
          .values({ id: input.eventId, type: "invoice.paid" })
          .onConflictDoNothing();
        const [existingInvoice] = await tx
          .select()
          .from(t.subscriptionInvoices)
          .where(eq(t.subscriptionInvoices.id, input.id));
        demand(
          !existingInvoice ||
            (existingInvoice.subscriptionId === plan.id &&
              existingInvoice.amountCents === input.amountCents &&
              existingInvoice.periodStart.getTime() ===
                input.periodStart.getTime() &&
              existingInvoice.periodEnd.getTime() ===
                input.periodEnd.getTime()),
          409,
          "Invoice identity mismatch.",
        );
        await tx
          .insert(t.subscriptionInvoices)
          .values({
            id: input.id,
            subscriptionId: plan.id,
            amountCents: input.amountCents,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            paymentIntentId: input.paymentIntentId,
          })
          .onConflictDoNothing();
        if (plan.status !== "canceled")
          await tx
            .update(t.subscriptions)
            .set({
              stripeSubscriptionId: input.stripeSubscriptionId,
              nextBillingAt:
                plan.nextBillingAt && plan.nextBillingAt > input.periodEnd
                  ? plan.nextBillingAt
                  : input.periodEnd,
              status:
                existingInvoice ||
                plan.status === "paused" ||
                (plan.nextBillingAt && input.periodEnd < plan.nextBillingAt)
                  ? plan.status
                  : "active",
            })
            .where(eq(t.subscriptions.id, plan.id));
      });
      return this.fulfillSubscriptionInvoice(input.id);
    },
    async fulfillSubscriptionInvoice(invoiceId: string) {
      try {
        return await db.transaction(async (tx) => {
          const [preview] = await tx
            .select()
            .from(t.subscriptionInvoices)
            .where(eq(t.subscriptionInvoices.id, invoiceId));
          demand(preview, 404, "Invoice not found.");
          const [plan] = await tx
            .select()
            .from(t.subscriptions)
            .where(eq(t.subscriptions.id, preview.subscriptionId));
          await userLock(tx, plan.userId);
          const [invoice] = await tx
            .select()
            .from(t.subscriptionInvoices)
            .where(eq(t.subscriptionInvoices.id, invoiceId))
            .for("update");
          if (invoice.orderId) return invoice.orderId;
          const [box] = await tx
            .select()
            .from(t.subscriptionBoxes)
            .where(
              and(
                eq(t.subscriptionBoxes.subscriptionId, plan.id),
                eq(t.subscriptionBoxes.periodStart, invoice.periodStart),
              ),
            )
            .for("update");
          demand(
            box,
            409,
            "Choose a weekly test box for this paid test billing period.",
          );
          demand(
            !box.orderId,
            409,
            "This weekly test box was already fulfilled by a different paid invoice. Review billing before retrying.",
          );
          demand(
            box.items.reduce((n, item) => n + item.quantity, 0) ===
              plan.mealCount,
            409,
            "Update the weekly box to match the plan size.",
          );
          const digest = createHash("sha256")
            .update(`nomilora-invoice:${invoice.id}`)
            .digest("hex");
          const requestKey = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
          const order = await placeOrder(
            tx,
            { id: plan.userId, roles: ["customer"] },
            {
              addressId: box.addressId,
              slotId: box.slotId,
              mode: "stripe_test",
              requestKey,
              acknowledgedTestOnly: true,
            },
            {
              items: box.items,
              unitPriceCents: plan.weeklyPriceCents / plan.mealCount,
              invoiceId: invoice.id,
              paymentIntentId: invoice.paymentIntentId,
            },
          );
          await tx
            .update(t.subscriptionInvoices)
            .set({ status: "fulfilled", orderId: order.id, note: "" })
            .where(eq(t.subscriptionInvoices.id, invoice.id));
          await tx
            .update(t.subscriptionBoxes)
            .set({
              status: "fulfilled",
              orderId: order.id,
              note: "Verified paid test invoice created this order.",
            })
            .where(eq(t.subscriptionBoxes.id, box.id));
          await audit(tx, plan.userId, "subscription_box.fulfilled", box.id);
          return order.id;
        });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        await db.transaction(async (tx) => {
          const [invoice] = await tx
            .select()
            .from(t.subscriptionInvoices)
            .where(eq(t.subscriptionInvoices.id, invoiceId))
            .for("update");
          if (!invoice || invoice.orderId) return;
          const [plan] = await tx
            .select()
            .from(t.subscriptions)
            .where(eq(t.subscriptions.id, invoice.subscriptionId));
          if (invoice.note !== error.message) {
            await notify(
              tx,
              plan.userId,
              "Paid test billing needs attention",
              error.message,
              "/boxes",
            );
            const staff = await tx
              .select({ id: t.userRoles.userId })
              .from(t.userRoles)
              .where(
                inArray(t.userRoles.role, [
                  "support_agent",
                  "operations_admin",
                  "founder_admin",
                ]),
              );
            for (const id of new Set(staff.map((s) => s.id)))
              await notify(
                tx,
                id,
                "Paid test fulfilment exception",
                `Invoice ${invoice.id}: ${error.message}`,
                "/workspace",
              );
          }
          await tx
            .update(t.subscriptionInvoices)
            .set({ status: "needs_attention", note: error.message })
            .where(eq(t.subscriptionInvoices.id, invoiceId));
          await tx
            .update(t.subscriptionBoxes)
            .set({ status: "needs_attention", note: error.message })
            .where(
              and(
                eq(t.subscriptionBoxes.subscriptionId, invoice.subscriptionId),
                eq(t.subscriptionBoxes.periodStart, invoice.periodStart),
                isNull(t.subscriptionBoxes.orderId),
              ),
            );
          await audit(
            tx,
            plan.userId,
            "subscription_box.needs_attention",
            invoice.id,
          );
        });
        return null;
      }
    },
    async billingAttention(actor: Actor) {
      demand(isSupport(actor), 403, "Staff permission required.");
      return db
        .select({
          id: t.subscriptionInvoices.id,
          subscriptionId: t.subscriptionInvoices.subscriptionId,
          amountCents: t.subscriptionInvoices.amountCents,
          periodStart: t.subscriptionInvoices.periodStart,
          periodEnd: t.subscriptionInvoices.periodEnd,
          note: t.subscriptionInvoices.note,
        })
        .from(t.subscriptionInvoices)
        .where(eq(t.subscriptionInvoices.status, "needs_attention"))
        .limit(100);
    },
    async seedTestData() {
      return db.transaction(async (tx) => {
        const partnerId = "10000000-0000-4000-8000-000000000001",
          kitchenId = "10000000-0000-4000-8000-000000000002",
          zoneId = "10000000-0000-4000-8000-000000000003",
          slotId = "10000000-0000-4000-8000-000000000004";
        await tx
          .insert(t.restaurantPartners)
          .values({
            id: partnerId,
            name: "Fictional Nomilora Test Kitchen",
            status: "approved",
            testOnly: true,
            agreementConfirmed: true,
          })
          .onConflictDoNothing();
        await tx
          .insert(t.kitchens)
          .values({
            id: kitchenId,
            partnerId,
            name: "Test preparation only — no real food",
          })
          .onConflictDoNothing();
        await tx
          .insert(t.deliveryZones)
          .values({
            id: zoneId,
            name: "Test ZIP area — no real delivery",
            postalCodes: ["11101", "11102", "11103", "11106"],
            testOnly: true,
            enabled: true,
          })
          .onConflictDoNothing();
        await tx
          .insert(t.deliverySlots)
          .values({
            id: slotId,
            kitchenId,
            zoneId,
            startsAt: new Date(Date.now() + 86400000),
            endsAt: new Date(Date.now() + 90000000),
            cutoffAt: new Date(Date.now() + 72000000),
            capacity: 100,
            enabled: true,
          })
          .onConflictDoNothing();
        for (const meal of nomiloraMeals)
          await tx
            .insert(t.catalogMeals)
            .values({
              id: meal.id,
              kitchenId,
              name: meal.name,
              description: meal.description,
              priceCents: meal.priceCents,
              stock: 100,
              status: "approved",
              ingredients: meal.ingredients,
              allergens: meal.allergens,
              dietaryTags: meal.dietaryTags,
              crossContact: "Unknown",
              evidence: "Illustrative test fixture. Not verified.",
            })
            .onConflictDoNothing();
        return { partnerId, kitchenId, zoneId, slotId };
      });
    },
  };
}
export type OperationsStore = ReturnType<typeof createOperationsStore>;
