import Stripe from "stripe";
import type { Actor, OperationsStore } from "./operations-store";
import { DomainError } from "./operations-store";
const objectId = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id;
export function testStripe() {
  const key = process.env.STRIPE_TEST_SECRET_KEY;
  if (!key?.startsWith("sk_test_"))
    throw new DomainError(
      503,
      "Stripe test mode is not configured. Live keys are never accepted.",
    );
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 10000 });
}
function returnOrigin() {
  const origin = process.env.PAYMENT_RETURN_ORIGIN;
  if (
    !origin ||
    !(process.env.APP_ORIGINS ?? "")
      .split(",")
      .map((v) => v.trim())
      .includes(origin)
  )
    throw new DomainError(503, "Configure an approved payment return origin.");
  const url = new URL(origin);
  if (url.origin !== origin || !["https:", "http:"].includes(url.protocol))
    throw new DomainError(503, "Invalid payment return origin.");
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new DomainError(
      503,
      "Payment returns require HTTPS outside local testing.",
    );
  return origin;
}
export function paymentReady() {
  testStripe();
  returnOrigin();
  if (!process.env.STRIPE_TEST_WEBHOOK_SECRET?.startsWith("whsec_"))
    throw new DomainError(
      503,
      "Configure signed Stripe test webhooks before opening checkout.",
    );
}
export async function orderPayment(
  store: OperationsStore,
  actor: Actor,
  id: string,
  stripe: Stripe = testStripe(),
) {
  const origin = returnOrigin();
  const order = await store.orderForPayment(actor, id);
  if (order.mode !== "stripe_test" || order.status !== "awaiting_payment")
    throw new DomainError(409, "This order is not awaiting a test payment.");
  if (order.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(
      order.stripeSessionId,
    );
    return { orderId: id, url: session.status === "open" ? session.url : null };
  }
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      success_url: `${origin}/activity?payment=returned`,
      cancel_url: `${origin}/activity?payment=canceled`,
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      metadata: { nomiloraOrderId: id },
      payment_intent_data: { metadata: { nomiloraOrderId: id } },
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: order.totalCents,
            product_data: {
              name: "Nomilora TEST order — no real food or delivery",
              description: `Test reference ${id}`,
            },
          },
          quantity: 1,
        },
      ],
    },
    { idempotencyKey: `nomilora-order-${id}` },
  );
  if (session.livemode || !session.url)
    throw new DomainError(
      503,
      "A valid Stripe test checkout was not returned.",
    );
  const saved = await store.setStripeSession(id, session.id);
  if (!saved) {
    await stripe.checkout.sessions.expire(session.id);
    throw new DomainError(
      409,
      "The order changed before checkout could start.",
    );
  }
  return { orderId: id, url: session.url };
}
export async function expireOrderPayment(
  store: OperationsStore,
  actor: Actor,
  id: string,
) {
  const order = await store.orderForPayment(actor, id);
  if (
    order.mode === "stripe_test" &&
    order.status === "awaiting_payment" &&
    order.stripeSessionId
  )
    await testStripe().checkout.sessions.expire(order.stripeSessionId);
}
export async function refundOrder(
  store: OperationsStore,
  actor: Actor,
  id: string,
) {
  const order = await store.orderForPayment(actor, id);
  if (
    order.mode !== "stripe_test" ||
    order.paymentStatus !== "paid" ||
    !order.stripePaymentIntentId
  )
    throw new DomainError(
      409,
      "Only a verified paid test order can be refunded.",
    );
  const refund = await testStripe().refunds.create(
    {
      payment_intent: order.stripePaymentIntentId,
      amount: order.totalCents,
      metadata: { nomiloraOrderId: id },
    },
    { idempotencyKey: `nomilora-full-refund-${id}` },
  );
  return {
    refundId: refund.id,
    status: refund.status,
    notice:
      "Test refund submitted. The order updates only after Stripe confirms the refund.",
  };
}
export async function subscriptionCheckout(
  store: OperationsStore,
  actor: Actor,
  count: 5 | 10 | 15,
  existingId?: string,
  stripe: Stripe = testStripe(),
) {
  paymentReady();
  const origin = returnOrigin();
  const plan = existingId
    ? await store.subscriptionForUser(actor, existingId)
    : await store.createSubscription(actor, count);
  if (plan.status !== "checkout_pending")
    throw new DomainError(409, "This test plan is not awaiting checkout.");
  if (plan.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(
      plan.stripeSessionId,
    );
    return { id: plan.id, url: session.status === "open" ? session.url : null };
  }
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        payment_method_types: ["card"],
        success_url: `${origin}/activity?subscription=returned`,
        cancel_url: `${origin}/activity?subscription=canceled`,
        metadata: { nomiloraSubscriptionId: plan.id },
        subscription_data: { metadata: { nomiloraSubscriptionId: plan.id } },
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: plan.weeklyPriceCents,
              recurring: { interval: "week" },
              product_data: {
                name: `Nomilora ${count}-meal TEST billing plan`,
                description:
                  "Test billing only. No real meals or deliveries are scheduled.",
              },
            },
            quantity: 1,
          },
        ],
      },
      { idempotencyKey: `nomilora-subscription-${plan.id}` },
    );
    if (session.livemode || !session.url)
      throw new Error("Invalid test session");
    await store.updateSubscription(plan.id, { stripeSessionId: session.id });
    return { id: plan.id, url: session.url };
  } catch (error) {
    // Never mark an ambiguous network response as canceled: Stripe may have created a session.
    throw new DomainError(
      503,
      `The test subscription checkout could not be opened. Check your pending plan before retrying.`,
    );
  }
}
export async function subscriptionAction(
  store: OperationsStore,
  actor: Actor,
  id: string,
  action: "pause" | "resume" | "skip" | "cancel",
  stripe: Stripe = testStripe(),
) {
  const plan = await store.subscriptionForUser(actor, id);
  if (plan.status === "canceled")
    throw new DomainError(409, "This test plan is already canceled.");
  if (!plan.stripeSubscriptionId) {
    if (action !== "cancel")
      throw new DomainError(
        409,
        "Finish test checkout before changing billing.",
      );
    if (plan.stripeSessionId)
      await testStripe().checkout.sessions.expire(plan.stripeSessionId);
    await store.updateSubscription(id, { status: "canceled" });
    return;
  }
  if (action === "cancel") {
    await stripe.subscriptions.cancel(
      plan.stripeSubscriptionId,
      {},
      { idempotencyKey: `nomilora-sub-cancel-${id}` },
    );
    await store.updateSubscription(id, {
      status: "canceled",
      skippedUntil: null,
    });
    return;
  }
  const current = await stripe.subscriptions.retrieve(
    plan.stripeSubscriptionId,
  );
  const periodEnd = current.items.data[0]?.current_period_end;
  if (action === "skip" && (!periodEnd || periodEnd * 1000 <= Date.now()))
    throw new DomainError(
      409,
      "The next billing boundary is not available yet.",
    );
  const resumeAt = action === "skip" ? periodEnd! + 3600 : undefined;
  const updated = await stripe.subscriptions.update(plan.stripeSubscriptionId, {
    pause_collection:
      action === "resume"
        ? ""
        : { behavior: "void", ...(resumeAt ? { resumes_at: resumeAt } : {}) },
  });
  await store.updateSubscription(id, {
    status: action === "resume" ? "active" : "paused",
    skippedUntil: resumeAt ? new Date(resumeAt * 1000) : null,
    nextBillingAt: new Date(updated.items.data[0].current_period_end * 1000),
  });
}
export async function processWebhook(
  store: OperationsStore,
  body: Buffer,
  signature: string,
  stripe: Stripe = testStripe(),
) {
  const secret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
  if (!secret?.startsWith("whsec_"))
    throw new DomainError(
      503,
      "Stripe test webhook verification is not configured.",
    );
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    throw new DomainError(400, "Invalid webhook signature.");
  }
  if (event.livemode)
    throw new DomainError(400, "Live payment events are disabled.");
  if (
    [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ].includes(event.type)
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.currency !== "usd")
      throw new DomainError(400, "Unexpected currency.");
    const paid =
      session.payment_status === "paid" &&
      [
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
      ].includes(event.type);
    const failed = [
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ].includes(event.type);
    const subscriptionId = objectId(session.subscription);
    if (session.metadata?.nomiloraSubscriptionId) {
      let subscriptionStatus: "active" | "paused" | "past_due" | "canceled" =
        failed ? "canceled" : "active";
      let nextBillingAt: Date | undefined;
      if (subscriptionId) {
        const current = await stripe.subscriptions.retrieve(subscriptionId);
        subscriptionStatus =
          current.status === "canceled"
            ? "canceled"
            : current.pause_collection
              ? "paused"
              : current.status === "active"
                ? "active"
                : "past_due";
        nextBillingAt = new Date(
          current.items.data[0].current_period_end * 1000,
        );
      }
      return store.paymentEvent({
        id: event.id,
        type: event.type,
        subscriptionRecordId: session.metadata.nomiloraSubscriptionId,
        subscriptionId,
        sessionId: session.id,
        amount: session.amount_total ?? undefined,
        subscriptionStatus,
        nextBillingAt,
      });
    }
    if (!session.metadata?.nomiloraOrderId) return { ignored: true };
    if (!paid && !failed) return { pending: true };
    return store.paymentEvent({
      id: event.id,
      type: event.type,
      orderId: session.metadata.nomiloraOrderId,
      sessionId: session.id,
      paymentIntentId: objectId(session.payment_intent),
      amount: session.amount_total ?? undefined,
      paid,
      failed,
    });
  }
  if (event.type === "invoice.paid") {
    const received = event.data.object as Stripe.Invoice;
    if (received.currency !== "usd")
      throw new DomainError(400, "Unexpected invoice currency.");
    const subscriptionRef = received.parent?.subscription_details;
    if (!subscriptionRef?.metadata?.nomiloraSubscriptionId)
      return { ignored: true };
    const invoice = await stripe.invoices.retrieve(received.id, {
      expand: ["payments.data.payment.payment_intent"],
    });
    if (
      invoice.livemode ||
      invoice.status !== "paid" ||
      invoice.currency !== "usd"
    )
      throw new DomainError(
        409,
        "Invoice payment is not verified in test mode.",
      );
    const period = invoice.lines.data.find((line) => line.amount > 0)?.period;
    if (!period)
      throw new DomainError(
        409,
        "A verified weekly invoice period is required.",
      );
    const payment = invoice.payments?.data.find(
      (payment) => payment.status === "paid",
    );
    const orderId = await store.recordSubscriptionInvoice({
      id: invoice.id,
      eventId: event.id,
      subscriptionRecordId: subscriptionRef.metadata.nomiloraSubscriptionId,
      stripeSubscriptionId: objectId(subscriptionRef.subscription)!,
      amountCents: invoice.amount_paid,
      periodStart: new Date(period.start * 1000),
      periodEnd: new Date(period.end * 1000),
      paymentIntentId:
        objectId(payment?.payment.payment_intent ?? null) ?? null,
    });
    return { orderId };
  }
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    if (!charge.refunded || charge.currency !== "usd") return { ignored: true };
    return store.paymentEvent({
      id: event.id,
      type: event.type,
      paymentIntentId: objectId(charge.payment_intent),
      amount: charge.amount_refunded,
      refund: true,
    });
  }
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const original = event.data.object as Stripe.Subscription;
    const current =
      event.type === "customer.subscription.deleted"
        ? original
        : await stripe.subscriptions.retrieve(original.id);
    return store.paymentEvent({
      id: event.id,
      type: event.type,
      subscriptionId: current.id,
      subscriptionRecordId: current.metadata.nomiloraSubscriptionId,
      subscriptionStatus:
        current.status === "canceled"
          ? "canceled"
          : current.pause_collection
            ? "paused"
            : current.status === "active"
              ? "active"
              : "past_due",
      nextBillingAt: current.items.data[0]
        ? new Date(current.items.data[0].current_period_end * 1000)
        : undefined,
      skippedUntil: current.pause_collection?.resumes_at
        ? new Date(current.pause_collection.resumes_at * 1000)
        : null,
    });
  }
  return { ignored: true };
}
