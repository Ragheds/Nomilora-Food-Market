import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useLocation } from "wouter";
import type {
  CatalogView,
  OrderView,
  PortalView,
  SubscriptionView,
  TicketView,
} from "@workspace/api-zod/operations";
import { useAuth, marketRequest } from "../lib/auth";
import type { useCustomerAccount } from "../lib/customer-account";
type Customer = ReturnType<typeof useCustomerAccount>;
const input =
  "mt-1 w-full rounded-xl border border-[#d8d3c6] bg-[#fffdf8] p-3 text-sm text-[#173b27]";
const button =
  "rounded-full bg-[#173b27] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40";
const secondary =
  "rounded-full border border-[#c9cdbd] px-4 py-2 text-sm font-semibold text-[#173b27] disabled:opacity-40";
const panel = "rounded-2xl border border-[#d8d3c6] bg-[#fbf9f3] p-5 sm:p-7";
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
const date = (s: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(s));
const label = (s: string) => s.replaceAll("_", " ");
function useData<T>(path: string) {
  const { session } = useAuth();
  const subject = session?.user.id;
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (
      !subject ||
      ![
        "/tickets",
        "/orders",
        "/subscriptions",
        "/notifications",
        "/portal",
      ].includes(path)
    )
      return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setVersion((v) => v + 1);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [subject, path]);
  useEffect(() => {
    if (!subject) return;
    let active = true;
    setLoading(true);
    setError("");
    void marketRequest(subject, path)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [subject, path, version]);
  return { data, error, loading, refresh, retry: refresh };
}
function useAction(refresh: () => void) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return {
    busy,
    error,
    message,
    run: async (path: string, method = "POST", body?: unknown) => {
      if (!session || busy) return;
      setBusy(true);
      setError("");
      setMessage("");
      try {
        const result = await marketRequest(session.user.id, path, method, body);
        setMessage(result?.notice ?? "Saved.");
        if (path.startsWith("/menus") || path.startsWith("/partners"))
          void queryClient.invalidateQueries({
            predicate: (query) =>
              typeof query.queryKey[0] === "string" &&
              query.queryKey[0].startsWith("/api/meals"),
          });
        refresh();
        return result;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "This change could not be saved.",
        );
        throw e;
      } finally {
        setBusy(false);
      }
    },
  };
}
function Feedback({
  state,
}: {
  state: { error: string; message?: string; retry?: () => void };
}) {
  return (
    <>
      {state.error && (
        <p
          role="alert"
          className="my-4 rounded-xl bg-[#faeee5] p-4 text-[#794d3a]"
        >
          {state.error}
          {state.retry && (
            <button onClick={state.retry} className="ml-3 underline">
              Retry
            </button>
          )}
        </p>
      )}
      {state.message && !state.error && (
        <p role="status" className="my-3 text-sm text-[#31513a]">
          {state.message}
        </p>
      )}
    </>
  );
}
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:px-10">
      <p className="eyebrow">Nomilora development preview</p>
      <h1 className="serif mt-2 text-4xl text-[#173b27]">{title}</h1>
      <p className="mt-4 rounded-xl bg-[#e9ecdf] p-4 text-sm text-[#31513a]">
        Test records only. No real payments, food preparation, deliveries or
        restaurant partnerships are activated here.
      </p>
      <nav
        aria-label="Account tools"
        className="my-6 flex flex-wrap gap-5 text-sm font-semibold text-[#a34d2c]"
      >
        {[
          ["/market", "Test market"],
          ["/activity", "Orders & plans"],
          ["/help", "Help & messages"],
          ["/notifications", "Notifications"],
          ["/workspace", "Staff workspace"],
          ["/account", "Account"],
        ].map(([href, text]) => (
          <Link key={href} href={href} className="underline">
            {text}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
export function OperationsGate({
  customer,
  children,
}: {
  customer: Customer;
  children: ReactNode;
}) {
  const { session } = useAuth();
  if (!session)
    return (
      <Frame title="Your Nomilora">
        <p>Sign in to use saved orders, support and account tools.</p>
        <Link href="/account" className={`${button} mt-5 inline-block`}>
          Sign in
        </Link>
      </Frame>
    );
  if (!customer.account)
    return (
      <Frame title="Loading your account">
        <p>{customer.loadError || "Loading saved account details…"}</p>
      </Frame>
    );
  return children;
}

export function TestMarket({ customer }: { customer: Customer }) {
  const [, navigate] = useLocation();
  const catalog = useData<CatalogView[]>("/catalog"),
    slots = useData<
      {
        id: string;
        kitchenId: string;
        startsAt: string;
        endsAt: string;
        cutoffAt: string;
        capacity: number;
        reserved: number;
        postalCodes: string[];
      }[]
    >("/slots"),
    config = useData<{ stripeTestConfigured: boolean }>("/config");
  const [addressId, setAddress] = useState(""),
    [slotId, setSlot] = useState(""),
    [mode, setMode] = useState<"simulation" | "stripe_test">("simulation"),
    [promoCode, setPromo] = useState(""),
    [ack, setAck] = useState(false);
  const key = useRef(crypto.randomUUID());
  const action = useAction(() => {});
  const account = customer.account!;
  const selectedAddress = account.addresses.find((a) => a.id === addressId);
  const available = (slots.data ?? []).filter(
    (s) =>
      Date.parse(s.cutoffAt) > Date.now() &&
      (!selectedAddress ||
        s.postalCodes.includes(selectedAddress.postalCode.slice(0, 5))),
  );
  const selectedSlot = available.find((s) => s.id === slotId);
  const [compatibleOnly, setCompatible] = useState(true);
  const restrictions = account.preferences;
  const styles: Record<string, string[]> = {
    Vegan: ["vegan"],
    Vegetarian: ["vegetarian", "vegan"],
    Pescatarian: ["pescatarian", "vegetarian", "vegan"],
    "Halal preference": ["halal"],
    "Kosher preference": ["kosher"],
    "Low Carb": ["low carb"],
    Keto: ["keto"],
    "Dairy avoidance": ["dairy free"],
    "Gluten avoidance": ["gluten free"],
  };
  const displayed = (catalog.data ?? []).filter(
    (meal) =>
      !compatibleOnly ||
      ((!restrictions.strictAllergens.length ||
        (meal.allergenVerified &&
          !/unknown/i.test(meal.crossContact) &&
          !restrictions.strictAllergens.some(
            (a) =>
              meal.allergens.includes(a) ||
              meal.crossContactAllergens.includes(a),
          ))) &&
        restrictions.eatingStyles.every(
          (style) =>
            !styles[style] ||
            (meal.dietaryVerified &&
              styles[style].some((tag) =>
                meal.dietaryTags
                  .map((t) =>
                    t
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, " ")
                      .trim(),
                  )
                  .includes(tag),
              )),
        )),
  );
  const lines = (catalog.data ?? []).filter((meal) => account.cart[meal.id]);
  const total = lines.reduce(
    (n, meal) => n + meal.priceCents * account.cart[meal.id],
    0,
  );
  const add = (id: string) => {
    const cart = {
      ...account.cart,
      [id]: Math.min(20, (account.cart[id] ?? 0) + 1),
    };
    customer.update((a) => ({ ...a, cart }), "/cart", "PUT", {
      items: Object.entries(cart).map(([mealId, quantity]) => ({
        mealId,
        quantity,
      })),
    });
  };
  const checkout = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await action.run("/orders", "POST", {
        addressId,
        slotId,
        mode,
        requestKey: key.current,
        ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}),
        acknowledgedTestOnly: true,
      });
      if (result?.url) window.location.assign(result.url);
      else if (result?.orderId) {
        customer.reload();
        navigate("/activity");
      }
    } catch {
      /* feedback retains the request key for a safe retry */
    }
  };
  return (
    <Frame title="Test market">
      <Feedback state={catalog} />
      <Feedback state={action} />
      {catalog.loading ? (
        <p>Loading the saved test catalog…</p>
      ) : !catalog.data?.length ? (
        <div className={panel}>
          <h2 className="serif text-2xl">No test menu is configured</h2>
          <p className="mt-3">
            The original illustrative preview remains available. An
            administrator must prepare a fictional test kitchen and catalog
            before saved test orders can be placed.
          </p>
          <Link href="/explore" className="mt-4 inline-block underline">
            Explore the preview
          </Link>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <section>
            <h2 className="serif mb-5 text-3xl">Illustrative test meals</h2>
            <label className="mb-5 flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={compatibleOnly}
                onChange={(e) => setCompatible(e.target.checked)}
              />
              Apply my saved allergy and dietary restrictions
            </label>
            {!displayed.length && (
              <p className="mb-5 text-sm">
                No verified matches for your saved restrictions. Unknown
                declarations are excluded.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {displayed.map((meal) => (
                <article key={meal.id} className={panel}>
                  <h3 className="serif text-2xl">{meal.name}</h3>
                  <p className="mt-2 text-sm">{meal.description}</p>
                  <p className="mt-3 text-xs">
                    {meal.allergenVerified
                      ? "Recorded allergen evidence available"
                      : "Allergen declarations unverified"}{" "}
                    · {meal.stock} test units
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <strong>{money(meal.priceCents)}</strong>
                    <button
                      disabled={meal.stock < 1 || action.busy}
                      onClick={() => add(meal.id)}
                      className={secondary}
                    >
                      Add{" "}
                      {account.cart[meal.id]
                        ? `(${account.cart[meal.id]})`
                        : ""}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <form onSubmit={checkout} className={`${panel} self-start space-y-5`}>
            <h2 className="serif text-3xl">Saved test basket</h2>
            {lines.map((meal) => (
              <div key={meal.id} className="flex justify-between gap-4 text-sm">
                <span>
                  {account.cart[meal.id]} × {meal.name}
                </span>
                <span>{money(meal.priceCents * account.cart[meal.id])}</span>
              </div>
            ))}
            <p className="font-semibold">Preview subtotal {money(total)}</p>
            <p className="text-xs">
              Final prices and promotions are checked on the server. Test tax
              and delivery fees are zero; this is not a live quote.
            </p>
            <label className="block text-sm font-semibold">
              Saved address
              <select
                required
                className={input}
                value={addressId}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setSlot("");
                  key.current = crypto.randomUUID();
                }}
              >
                <option value="">Choose an address</option>
                {account.addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} · {a.postalCode}
                  </option>
                ))}
              </select>
            </label>
            <Link href="/account" className="block text-sm underline">
              Manage saved addresses
            </Link>
            <label className="block text-sm font-semibold">
              Test preparation window
              <select
                required
                className={input}
                value={slotId}
                onChange={(e) => {
                  setSlot(e.target.value);
                  key.current = crypto.randomUUID();
                }}
              >
                <option value="">Choose a test window</option>
                {available.map((s) => (
                  <option key={s.id} value={s.id}>
                    {date(s.startsAt)} · {s.capacity - s.reserved} test units
                    available
                  </option>
                ))}
              </select>
            </label>
            {!available.length && (
              <p className="text-xs">
                No eligible test windows. No real delivery is available.
              </p>
            )}
            <label className="block text-sm font-semibold">
              Test promotion
              <input
                value={promoCode}
                maxLength={30}
                onChange={(e) => {
                  setPromo(e.target.value);
                  key.current = crypto.randomUUID();
                }}
                className={input}
              />
            </label>
            <label className="block text-sm font-semibold">
              Payment test
              <select
                className={input}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  key.current = crypto.randomUUID();
                }}
              >
                <option value="simulation">No-charge simulation</option>
                <option
                  value="stripe_test"
                  disabled={!config.data?.stripeTestConfigured}
                >
                  Stripe test payment
                  {!config.data?.stripeTestConfigured
                    ? " — not configured"
                    : ""}
                </option>
              </select>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input
                required
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-1"
              />
              I understand this creates a test record only. No real food or
              delivery will occur.
            </label>
            <button
              disabled={
                !ack ||
                !lines.length ||
                !selectedSlot ||
                customer.pending > 0 ||
                !!customer.error ||
                action.busy
              }
              className={button}
            >
              {action.busy
                ? "Recording test order…"
                : mode === "simulation"
                  ? "Record no-charge test order"
                  : "Continue to Stripe test checkout"}
            </button>
          </form>
        </div>
      )}
    </Frame>
  );
}

