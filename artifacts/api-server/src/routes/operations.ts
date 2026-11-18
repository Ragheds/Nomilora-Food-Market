import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import * as c from "@workspace/api-zod/operations";
import { authenticate, type VerifyToken } from "../lib/auth";
import { createAccountStore, type AccountStore } from "../lib/account-store";
import {
  createOperationsStore,
  DomainError,
  isAdmin,
  type OperationsStore,
  type Actor,
} from "../lib/operations-store";
import {
  expireOrderPayment,
  orderPayment,
  paymentReady,
  processWebhook,
  refundOrder,
  subscriptionAction,
  subscriptionCheckout,
} from "../lib/payments";
export type OperationsOptions = {
  verify?: VerifyToken;
  store?: () => Promise<AccountStore>;
  operations?: () => Promise<OperationsStore>;
};
export async function getOperations() {
  if (!process.env.DATABASE_URL)
    throw new DomainError(
      503,
      "Database-backed operations are not configured.",
    );
  return createOperationsStore((await import("@workspace/db")).db);
}
export function createOperationsRouter(options: OperationsOptions = {}) {
  const router = Router();
  router.use(authenticate(options.verify));
  router.use(async (_req, res, next) => {
    if (!options.store && !process.env.DATABASE_URL)
      throw new DomainError(503, "Account storage is not configured.");
    const account = await (options.store
      ? options.store()
      : import("@workspace/db").then((db) => createAccountStore(db.db)));
    const identity = await account.identify(res.locals.identity);
    if (
      identity.roles.some((role) => role !== "customer") &&
      !res.locals.identity.mfaVerified
    )
      throw new DomainError(
        403,
        "Staff access requires authenticator verification. Open My account to enroll or verify.",
      );
    res.locals.actor = { id: identity.id, roles: identity.roles };
    res.locals.operations = await (options.operations ?? getOperations)();
    next();
  });
  const actor = (res: Response) => res.locals.actor as Actor;
  const store = (res: Response) => res.locals.operations as OperationsStore;
  const id = (value: unknown) => {
    const result = c.idSchema.safeParse(value);
    if (!result.success) throw new DomainError(400, "Invalid identifier.");
    return result.data;
  };
  const mealId = (value: unknown) => {
    const result = z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(100)
      .safeParse(value);
    if (!result.success) throw new DomainError(400, "Invalid meal identifier.");
    return result.data;
  };
  const body =
    <T extends z.ZodTypeAny>(
      schema: T,
      fn: (
        data: z.output<T>,
        res: Response,
        params: Record<string, string | string[]>,
      ) => Promise<unknown>,
    ): RequestHandler =>
    async (req, res) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        throw new DomainError(400, "Please check the submitted fields.");
      const result = await fn(parsed.data, res, req.params);
      if (!res.headersSent)
        res.status(result === undefined ? 204 : 200).json(result);
    };
  router.get("/config", (_req, res) => {
    let stripeTestConfigured = false;
    try {
      paymentReady();
      stripeTestConfigured = true;
    } catch {}
    res.json({
      mode: "test_only",
      livePayments: false,
      realDelivery: false,
      stripeTestConfigured,
    });
  });
  router.get("/catalog", async (_req, res) =>
    res.json(await store(res).catalog()),
  );
  router.get("/slots", async (_req, res) => res.json(await store(res).slots()));
  router.get("/orders", async (_req, res) =>
    res.json(await store(res).listOrders(actor(res))),
  );
  router.get("/orders/:id", async (req, res) =>
    res.json(await store(res).orderView(actor(res), id(req.params.id))),
  );
  router.post(
    "/orders",
    body(c.checkoutInput, async (input, res) => {
      if (input.mode === "stripe_test") paymentReady();
      const order = await store(res).checkout(actor(res), input);
      if (input.mode === "stripe_test")
        return orderPayment(store(res), actor(res), order.id);
      return { orderId: order.id, url: null };
    }),
  );
  router.post("/orders/:id/pay", async (req, res) =>
    res.json(await orderPayment(store(res), actor(res), id(req.params.id))),
  );
  router.post(
    "/orders/:id/transition",
    body(c.transitionInput, async (input, res, params) => {
      const orderId = id(params.id);
      if (input.status === "canceled")
        await expireOrderPayment(store(res), actor(res), orderId);
      await store(res).transition(
        actor(res),
        orderId,
        input.status,
        input.note,
      );
    }),
  );
  router.post("/orders/:id/refund", async (req, res) => {
    if (!isAdmin(actor(res)))
      throw new DomainError(
        403,
        "Only an administrator can submit a test refund.",
      );
    res.json(await refundOrder(store(res), actor(res), id(req.params.id)));
  });
  router.get("/tickets", async (_req, res) =>
    res.json(await store(res).listTickets(actor(res))),
  );
  router.get("/tickets/:id", async (req, res) =>
    res.json(await store(res).ticketView(actor(res), id(req.params.id))),
  );
  router.post(
    "/tickets",
    body(c.ticketInput, async (input, res) => ({
      id: await store(res).createTicket(actor(res), input),
    })),
  );
  router.post(
    "/tickets/:id/messages",
    body(c.messageInput, async (input, res, params) =>
      store(res).message(actor(res), id(params.id), input.body, input.internal),
    ),
  );
  router.put(
    "/tickets/:id",
    body(c.ticketUpdateInput, async (input, res, params) =>
      store(res).updateTicket(
        actor(res),
        id(params.id),
        input.status,
        input.assignToMe,
      ),
    ),
  );
  router.get("/notifications", async (_req, res) =>
    res.json(await store(res).notificationList(actor(res))),
  );
  router.put("/notifications/:id/read", async (req, res) => {
    await store(res).readNotification(actor(res), id(req.params.id));
    res.status(204).end();
  });
  router.get("/portal", async (_req, res) =>
    res.json(await store(res).portal(actor(res))),
  );
  router.post(
    "/partners",
    body(c.partnerInput, async (input, res) =>
      store(res).createPartner(actor(res), input.name),
    ),
  );
  router.put(
    "/partners/:id",
    body(c.partnerReviewInput, async (input, res, params) =>
      store(res).reviewPartner(
        actor(res),
        id(params.id),
        input.status,
        input.agreementConfirmed,
      ),
    ),
  );
  router.post(
    "/kitchens",
    body(c.kitchenInput, async (input, res) =>
      store(res).createKitchen(actor(res), input.partnerId, input.name),
    ),
  );
  router.put(
    "/kitchen-members",
    body(c.memberInput, async (input, res) =>
      store(res).assignKitchen(actor(res), input.userId, input.kitchenId),
    ),
  );
  router.delete(
    "/kitchen-members",
    body(c.memberInput, async (input, res) =>
      store(res).assignKitchen(actor(res), input.userId, input.kitchenId, true),
    ),
  );
  router.post(
    "/menus",
    body(c.mealInput, async (input, res) => ({
      id: await store(res).saveMeal(actor(res), input),
    })),
  );
  router.put(
    "/menus/:id",
    body(c.mealUpdateInput, async (input, res, params) => {
      const { version, ...meal } = input;
      return {
        id: await store(res).saveMeal(
          actor(res),
          meal,
          mealId(params.id),
          version,
        ),
      };
    }),
  );
  router.post("/menus/:id/submit", async (req, res) => {
    await store(res).submitMeal(actor(res), mealId(req.params.id));
    res.status(204).end();
  });
  router.post(
    "/menus/:id/review",
    body(c.mealReviewInput, async (input, res, params) =>
      store(res).reviewMeal(
        actor(res),
        mealId(params.id),
        input.status,
        input.allergenVerified,
        input.dietaryVerified,
        input.version,
      ),
    ),
  );
  router.post(
    "/zones",
    body(c.zoneInput, async (input, res) =>
      store(res).createZone(actor(res), input),
    ),
  );
  router.post(
    "/slots",
    body(c.slotInput, async (input, res) =>
      store(res).createSlot(actor(res), input),
    ),
  );
  router.put(
    "/promotions",
    body(c.promoInput, async (input, res) =>
      store(res).savePromo(actor(res), input),
    ),
  );
  router.get("/customers", async (_req, res) =>
    res.json(await store(res).listCustomers(actor(res))),
  );
  router.put(
    "/customers/:id",
    body(c.accountAdminInput, async (input, res, params) =>
      store(res).manageCustomer(actor(res), id(params.id), input.disabled),
    ),
  );
  router.put(
    "/customers/:id/role",
    body(c.roleGrantInput, async (input, res, params) =>
      store(res).grantRole(
        actor(res),
        id(params.id),
        input.role,
        input.enabled,
      ),
    ),
  );
  router.put(
    "/slots/:id",
    body(c.slotUpdateInput, async (input, res, params) =>
      store(res).updateSlot(
        actor(res),
        id(params.id),
        input.capacity,
        input.enabled,
      ),
    ),
  );
  router.put(
    "/compensation",
    body(c.compensationInput, async (input, res) =>
      store(res).compensation(
        actor(res),
        input.kitchenId,
        input.perMealCents,
        input.reference,
      ),
    ),
  );
  router.get("/payables", async (_req, res) =>
    res.json(await store(res).payables(actor(res))),
  );
  router.post("/payables/:id/settle-test", async (req, res) => {
    await store(res).settleTestPayable(actor(res), id(req.params.id));
    res.status(204).end();
  });
  router.get("/leads", async (_req, res) =>
    res.json(await store(res).leads(actor(res))),
  );
  router.put(
    "/leads/:id",
    body(c.leadUpdateInput, async (input, res, params) =>
      store(res).updateLead(actor(res), id(params.id), input.status),
    ),
  );
  router.get("/plan-boxes", async (_req, res) =>
    res.json(await store(res).subscriptionBoxes(actor(res))),
  );
  router.post(
    "/plan-boxes",
    body(c.subscriptionBoxInput, async (input, res) => ({
      id: await store(res).saveSubscriptionBox(actor(res), input),
    })),
  );
  router.get("/billing-attention", async (_req, res) =>
    res.json(await store(res).billingAttention(actor(res))),
  );
  router.post("/billing-attention/:invoice/retry", async (req, res) => {
    if (!isAdmin(actor(res)))
      throw new DomainError(403, "Admin permission required.");
    const parsed = z
      .string()
      .regex(/^in_[a-zA-Z0-9_]+$/)
      .max(100)
      .safeParse(req.params.invoice);
    if (!parsed.success)
      throw new DomainError(400, "Invalid test invoice identifier.");
    res.json({
      orderId: await store(res).fulfillSubscriptionInvoice(parsed.data),
    });
  });
  router.get("/subscriptions", async (_req, res) =>
    res.json(await store(res).listSubscriptions(actor(res))),
  );
  router.post(
    "/subscriptions",
    body(c.subscriptionInput, async (input, res) =>
      subscriptionCheckout(store(res), actor(res), input.mealCount),
    ),
  );
  router.post("/subscriptions/:id/pay", async (req, res) => {
    const plan = await store(res).subscriptionForUser(
      actor(res),
      id(req.params.id),
    );
    res.json(
      await subscriptionCheckout(
        store(res),
        actor(res),
        plan.mealCount as 5 | 10 | 15,
        plan.id,
      ),
    );
  });
  router.post(
    "/subscriptions/:id/action",
    body(c.subscriptionActionInput, async (input, res, params) =>
      subscriptionAction(store(res), actor(res), id(params.id), input.action),
    ),
  );
  return router;
}
export function webhookHandler(
  options: OperationsOptions = {},
): RequestHandler {
  return async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string")
      throw new DomainError(400, "Missing webhook signature.");
    res.json(
      await processWebhook(
        await (options.operations ?? getOperations)(),
        req.body,
        signature,
      ),
    );
  };
}

export function leadHandler(options: OperationsOptions = {}): RequestHandler {
  return async (req, res) => {
    const input = c.leadInput.safeParse(req.body);
    if (!input.success)
      throw new DomainError(
        400,
        "Check your details and consent before submitting.",
      );
    const store = await (options.operations ?? getOperations)();
    const result = await store.createLead(input.data);
    res.status(201).json({
      id: result.id,
      message:
        "Received for review only. No service availability or partnership is promised.",
    });
  };
}