function OrderCard({
  order,
  staff,
  canPrepare,
  canDispatch,
  run,
  busy,
}: {
  order: OrderView;
  staff?: boolean;
  canPrepare?: boolean;
  canDispatch?: boolean;
  run: (path: string, method?: string, body?: unknown) => Promise<unknown>;
  busy: boolean;
}) {
  const allowed: Record<string, string[]> = {
    placed: ["confirmed", "canceled"],
    confirmed: ["preparing", "canceled"],
    preparing: ["ready"],
    ready: ["out_for_delivery"],
    out_for_delivery: ["delivered"],
  };
  return (
    <article className={panel}>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide">
            {order.mode === "simulation"
              ? "No-charge test record"
              : "Stripe test order"}
          </p>
          <h2 className="serif mt-1 break-all text-xl">{order.id}</h2>
          <p className="mt-2 text-sm">{date(order.createdAt)}</p>
        </div>
        <strong className="capitalize">{label(order.status)}</strong>
      </div>
      <ul className="my-5 space-y-2">
        {order.items.map((item) => (
          <li key={item.mealId} className="flex justify-between gap-3 text-sm">
            <span>
              {item.quantity} × {item.name}
            </span>
            <span>{money(item.quantity * item.unitPriceCents)}</span>
          </li>
        ))}
      </ul>
      <p className="font-semibold">
        Total {money(order.totalCents)} · Payment: {label(order.paymentStatus)}
      </p>
      {order.discountCents > 0 && (
        <p className="text-sm">Test promotion: −{money(order.discountCents)}</p>
      )}
      <p className="mt-2 text-sm">Test window: {date(order.slot.startsAt)}</p>
      <details className="mt-4">
        <summary className="cursor-pointer font-semibold">
          Status history
        </summary>
        <ol className="mt-3 space-y-3 text-sm">
          {order.events.map((event) => (
            <li key={event.id}>
              <strong className="capitalize">{label(event.status)}</strong> ·{" "}
              {date(event.createdAt)}
              <p>{event.note}</p>
            </li>
          ))}
        </ol>
      </details>
      <div className="mt-5 flex flex-wrap gap-3">
        {!staff &&
          ["awaiting_payment", "placed", "confirmed"].includes(order.status) &&
          order.paymentStatus !== "paid" && (
            <button
              disabled={busy}
              className={secondary}
              onClick={() =>
                void run(`/orders/${order.id}/transition`, "POST", {
                  status: "canceled",
                  note: "Customer canceled the test order.",
                }).catch(() => {})
              }
            >
              Cancel test order
            </button>
          )}
        {!staff &&
          order.mode === "stripe_test" &&
          order.status === "awaiting_payment" && (
            <button
              disabled={busy}
              className={button}
              onClick={() =>
                void run(`/orders/${order.id}/pay`)
                  .then((r: any) => {
                    if (r?.url) window.location.assign(r.url);
                  })
                  .catch(() => {})
              }
            >
              Resume test payment
            </button>
          )}
        {staff &&
          (allowed[order.status] ?? [])
            .filter(
              (status) =>
                canDispatch ||
                (canPrepare &&
                  ["confirmed", "preparing", "ready", "canceled"].includes(
                    status,
                  )),
            )
            .map((status) => (
              <button
                key={status}
                disabled={busy}
                className={secondary}
                onClick={() =>
                  void run(`/orders/${order.id}/transition`, "POST", {
                    status,
                    note: `Staff updated the test order to ${label(status)}.`,
                  }).catch(() => {})
                }
              >
                {label(status)}
              </button>
            ))}
        <Link
          href={`/help?order=${order.id}`}
          className="px-2 py-2 text-sm underline"
        >
          Get help
        </Link>
      </div>
    </article>
  );
}
export function Activity() {
  const orders = useData<OrderView[]>("/orders"),
    plans = useData<SubscriptionView[]>("/subscriptions");
  const refresh = () => {
    orders.refresh();
    plans.refresh();
  };
  const action = useAction(refresh);
  const [count, setCount] = useState(5),
    [consent, setConsent] = useState(false);
  const createPlan = async () => {
    try {
      const result = await action.run("/subscriptions", "POST", {
        mealCount: count,
        acknowledgedRecurringTestBilling: true,
      });
      if (result?.url) window.location.assign(result.url);
    } catch {}
  };
  return (
    <Frame title="Orders & plans">
      <Feedback state={orders} />
      <Feedback state={action} />
      <section className="space-y-4">
        <h2 className="serif text-3xl">Saved test orders</h2>
        <p className="text-sm">
          Only verified webhook events mark Stripe payments as paid. Returning
          from checkout is not proof of payment.
        </p>
        {orders.loading ? (
          <p>Loading orders…</p>
        ) : orders.data?.length ? (
          orders.data.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              run={action.run}
              busy={action.busy}
            />
          ))
        ) : (
          <p>
            No saved test orders yet.{" "}
            <Link href="/market" className="underline">
              Visit the test market
            </Link>
            .
          </p>
        )}
      </section>
      <section className={`${panel} mt-10`}>
        <h2 className="serif text-3xl">Weekly test billing</h2>
        <Link
          href="/boxes"
          className="mt-3 inline-block text-sm font-semibold underline"
        >
          Choose or edit saved weekly test boxes
        </Link>
        <p className="mt-3 text-sm">
          A 5, 10 or 15-meal billing plan at an illustrative $15 per meal each
          week. Stripe test mode only. This records a recurring billing
          agreement in Stripe's test environment; no actual meal selection, food
          preparation or delivery is scheduled.
        </p>
        <Feedback state={plans} />
        {plans.data?.map((plan) => (
          <article
            key={plan.id}
            className="mt-5 border-t border-[#d8d3c6] pt-5"
          >
            <h3 className="font-semibold">
              {plan.mealCount} meals · {money(plan.weeklyPriceCents)}/week ·{" "}
              {label(plan.status)}
            </h3>
            {plan.nextBillingAt && (
              <p className="mt-2 text-sm">
                Next test billing boundary: {date(plan.nextBillingAt)}
              </p>
            )}
            {plan.skippedUntil && (
              <p className="text-sm">
                Collection resumes after {date(plan.skippedUntil)}.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-3">
              {plan.status === "checkout_pending" && (
                <button
                  disabled={action.busy}
                  className={button}
                  onClick={() =>
                    void action
                      .run(`/subscriptions/${plan.id}/pay`)
                      .then((result: any) => {
                        if (result?.url) window.location.assign(result.url);
                      })
                      .catch(() => {})
                  }
                >
                  Resume test checkout
                </button>
              )}
              {plan.status !== "canceled" &&
                (plan.status === "checkout_pending"
                  ? ["cancel"]
                  : ["pause", "resume", "skip", "cancel"]
                ).map((what) => (
                  <button
                    disabled={action.busy}
                    key={what}
                    className={secondary}
                    onClick={() =>
                      void action
                        .run(`/subscriptions/${plan.id}/action`, "POST", {
                          action: what,
                        })
                        .catch(() => {})
                    }
                  >
                    {what === "skip"
                      ? "Skip next test bill"
                      : what === "cancel"
                        ? "Cancel immediately"
                        : `${what} test billing`}
                  </button>
                ))}
            </div>
          </article>
        ))}
        {!plans.data?.some((plan) => plan.status !== "canceled") && (
          <div className="mt-6 space-y-4">
            <label className="block text-sm font-semibold">
              Plan size
              <select
                className={input}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {[5, 10, 15].map((n) => (
                  <option key={n} value={n}>
                    {n} meals — {money(n * 1500)}/week
                  </option>
                ))}
              </select>
            </label>
            <label className="flex gap-3 text-sm">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I authorize recurring Stripe test billing only. Pause voids future
              test invoices until resumed; skip voids the next test invoice;
              cancellation is immediate. Previously paid test invoices are not
              automatically refunded.
            </label>
            <button
              className={button}
              disabled={!consent || action.busy}
              onClick={() => void createPlan()}
            >
              Open recurring test checkout
            </button>
          </div>
        )}
      </section>
    </Frame>
  );
}

function TicketThread({
  ticket,
  staff,
  run,
  busy,
  subject,
}: {
  ticket: TicketView;
  staff?: boolean;
  canPrepare?: boolean;
  canDispatch?: boolean;
  run: (path: string, method?: string, body?: unknown) => Promise<unknown>;
  busy: boolean;
  subject: string;
}) {
  const [body, setBody] = useState(""),
    [internal, setInternal] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await run(`/tickets/${ticket.id}/messages`, "POST", { body, internal });
      setBody("");
    } catch {}
  };
  return (
    <article className={panel}>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs uppercase">
            {label(ticket.category)}
            {ticket.category === "food_safety" ? " · Escalation" : ""}
          </p>
          <h3 className="serif mt-1 text-2xl">{ticket.subject}</h3>
          {ticket.orderId && (
            <p className="mt-2 break-all text-xs">Order {ticket.orderId}</p>
          )}
        </div>
        <span className="capitalize">{label(ticket.status)}</span>
      </div>
      <ol className="mt-5 space-y-4">
        {ticket.messages.map((message) => (
          <li
            key={message.id}
            className={`rounded-xl p-4 ${message.internal ? "border border-[#bc7155] bg-[#faeee5]" : "bg-[#e9ecdf]"}`}
          >
            <p className="mb-2 text-xs font-semibold">
              {message.authorId === subject ? "You" : "Account participant"}
              {message.internal ? " · Internal staff note" : ""} ·{" "}
              {date(message.createdAt)}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.body}
            </p>
          </li>
        ))}
      </ol>
      {ticket.status !== "resolved" ? (
        <form onSubmit={submit} className="mt-5 space-y-3">
          <label className="block text-sm font-semibold">
            Message
            <textarea
              required
              minLength={1}
              maxLength={4000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={input}
            />
          </label>
          {staff && (
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
              />
              Internal staff note (hidden from customer)
            </label>
          )}
          <button disabled={busy || !body.trim()} className={button}>
            Send message
          </button>
        </form>
      ) : (
        <button
          className={`${secondary} mt-5`}
          disabled={busy}
          onClick={() =>
            void run(`/tickets/${ticket.id}`, "PUT", {
              status: "open",
              assignToMe: false,
            }).catch(() => {})
          }
        >
          Reopen ticket
        </button>
      )}
      {staff && (
        <div className="mt-4 flex flex-wrap gap-3">
          {["open", "in_progress", "resolved"].map((status) => (
            <button
              key={status}
              disabled={busy}
              className={secondary}
              onClick={() =>
                void run(`/tickets/${ticket.id}`, "PUT", {
                  status,
                  assignToMe: true,
                }).catch(() => {})
              }
            >
              {status === "in_progress" ? "Assign to me" : label(status)}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
export function Help({ customer }: { customer: Customer }) {
  const tickets = useData<TicketView[]>("/tickets");
  const action = useAction(tickets.refresh);
  const [subject, setSubject] = useState(""),
    [category, setCategory] = useState("general"),
    [body, setBody] = useState("");
  const [orderId, setOrder] = useState(
    new URLSearchParams(location.search).get("order") ?? "",
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await action.run("/tickets", "POST", {
        subject,
        category,
        body,
        ...(orderId ? { orderId } : {}),
      });
      setSubject("");
      setBody("");
      setOrder("");
    } catch {}
  };
  return (
    <Frame title="Help & messages">
      <p className="mb-5 text-sm">
        Messages are saved in your account. An assigned human support team and
        response-time commitment are not yet configured. For an urgent
        food-safety concern, do not rely on this preview as an emergency
        channel.
      </p>
      <Feedback state={tickets} />
      <Feedback state={action} />
      <form onSubmit={submit} className={`${panel} mb-8 space-y-4`}>
        <h2 className="serif text-2xl">Open a support ticket</h2>
        <label className="block text-sm font-semibold">
          Subject
          <input
            required
            minLength={3}
            maxLength={160}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={input}
          />
        </label>
        <label className="block text-sm font-semibold">
          Topic
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={input}
          >
            {["general", "order", "refund", "food_safety"].map((v) => (
              <option key={v} value={v}>
                {label(v)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Order reference (optional)
          <input
            value={orderId}
            onChange={(e) => setOrder(e.target.value)}
            className={input}
          />
        </label>
        <label className="block text-sm font-semibold">
          Message
          <textarea
            required
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={input}
          />
        </label>
        <button disabled={action.busy} className={button}>
          Create ticket
        </button>
      </form>
      <section className="space-y-5">
        {tickets.data?.map((ticket) => (
          <TicketThread
            key={ticket.id}
            ticket={ticket}
            run={action.run}
            busy={action.busy}
            subject={customer.account!.id}
          />
        ))}
      </section>
    </Frame>
  );
}
export function Notifications() {
  const data = useData<
    {
      id: string;
      title: string;
      body: string;
      href: string;
      readAt: string | null;
      createdAt: string;
    }[]
  >("/notifications");
  const action = useAction(data.refresh);
  return (
    <Frame title="Notifications">
      <Feedback state={data} />
      <Feedback state={action} />
      <div className="space-y-4">
        {data.data?.length ? (
          data.data.map((item) => (
            <article key={item.id} className={panel}>
              <p className="text-xs">
                {date(item.createdAt)} · {item.readAt ? "Read" : "Unread"}
              </p>
              <h2 className="serif mt-2 text-2xl">{item.title}</h2>
              <p className="mt-2 text-sm">{item.body}</p>
              <div className="mt-4 flex gap-4">
                <Link href={item.href} className="text-sm underline">
                  Open
                </Link>
                {!item.readAt && (
                  <button
                    disabled={action.busy}
                    className="text-sm underline"
                    onClick={() =>
                      void action
                        .run(`/notifications/${item.id}/read`, "PUT")
                        .catch(() => {})
                    }
                  >
                    Mark read
                  </button>
                )}
              </div>
            </article>
          ))
        ) : (
          <p>
            {data.loading ? "Loading notifications…" : "No notifications yet."}
          </p>
        )}
      </div>
    </Frame>
  );
}

export function Workspace({ customer }: { customer: Customer }) {
  const data = useData<PortalView>("/portal");
  const action = useAction(data.refresh);
  const account = customer.account!;
  const admin = account.roles.some(
      (r) => r === "founder_admin" || r === "operations_admin",
    ),
    support = admin || account.roles.includes("support_agent");
  const [tab, setTab] = useState("overview");
  return (
    <Frame title="Staff workspace">
      <Feedback state={data} />
      <Feedback state={action} />
      {data.loading && !data.data ? (
        <p>Loading authorized workspace…</p>
      ) : (
        data.data && (
          <>
            <div className="mb-6 flex flex-wrap gap-3">
              {[
                "overview",
                "orders",
                ...(data.data.kitchens.length ? ["menus", "scheduling"] : []),
                ...(support ? ["support", "billing exceptions"] : []),
                ...(data.data.kitchens.length ? ["accounting"] : []),
                ...(admin
                  ? [
                      "partners",
                      "promotions",
                      "customers",
                      "inquiries",
                      "audit",
                    ]
                  : []),
              ].map((name) => (
                <button
                  key={name}
                  className={tab === name ? button : secondary}
                  onClick={() => setTab(name)}
                >
                  {label(name)}
                </button>
              ))}
            </div>
            {tab === "overview" && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Recent test orders", String(data.data.metrics.testOrders)],
                  [
                    "Paid test sales",
                    money(data.data.metrics.paidTestSalesCents),
                  ],
                  [
                    "Refunded test orders",
                    String(data.data.metrics.refundedTestOrders),
                  ],
                  [
                    "Open support tickets",
                    String(data.data.metrics.openTickets),
                  ],
                ].map(([name, value]) => (
                  <div key={name} className={panel}>
                    <p className="text-sm">{name}</p>
                    <p className="serif mt-2 text-4xl">{value}</p>
                  </div>
                ))}
                <p className="col-span-full text-xs">
                  Recent records only (up to 100 orders/tickets). Test sales are
                  not profit. Customer contact details and saved addresses are
                  excluded from partner views.
                </p>
              </div>
            )}
            {tab === "orders" && (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-3">
                  <button
                    className={secondary}
                    onClick={() => downloadPreparation(data.data!.orders)}
                  >
                    Download test preparation CSV
                  </button>
                  <button className={secondary} onClick={() => window.print()}>
                    Print preparation view
                  </button>
                </div>
                {!data.data.orders.length && (
                  <p>No test orders are assigned to this workspace.</p>
                )}
                {data.data.orders.map((order) => (
                  <div key={order.id}>
                    <OrderCard
                      order={order}
                      staff
                      canPrepare={
                        admin ||
                        account.roles.includes("restaurant_employee") ||
                        account.roles.includes("restaurant_manager")
                      }
                      canDispatch={admin}
                      busy={action.busy}
                      run={action.run}
                    />
                    {admin && order.paymentStatus === "paid" && (
                      <button
                        className={`${secondary} mt-3`}
                        disabled={action.busy}
                        onClick={() =>
                          void action
                            .run(`/orders/${order.id}/refund`)
                            .catch(() => {})
                        }
                      >
                        Submit full Stripe test refund
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {tab === "billing exceptions" && (
              <BillingAttention
                run={action.run}
                busy={action.busy}
                admin={admin}
              />
            )}
            {tab === "support" && (
              <div className="space-y-5">
                {!data.data.tickets.length && <p>No support tickets yet.</p>}
                {data.data.tickets.map((ticket) => (
                  <TicketThread
                    key={ticket.id}
                    ticket={ticket}
                    staff
                    run={action.run}
                    busy={action.busy}
                    subject={account.id}
                  />
                ))}
              </div>
            )}
            {tab === "menus" && (
              <Menus
                portal={data.data}
                admin={admin}
                run={action.run}
                busy={action.busy}
              />
            )}
            {tab === "partners" && (
              <Partners
                portal={data.data}
                run={action.run}
                busy={action.busy}
              />
            )}
            {tab === "scheduling" && (
              <Scheduling
                portal={data.data}
                run={action.run}
                busy={action.busy}
                admin={admin}
              />
            )}
            {tab === "promotions" && (
              <Promotions
                portal={data.data}
                run={action.run}
                busy={action.busy}
              />
            )}
            {tab === "customers" && (
              <CustomerManagement
                run={action.run}
                busy={action.busy}
                founder={account.roles.includes("founder_admin")}
              />
            )}
            {tab === "inquiries" && (
              <Leads run={action.run} busy={action.busy} />
            )}
            {tab === "accounting" && (
              <Accounting
                portal={data.data}
                run={action.run}
                busy={action.busy}
                admin={admin}
              />
            )}
            {tab === "audit" && (
              <section className={panel}>
                <h2 className="serif text-2xl">Latest audit events</h2>
                <ul className="mt-5 space-y-3 text-sm">
                  {data.data.audit.map((event) => (
                    <li key={event.id}>
                      {date(event.createdAt)} · {event.action}
                      <p className="break-all text-xs">
                        Reference {event.entityId}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )
      )}
    </Frame>
  );
}
type Run = (path: string, method?: string, body?: unknown) => Promise<any>;
function Menus({
  portal,
  admin,
  run,
  busy,
}: {
  portal: PortalView;
  admin: boolean;
  run: Run;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<CatalogView>();
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [kitchenId, setKitchen] = useState(portal.kitchens[0]?.id ?? ""),
    [price, setPrice] = useState("15.00"),
    [stock, setStock] = useState(0),
    [ingredients, setIngredients] = useState(""),
    [allergens, setAllergens] = useState(""),
    [tags, setTags] = useState(""),
    [crossContact, setCrossContact] = useState("Unknown"),
    [crossAllergens, setCrossAllergens] = useState(""),
    [evidence, setEvidence] = useState("");
  const [verified, setVerified] = useState<
    Record<string, { allergen: boolean; dietary: boolean }>
  >({});
  const edit = (meal: CatalogView) => {
    setEditing(meal);
    setName(meal.name);
    setDescription(meal.description);
    setKitchen(meal.kitchenId);
    setPrice((meal.priceCents / 100).toFixed(2));
    setStock(meal.stock);
    setIngredients(meal.ingredients.join(", "));
    setAllergens(meal.allergens.join(", "));
    setTags(meal.dietaryTags.join(", "));
    setCrossContact(meal.crossContact);
    setCrossAllergens(meal.crossContactAllergens.join(", "));
    setEvidence(meal.evidence);
  };
  const reset = () => {
    setEditing(undefined);
    setName("");
    setDescription("");
    setIngredients("");
    setAllergens("");
    setTags("");
    setEvidence("");
    setCrossContact("Unknown");
  };
  const list = (s: string) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await run(
        editing ? `/menus/${editing.id}` : "/menus",
        editing ? "PUT" : "POST",
        {
          kitchenId,
          name,
          description,
          priceCents: Math.round(Number(price) * 100),
          stock,
          ingredients: list(ingredients),
          allergens: list(allergens),
          dietaryTags: list(tags),
          crossContactAllergens: list(crossAllergens),
          crossContact,
          evidence,
          ...(editing ? { version: editing.version } : {}),
        },
      );
      reset();
    } catch {}
  };
  return (
    <div className="space-y-6">
      <form onSubmit={submit} className={`${panel} space-y-4`}>
        <h2 className="serif text-3xl">
          {editing ? "Edit private draft" : "Propose a private menu item"}
        </h2>
        <p className="text-sm">
          New items are private. Every edit removes approval and verification.
          An administrator must review evidence and approve the new version.
          Real partner menus remain unpublished.
        </p>
        <label className="block text-sm font-semibold">
          Kitchen
          <select
            required
            disabled={!!editing}
            value={kitchenId}
            onChange={(e) => setKitchen(e.target.value)}
            className={input}
          >
            {portal.kitchens.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Meal name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
          />
        </label>
        <label className="block text-sm font-semibold">
          Description
          <textarea
            required
            minLength={3}
            maxLength={1000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={input}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Price in dollars
            <input
              required
              type="number"
              min="1"
              max="1000"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={input}
            />
          </label>
          <label className="block text-sm font-semibold">
            Available test units
            <input
              required
              type="number"
              min="0"
              max="10000"
              value={stock}
              onChange={(e) => setStock(Number(e.target.value))}
              className={input}
            />
          </label>
        </div>
        {(
          [
            ["Ingredients", ingredients, setIngredients],
            [
              "Major allergens (comma-separated, exact names)",
              allergens,
              setAllergens,
            ],
            ["Dietary tags", tags, setTags],
            ["Cross-contact allergens", crossAllergens, setCrossAllergens],
            ["Cross-contact information", crossContact, setCrossContact],
            ["Verification evidence / reference", evidence, setEvidence],
          ] as const
        ).map(([title, value, setter]) => (
          <label key={title} className="block text-sm font-semibold">
            {title}
            <textarea
              value={value}
              onChange={(e) => setter(e.target.value)}
              className={input}
              required={
                title === "Ingredients" || title === "Cross-contact information"
              }
              maxLength={2000}
            />
          </label>
        ))}
        <p className="text-xs">
          Major allergens: Milk, Egg, Fish, Crustacean shellfish, Tree nuts,
          Peanuts, Wheat, Soy, Sesame. Blank allergen lists are not interpreted
          as verified safety.
        </p>
        <div className="flex gap-3">
          <button disabled={busy} className={button}>
            Save private draft
          </button>
          {editing && (
            <button type="button" className={secondary} onClick={reset}>
              Cancel edit
            </button>
          )}
        </div>
      </form>
      <section className="space-y-4">
        {portal.menus.map((meal) => (
          <article key={meal.id} className={panel}>
            <div className="flex flex-wrap justify-between gap-3">
              <h3 className="serif text-2xl">{meal.name}</h3>
              <span className="capitalize">
                {meal.status} · Version {meal.version}
              </span>
            </div>
            <p className="mt-2 text-sm">
              {money(meal.priceCents)} · {meal.stock} units
            </p>
            <p className="mt-3 text-sm">
              Ingredients: {meal.ingredients.join(", ")}
            </p>
            <p className="mt-1 text-sm">
              Allergens: {meal.allergens.join(", ") || "Not declared"} ·{" "}
              {meal.allergenVerified ? "Evidence recorded" : "Unverified"}
            </p>
            <p className="mt-1 text-sm">Cross-contact: {meal.crossContact}</p>
            <p className="mt-1 text-sm">
              Evidence: {meal.evidence || "Not provided"}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                disabled={busy}
                className={secondary}
                onClick={() => edit(meal)}
              >
                Edit as draft
              </button>
              {meal.status === "draft" && (
                <button
                  disabled={busy}
                  className={button}
                  onClick={() =>
                    void run(`/menus/${meal.id}/submit`).catch(() => {})
                  }
                >
                  Submit for review
                </button>
              )}
              {admin && meal.status === "submitted" && (
                <>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={verified[meal.id]?.allergen ?? false}
                      onChange={(e) =>
                        setVerified((v) => ({
                          ...v,
                          [meal.id]: {
                            allergen: e.target.checked,
                            dietary: v[meal.id]?.dietary ?? false,
                          },
                        }))
                      }
                    />
                    I reviewed allergen and cross-contact evidence
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={verified[meal.id]?.dietary ?? false}
                      onChange={(e) =>
                        setVerified((v) => ({
                          ...v,
                          [meal.id]: {
                            allergen: v[meal.id]?.allergen ?? false,
                            dietary: e.target.checked,
                          },
                        }))
                      }
                    />
                    I reviewed dietary evidence
                  </label>
                  <button
                    disabled={busy}
                    className={button}
                    onClick={() =>
                      void run(`/menus/${meal.id}/review`, "POST", {
                        status: "approved",
                        allergenVerified: verified[meal.id]?.allergen ?? false,
                        dietaryVerified: verified[meal.id]?.dietary ?? false,
                        version: meal.version,
                      }).catch(() => {})
                    }
                  >
                    Approve version
                  </button>
                </>
              )}
              {admin && meal.status !== "hidden" && (
                <button
                  disabled={busy}
                  className={secondary}
                  onClick={() =>
                    void run(`/menus/${meal.id}/review`, "POST", {
                      status: "hidden",
                      allergenVerified: false,
                      dietaryVerified: false,
                      version: meal.version,
                    }).catch(() => {})
                  }
                >
                  Hide item
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
function Partners({
  portal,
  run,
  busy,
}: {
  portal: PortalView;
  run: Run;
  busy: boolean;
}) {
  const [name, setName] = useState(""),
    [partnerId, setPartner] = useState(portal.partners[0]?.id ?? ""),
    [kitchenName, setKitchen] = useState(""),
    [memberId, setMember] = useState(""),
    [memberKitchen, setMemberKitchen] = useState(portal.kitchens[0]?.id ?? "");
  return (
    <div className="space-y-6">
      <form
        className={`${panel} space-y-4`}
        onSubmit={(e) => {
          e.preventDefault();
          void run("/partners", "POST", { name })
            .then(() => setName(""))
            .catch(() => {});
        }}
      >
        <h2 className="serif text-2xl">Private prospective partner</h2>
        <label className="block text-sm font-semibold">
          Restaurant name
          <input
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
          />
        </label>
        <button disabled={busy} className={button}>
          Save as unapproved prospect
        </button>
      </form>
      <div className="space-y-4">
        {portal.partners.map((partner) => (
          <article key={partner.id} className={panel}>
            <h3 className="serif text-2xl">{partner.name}</h3>
            <p className="mt-2 text-sm">
              {label(partner.status)} ·{" "}
              {partner.testOnly
                ? "Fictional test fixture"
                : "Private real-world prospect — not publicly listed"}{" "}
              · Agreement{" "}
              {partner.agreementConfirmed ? "recorded" : "not confirmed"}
            </p>
            <div className="mt-3 flex gap-3">
              <button
                disabled={busy}
                className={secondary}
                onClick={() =>
                  void run(`/partners/${partner.id}`, "PUT", {
                    status: "review",
                    agreementConfirmed: partner.agreementConfirmed,
                  }).catch(() => {})
                }
              >
                Mark in review
              </button>
              <button
                disabled={busy}
                className={secondary}
                onClick={() =>
                  void run(`/partners/${partner.id}`, "PUT", {
                    status: "suspended",
                    agreementConfirmed: partner.agreementConfirmed,
                  }).catch(() => {})
                }
              >
                Suspend
              </button>
            </div>
            <button
              disabled={busy}
              className={`${secondary} mt-3`}
              onClick={() =>
                void run(`/partners/${partner.id}`, "PUT", {
                  status: "approved",
                  agreementConfirmed: true,
                }).catch(() => {})
              }
            >
              Record verified agreement and approve privately
            </button>
            <p className="mt-3 text-xs">
              Use approval only after independently verifying the signed
              agreement. Agreement verification and approval require founder
              review; this preview cannot publish real partner menus.
            </p>
          </article>
        ))}
      </div>
      <form
        className={`${panel} space-y-4`}
        onSubmit={(e) => {
          e.preventDefault();
          void run("/kitchens", "POST", { partnerId, name: kitchenName })
            .then(() => setKitchen(""))
            .catch(() => {});
        }}
      >
        <h2 className="serif text-2xl">Add a private kitchen</h2>
        <label className="block text-sm">
          Partner
          <select
            required
            value={partnerId}
            onChange={(e) => setPartner(e.target.value)}
            className={input}
          >
            <option value="">Choose</option>
            {portal.partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Kitchen name
          <input
            required
            value={kitchenName}
            onChange={(e) => setKitchen(e.target.value)}
            className={input}
          />
        </label>
        <button disabled={busy} className={button}>
          Create kitchen
        </button>
      </form>
      <form
        className={`${panel} space-y-4`}
        onSubmit={(e) => {
          e.preventDefault();
          void run("/kitchen-members", "PUT", {
            userId: memberId,
            kitchenId: memberKitchen,
          }).catch(() => {});
        }}
      >
        <h2 className="serif text-2xl">Assign restaurant access</h2>
        <p className="text-sm">
          Only an existing user with a trusted restaurant role can be assigned.
          Assignment grants access to this kitchen only.
        </p>
        <label className="block text-sm">
          Restaurant user account ID
          <input
            required
            value={memberId}
            onChange={(e) => setMember(e.target.value)}
            className={input}
          />
        </label>
        <label className="block text-sm">
          Kitchen
          <select
            required
            value={memberKitchen}
            onChange={(e) => setMemberKitchen(e.target.value)}
            className={input}
          >
            {portal.kitchens.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-3">
          <button disabled={busy} className={button}>
            Assign kitchen
          </button>
          <button
            type="button"
            disabled={busy || !memberId || !memberKitchen}
            className={secondary}
            onClick={() =>
              void run("/kitchen-members", "DELETE", {
                userId: memberId,
                kitchenId: memberKitchen,
              }).catch(() => {})
            }
          >
            Remove assignment
          </button>
        </div>
      </form>
    </div>
  );
}
function Scheduling({
  portal,
  run,
  busy,
  admin,
}: {
  portal: PortalView;
  run: Run;
  busy: boolean;
  admin: boolean;
}) {
  const [name, setName] = useState(""),
    [postal, setPostal] = useState("11101"),
    [zoneId, setZone] = useState(portal.zones[0]?.id ?? ""),
    [kitchenId, setKitchen] = useState(portal.kitchens[0]?.id ?? ""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [cutoff, setCutoff] = useState(""),
    [capacity, setCapacity] = useState(50);
  return (
    <div className="space-y-6">
      <p className="text-sm">
        Scheduling is a test foundation. ZIP coverage is not street-level
        address verification. No real dispatch or courier tracking is connected.
      </p>
      {admin && (
        <>
          <form
            className={`${panel} space-y-4`}
            onSubmit={(e) => {
              e.preventDefault();
              void run("/zones", "POST", {
                name,
                postalCodes: postal
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
                enabled: true,
                testOnly: true,
              }).catch(() => {});
            }}
          >
            <h2 className="serif text-2xl">Test service area</h2>
            <label className="block text-sm">
              Name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={input}
              />
            </label>
            <label className="block text-sm">
              ZIP codes, separated by commas
              <input
                required
                value={postal}
                onChange={(e) => setPostal(e.target.value)}
                className={input}
              />
            </label>
            <button disabled={busy} className={button}>
              Create test zone
            </button>
          </form>
          <form
            className={`${panel} space-y-4`}
            onSubmit={(e) => {
              e.preventDefault();
              void run("/slots", "POST", {
                zoneId,
                kitchenId,
                startsAt: new Date(start).toISOString(),
                endsAt: new Date(end).toISOString(),
                cutoffAt: new Date(cutoff).toISOString(),
                capacity,
                enabled: true,
              }).catch(() => {});
            }}
          >
            <h2 className="serif text-2xl">Test preparation window</h2>
            <label className="block text-sm">
              Kitchen
              <select
                required
                value={kitchenId}
                onChange={(e) => setKitchen(e.target.value)}
                className={input}
              >
                {portal.kitchens.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Test zone
              <select
                required
                value={zoneId}
                onChange={(e) => setZone(e.target.value)}
                className={input}
              >
                {portal.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs">
              Enter dates in your browser's local time. Saved times display in
              New York time.
            </p>
            {(
              [
                ["Cutoff", cutoff, setCutoff],
                ["Start", start, setStart],
                ["End", end, setEnd],
              ] as const
            ).map(([title, value, setter]) => (
              <label key={title} className="block text-sm">
                {title}
                <input
                  required
                  type="datetime-local"
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  className={input}
                />
              </label>
            ))}
            <label className="block text-sm">
              Meal-unit capacity
              <input
                required
                type="number"
                min="1"
                max="10000"
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className={input}
              />
            </label>
            <button disabled={busy} className={button}>
              Create test window
            </button>
          </form>
        </>
      )}
      <section className={panel}>
        <h2 className="serif text-2xl">Configured windows</h2>
        <ul className="mt-4 space-y-4">
          {portal.slots.map((slot) => (
            <li key={slot.id} className="text-sm">
              {date(slot.startsAt)} – {date(slot.endsAt)}
              <p>
                Cutoff {date(slot.cutoffAt)} · {slot.reserved}/{slot.capacity}{" "}
                meal units reserved ·{" "}
                {slot.enabled ? "Enabled for testing" : "Blocked"}
              </p>
              <button
                disabled={busy}
                className={`${secondary} mt-2`}
                onClick={() =>
                  void run(`/slots/${slot.id}`, "PUT", {
                    capacity: slot.capacity,
                    enabled: !slot.enabled,
                  }).catch(() => {})
                }
              >
                {slot.enabled ? "Block window" : "Re-enable test window"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
function Promotions({
  portal,
  run,
  busy,
}: {
  portal: PortalView;
  run: Run;
  busy: boolean;
}) {
  const [code, setCode] = useState(""),
    [percent, setPercent] = useState(10),
    [maxUses, setMax] = useState(100),
    [expiry, setExpiry] = useState("");
  return (
    <div className="space-y-5">
      <form
        className={`${panel} space-y-4`}
        onSubmit={(e) => {
          e.preventDefault();
          void run("/promotions", "PUT", {
            code,
            percent,
            maxUses,
            expiresAt: new Date(expiry).toISOString(),
            enabled: true,
          }).catch(() => {});
        }}
      >
        <h2 className="serif text-2xl">Test promotion</h2>
        <label className="block text-sm">
          Code
          <input
            required
            pattern="[A-Za-z0-9-]{3,30}"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className={input}
          />
        </label>
        <label className="block text-sm">
          Discount percent
          <input
            required
            type="number"
            min="1"
            max="50"
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            className={input}
          />
        </label>
        <label className="block text-sm">
          Maximum redemptions
          <input
            required
            type="number"
            min="1"
            max="100000"
            value={maxUses}
            onChange={(e) => setMax(Number(e.target.value))}
            className={input}
          />
        </label>
        <label className="block text-sm">
          Expiry (browser local time)
          <input
            required
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className={input}
          />
        </label>
        <button disabled={busy} className={button}>
          Save test promotion
        </button>
      </form>
      {portal.promotions.map((p) => (
        <article key={p.code} className={panel}>
          <h3 className="font-semibold">
            {p.code} · {p.percent}%
          </h3>
          <p className="mt-2 text-sm">
            {p.uses}/{p.maxUses} uses · Expires {date(p.expiresAt)} ·{" "}
            {p.enabled ? "Enabled" : "Disabled"}
          </p>
          <button
            disabled={busy}
            className={`${secondary} mt-3`}
            onClick={() =>
              void run("/promotions", "PUT", {
                code: p.code,
                percent: p.percent,
                maxUses: p.maxUses,
                expiresAt: p.expiresAt,
                enabled: !p.enabled,
              }).catch(() => {})
            }
          >
            {p.enabled ? "Disable" : "Enable"}
          </button>
        </article>
      ))}
    </div>
  );
}
function CustomerManagement({
  run,
  busy,
  founder,
}: {
  run: Run;
  busy: boolean;
  founder: boolean;
}) {
  const data = useData<
    {
      id: string;
      email: string | null;
      displayName: string | null;
      disabledAt: string | null;
      roles: string[];
    }[]
  >("/customers");
  const [selected, setSelected] = useState(""),
    [role, setRole] = useState("support_agent");
  const act = async (path: string, body: unknown) => {
    try {
      await run(path, "PUT", body);
      data.refresh();
    } catch {}
  };
  return (
    <section className="space-y-5">
      <Feedback state={data} />
      <h2 className="serif text-3xl">Recent customer accounts</h2>
      {data.data?.map((user) => (
        <article key={user.id} className={panel}>
          <h3 className="font-semibold">
            {user.displayName || user.email || "Account"}
          </h3>
          <p className="mt-2 break-all text-xs">Account ID {user.id}</p>
          <p className="mt-2 text-sm">
            Roles: {user.roles.join(", ")} ·{" "}
            {user.disabledAt ? "Disabled" : "Active"}
          </p>
          <button
            disabled={busy}
            className={`${secondary} mt-3`}
            onClick={() =>
              void act(`/customers/${user.id}`, { disabled: !user.disabledAt })
            }
          >
            {user.disabledAt ? "Restore access" : "Disable account access"}
          </button>
        </article>
      ))}
      {founder && (
        <form
          className={`${panel} space-y-4`}
          onSubmit={(e) => {
            e.preventDefault();
            void act(`/customers/${selected}/role`, { role, enabled: true });
          }}
        >
          <h3 className="serif text-2xl">Founder role management</h3>
          <p className="text-sm">
            Grant privileges only to a verified staff identity. Self-service
            role changes are blocked. Every grant and revocation is audited.
          </p>
          <label className="block text-sm">
            Account
            <select
              required
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className={input}
            >
              <option value="">Select a verified account</option>
              {data.data?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.email || user.id}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={input}
            >
              {[
                "restaurant_employee",
                "restaurant_manager",
                "support_agent",
                "operations_admin",
                "founder_admin",
              ].map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-3">
            <button disabled={busy || !selected} className={button}>
              Grant selected role
            </button>
            <button
              type="button"
              disabled={busy || !selected}
              className={secondary}
              onClick={() =>
                void act(`/customers/${selected}/role`, {
                  role,
                  enabled: false,
                })
              }
            >
              Revoke selected role
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
function Leads({ run, busy }: { run: Run; busy: boolean }) {
  const data = useData<
    {
      id: string;
      kind: string;
      name: string;
      email: string;
      postalCode: string;
      message: string;
      status: string;
      createdAt: string;
    }[]
  >("/leads");
  return (
    <section className="space-y-4">
      <h2 className="serif text-3xl">Waitlist & partner inquiries</h2>
      <Feedback state={data} />
      {!data.data?.length && <p>No inquiries yet.</p>}
      {data.data?.map((lead) => (
        <article key={lead.id} className={panel}>
          <p className="text-xs uppercase">
            {lead.kind} · {label(lead.status)} · {date(lead.createdAt)}
          </p>
          <h3 className="serif mt-2 text-2xl">{lead.name}</h3>
          <p className="mt-2 text-sm">
            {lead.email} · ZIP {lead.postalCode}
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm">{lead.message}</p>
          <div className="mt-4 flex gap-3">
            {["received", "review", "closed"].map((status) => (
              <button
                key={status}
                disabled={busy}
                className={secondary}
                onClick={() =>
                  void run(`/leads/${lead.id}`, "PUT", { status })
                    .then(data.refresh)
                    .catch(() => {})
                }
              >
                {label(status)}
              </button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
function Accounting({
  portal,
  run,
  busy,
  admin,
}: {
  portal: PortalView;
  run: Run;
  busy: boolean;
  admin: boolean;
}) {
  const data = useData<
    {
      orderId: string;
      kitchenId: string;
      amountCents: number;
      status: string;
      createdAt: string;
    }[]
  >("/payables");
  const [kitchenId, setKitchen] = useState(portal.kitchens[0]?.id ?? ""),
    [amount, setAmount] = useState("8.00"),
    [reference, setReference] = useState("");
  return (
    <section className="space-y-5">
      <h2 className="serif text-3xl">Test partner accounting</h2>
      <p className="text-sm">
        Allocations are snapshotted when a test order is created and recorded as
        a payable after its simulated delivery. These are illustrative
        accounting records. No payout transfer occurs.
      </p>
      <Feedback state={data} />
      {admin && (
        <form
          className={`${panel} space-y-4`}
          onSubmit={(e) => {
            e.preventDefault();
            void run("/compensation", "PUT", {
              kitchenId,
              perMealCents: Math.round(Number(amount) * 100),
              reference,
            }).catch(() => {});
          }}
        >
          <label className="block text-sm">
            Kitchen
            <select
              required
              value={kitchenId}
              onChange={(e) => setKitchen(e.target.value)}
              className={input}
            >
              {portal.kitchens.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Test allocation per meal (dollars)
            <input
              required
              type="number"
              step="0.01"
              min="0"
              max="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={input}
            />
          </label>
          <label className="block text-sm">
            Agreement or test reference
            <input
              required
              minLength={3}
              maxLength={500}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={input}
            />
          </label>
          <button disabled={busy} className={button}>
            Save future test allocation
          </button>
        </form>
      )}
      {!data.data?.length && <p>No delivered test order payables yet.</p>}
      {data.data?.map((payable) => (
        <article key={payable.orderId} className={panel}>
          <p className="break-all text-sm">Order {payable.orderId}</p>
          <p className="mt-2 font-semibold">
            {money(payable.amountCents)} · {label(payable.status)}
          </p>
          {admin && payable.status === "recorded" && (
            <button
              disabled={busy}
              className={`${secondary} mt-4`}
              onClick={() =>
                void run(`/payables/${payable.orderId}/settle-test`)
                  .then(data.refresh)
                  .catch(() => {})
              }
            >
              Record test settlement (no transfer)
            </button>
          )}
        </article>
      ))}
    </section>
  );
}

function downloadPreparation(orders: OrderView[]) {
  const cell = (value: string | number) => {
    let s = String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const rows = [
    [
      "Test order",
      "Kitchen",
      "Test window (UTC)",
      "Meal",
      "Quantity",
      "Test status",
    ],
    ...orders
      .filter(
        (order) =>
          ![
            "canceled",
            "payment_failed",
            "refunded",
            "awaiting_payment",
          ].includes(order.status),
      )
      .flatMap((order) =>
        order.items.map((item) => [
          order.id,
          order.kitchenId,
          order.slot.startsAt,
          item.name,
          item.quantity,
          order.status,
        ]),
      ),
  ];
  const url = URL.createObjectURL(
    new Blob([rows.map((row) => row.map(cell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "Nomilora-test-preparation.csv";
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WeeklyBoxes({ customer }: { customer: Customer }) {
  const plans = useData<SubscriptionView[]>("/subscriptions"),
    catalog = useData<CatalogView[]>("/catalog"),
    slots =
      useData<
        { id: string; startsAt: string; cutoffAt: string; kitchenId: string }[]
      >("/slots");
  const workspace = useData<{
    boxes: {
      id: string;
      subscriptionId: string;
      addressId: string;
      slotId: string;
      periodStart: string;
      periodEnd: string;
      status: string;
      note: string;
      orderId: string | null;
      items: { mealId: string; quantity: number }[];
    }[];
    invoices: {
      id: string;
      amountCents: number;
      status: string;
      note: string;
      periodStart: string;
      periodEnd: string;
      orderId: string | null;
    }[];
  }>("/plan-boxes");
  const action = useAction(workspace.refresh);
  const [subscriptionId, setPlan] = useState(""),
    [addressId, setAddress] = useState(""),
    [slotId, setSlot] = useState(""),
    [quantities, setQuantities] = useState<Record<string, number>>({});
  const plan = plans.data?.find((p) => p.id === subscriptionId);
  const total = Object.values(quantities).reduce((n, q) => n + q, 0);
  const slot = slots.data?.find((s) => s.id === slotId);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await action.run("/plan-boxes", "POST", {
        subscriptionId,
        addressId,
        slotId,
        items: Object.entries(quantities)
          .filter(([, q]) => q > 0)
          .map(([mealId, quantity]) => ({ mealId, quantity })),
      });
    } catch {}
  };
  return (
    <Frame title="Weekly test boxes">
      <p className="mb-5 text-sm">
        Your billing plan fixes an illustrative $15 per meal. Select exactly the
        plan's meal count for an eligible test window. A saved draft reserves
        nothing; only a verified paid test invoice can create its order.
        Fulfillment checks stock, capacity, deadlines, and saved allergy
        restrictions again. No real food or delivery occurs.
      </p>
      <Feedback state={workspace} />
      <Feedback state={action} />
      <form onSubmit={save} className={`${panel} space-y-5`}>
        <h2 className="serif text-3xl">Choose or edit a weekly box</h2>
        <label className="block text-sm font-semibold">
          Test billing plan
          <select
            required
            value={subscriptionId}
            onChange={(e) => {
              setPlan(e.target.value);
              setQuantities({});
            }}
            className={input}
          >
            <option value="">Select a verified plan</option>
            {plans.data
              ?.filter((p) => p.status !== "canceled" && p.nextBillingAt)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.mealCount} meals — {money(p.weeklyPriceCents)}/week
                </option>
              ))}
          </select>
        </label>
        {!plans.data?.some(
          (p) => p.status !== "canceled" && p.nextBillingAt,
        ) && (
          <p className="text-sm">
            Complete Stripe test billing first, then choose the box for its
            verified period.{" "}
            <Link href="/activity" className="underline">
              Orders & plans
            </Link>
          </p>
        )}
        <label className="block text-sm font-semibold">
          Saved address
          <select
            required
            value={addressId}
            onChange={(e) => setAddress(e.target.value)}
            className={input}
          >
            <option value="">Select address</option>
            {customer.account!.addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {a.postalCode}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Test preparation window
          <select
            required
            value={slotId}
            onChange={(e) => {
              setSlot(e.target.value);
              setQuantities({});
            }}
            className={input}
          >
            <option value="">Select window</option>
            {slots.data
              ?.filter((s) => Date.parse(s.cutoffAt) > Date.now())
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {date(s.startsAt)}
                </option>
              ))}
          </select>
        </label>
        <fieldset>
          <legend className="font-semibold">
            Meal selection — {total}/{plan?.mealCount ?? 0} meals
          </legend>
          <div className="mt-4 space-y-3">
            {catalog.data
              ?.filter((meal) => !slot || meal.kitchenId === slot.kitchenId)
              .map((meal) => (
                <label
                  key={meal.id}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span>{meal.name}</span>
                  <input
                    aria-label={`Weekly quantity for ${meal.name}`}
                    type="number"
                    min="0"
                    max="20"
                    value={quantities[meal.id] ?? 0}
                    onChange={(e) =>
                      setQuantities((q) => ({
                        ...q,
                        [meal.id]: Number(e.target.value),
                      }))
                    }
                    className="w-20 rounded-lg border border-[#d8d3c6] bg-white p-2"
                  />
                </label>
              ))}
          </div>
        </fieldset>
        <button
          disabled={action.busy || !plan || total !== plan.mealCount}
          className={button}
        >
          Save weekly test box
        </button>
        <p className="text-xs">
          Paid boxes cannot be edited after their order is created. Use plan
          billing controls to pause or skip future test invoices. Existing paid
          periods are not automatically refunded.
        </p>
      </form>
      <section className="mt-8 space-y-4">
        <h2 className="serif text-3xl">Saved weekly boxes</h2>
        {workspace.data?.boxes.map((box) => (
          <article key={box.id} className={panel}>
            <p>
              {date(box.periodStart)} – {date(box.periodEnd)}
            </p>
            <p className="mt-2 font-semibold capitalize">{label(box.status)}</p>
            <p className="mt-2 text-sm">
              {box.note ||
                "Draft saved. Awaiting a matching verified paid test invoice."}
            </p>
            <ul className="mt-3 text-sm">
              {box.items.map((item) => (
                <li key={item.mealId}>
                  {item.quantity} ×{" "}
                  {catalog.data?.find((meal) => meal.id === item.mealId)
                    ?.name ?? "Saved meal"}
                </li>
              ))}
            </ul>
            {box.status !== "fulfilled" && (
              <button
                className={`${secondary} mt-3`}
                onClick={() => {
                  setPlan(box.subscriptionId);
                  setAddress(box.addressId);
                  setSlot(box.slotId);
                  setQuantities(
                    Object.fromEntries(
                      box.items.map((i) => [i.mealId, i.quantity]),
                    ),
                  );
                }}
              >
                Load selection for editing
              </button>
            )}
            {box.orderId && (
              <Link href="/activity" className="mt-3 inline-block underline">
                View created test order
              </Link>
            )}
          </article>
        ))}
      </section>
      <section className="mt-8 space-y-4">
        <h2 className="serif text-3xl">Verified test billing periods</h2>
        {workspace.data?.invoices.map((invoice) => (
          <article key={invoice.id} className={panel}>
            <p className="break-all text-xs">Invoice {invoice.id}</p>
            <p className="mt-2 font-semibold">
              {money(invoice.amountCents)} · {label(invoice.status)}
            </p>
            <p className="mt-2 text-sm">
              {date(invoice.periodStart)} – {date(invoice.periodEnd)}
            </p>
            {invoice.note && (
              <p role="status" className="mt-3 text-sm text-[#a34d2c]">
                {invoice.note}
              </p>
            )}
          </article>
        ))}
      </section>
    </Frame>
  );
}
function BillingAttention({
  run,
  busy,
  admin,
}: {
  run: Run;
  busy: boolean;
  admin: boolean;
}) {
  const data =
    useData<
      {
        id: string;
        subscriptionId: string;
        amountCents: number;
        periodStart: string;
        periodEnd: string;
        note: string;
      }[]
    >("/billing-attention");
  return (
    <section className="space-y-4">
      <h2 className="serif text-3xl">Paid test billing exceptions</h2>
      <Feedback state={data} />
      {!data.data?.length && <p>No unresolved test fulfillment exceptions.</p>}
      {data.data?.map((invoice) => (
        <article key={invoice.id} className={panel}>
          <p className="break-all text-xs">Invoice {invoice.id}</p>
          <p className="mt-2 font-semibold">
            {money(invoice.amountCents)} · {date(invoice.periodStart)}
          </p>
          <p className="mt-3 text-sm">{invoice.note}</p>
          <p className="mt-2 text-xs">
            Resolve the customer's box, allergy declarations, inventory or test
            window before retrying. Retrying never charges again.
          </p>
          {admin && (
            <button
              disabled={busy}
              className={`${secondary} mt-4`}
              onClick={() =>
                void run(`/billing-attention/${invoice.id}/retry`)
                  .then(data.refresh)
                  .catch(() => {})
              }
            >
              Retry verified test fulfillment
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
