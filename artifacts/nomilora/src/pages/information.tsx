import { useState, type FormEvent } from "react";
import { Link } from "wouter";
const panel = "mx-auto max-w-3xl px-5 py-12 md:px-10";
const input =
  "mt-2 w-full rounded-xl border border-[#d8d3c6] bg-[#fffdf8] p-3 text-[#173b27]";
export function Inquiry({ kind }: { kind: "partner" | "waitlist" }) {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [postalCode, setPostal] = useState(""),
    [message, setMessage] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/launch-inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name,
          email,
          postalCode,
          message,
          consent,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "The form could not be submitted.");
      }
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The form could not be submitted.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={panel}>
      <p className="eyebrow">A planned Queens pilot</p>
      <h1 className="serif mt-2 text-5xl text-[#173b27]">
        {kind === "partner" ? "Restaurant inquiry" : "Join the waitlist"}
      </h1>
      <p className="mt-5 text-sm leading-6">
        {kind === "partner"
          ? "Tell the founder about a prospective kitchen. Submitting does not establish a partnership, agreement, approval, or public listing."
          : "Register your interest in a future pilot. Delivery areas and dates are not promised. No order, payment, or subscription is created."}
      </p>
      {error && (
        <p role="alert" className="mt-5 rounded-xl bg-[#faeee5] p-4">
          {error}
        </p>
      )}
      {saved ? (
        <div role="status" className="mt-6 rounded-2xl bg-[#e9ecdf] p-6">
          <h2 className="serif text-2xl">Your inquiry is recorded</h2>
          <p className="mt-3 text-sm">
            The founder can review it in the private queue. Automated email
            follow-up and a response-time commitment are not configured.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-5">
          {(
            [
              ["Name", name, setName, "text"],
              ["Email", email, setEmail, "email"],
              ["ZIP code", postalCode, setPostal, "text"],
            ] as const
          ).map(([title, value, setter, type]) => (
            <label key={title} className="block text-sm font-semibold">
              {title}
              <input
                type={type}
                required
                maxLength={title === "ZIP code" ? 5 : 254}
                pattern={title === "ZIP code" ? "[0-9]{5}" : undefined}
                value={value}
                onChange={(e) => setter(e.target.value)}
                className={input}
              />
            </label>
          ))}
          <label className="block text-sm font-semibold">
            {kind === "partner"
              ? "Restaurant name, kitchen location and your message"
              : "Message (optional)"}
            <textarea
              required={kind === "partner"}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={input}
            />
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              required
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1"
            />
            I consent to Nomilora storing these details for review and
            responding about this inquiry. No subscription or marketing
            enrollment is created.
          </label>
          <button
            disabled={busy || !consent}
            className="rounded-full bg-[#173b27] px-6 py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit inquiry"}
          </button>
        </form>
      )}
      <Link href="/privacy" className="mt-6 inline-block text-sm underline">
        Read the draft privacy notice
      </Link>
    </div>
  );
}
const content: Record<string, { title: string; paragraphs: string[] }> = {
  about: {
    title: "About Nomilora",
    paragraphs: [
      "Good food. Your way. Nomilora is developing a personalized prepared-meal service for a future Queens pilot, beginning with planned Astoria and Long Island City areas.",
      "The intended model uses authorized partner restaurant kitchens. No kitchen agreement, active delivery service or public restaurant partnership is implied by this preview. Illustrative meals are test data.",
    ],
  },
  privacy: {
    title: "Draft privacy notice",
    paragraphs: [
      "This development notice describes the implemented data flow. It is not a legally reviewed launch policy.",
      "Guest preview preferences, favorites, baskets and simulated checkout history use browser storage. Signed-in profiles, dietary preferences, addresses, carts, favorites, test order records and support messages use the application PostgreSQL database. Supabase handles passwords and authentication sessions; passwords are not stored in Nomilora’s application database.",
      "Stripe test checkout receives test billing information and opaque order references. Do not enter real card details in this preview. Saved dietary information is optional; clear it in My tastes. Restaurant kitchen views exclude customer saved addresses and contact details. Support internal notes are visible only to support staff.",
      "Inquiries store the submitted name, email, ZIP code, message and consent for founder review. No marketing message is sent automatically. To request access, correction or deletion, open an account support ticket or contact the founder through your existing direct channel. A verified public privacy contact, retention schedule, deletion policy and full legal review remain prerequisites to public launch.",
    ],
  },
  terms: {
    title: "Draft preview terms",
    paragraphs: [
      "This application is a development preview. Its sample menu, prices, nutrition, dietary tags, operating areas and delivery windows are illustrative unless explicitly verified.",
      "No real food purchase, delivery commitment or restaurant agreement is created here. Test orders and Stripe test subscriptions are labeled as test records. Legal company details, service terms, governing policies and subscription disclosures require founder and qualified professional review before commercial use.",
    ],
  },
  allergens: {
    title: "Food and allergen information",
    paragraphs: [
      "Never rely on the illustrative preview menu for a food-safety decision. Unknown ingredient, allergen or cross-contact information is not interpreted as safe.",
      "Saved strict allergy and dietary requirements are enforced when a test order is created. Unverified or conflicting declarations block checkout. Recorded verification evidence does not constitute a medical guarantee or eliminate cross-contact risk.",
      "No real meal should be sold until an authorized partner has supplied and verified its recipe, major allergens, cross-contact controls, portions, packaging, storage, use-by and reheating instructions. For a serious or urgent health concern, use appropriate local medical care; this preview support channel is not an emergency service.",
    ],
  },
  refunds: {
    title: "Draft refunds and billing notice",
    paragraphs: [
      "No real payments are accepted. The original demo checkout charges nothing. Saved simulation orders also charge nothing. Stripe integrations accept test keys and test events only.",
      "For a paid Stripe test order, request help through a ticket. An administrator can submit a full test refund; the record changes only after a signed Stripe event verifies it. Canceling a paid order is not treated as a refund.",
      "Test weekly billing plans renew at the displayed illustrative weekly amount. Pause voids subsequent test invoices until collection resumes. Skip voids the next test invoice and resumes collection after that boundary. Cancel ends the test subscription immediately. Prior test payments are not automatically refunded. No meal delivery is scheduled by test billing. Commercial cancellation, refund and subscription policies remain subject to legal and operational review.",
    ],
  },
  "help-center": {
    title: "Help center",
    paragraphs: [
      "To browse: Explore meals shows the original illustrative menu. To save across devices, sign in and use My tastes and your saved basket.",
      "To test orders: open Test market, add test catalog meals, select a saved address and an eligible test preparation window, then choose the no-charge simulation. Stripe test checkout is available only after its credentials and signed webhook are configured. Allergen restrictions may correctly leave no eligible test meals.",
      "To get help: sign in and open Help & messages. You can link your own order, send replies, read support responses and reopen a resolved ticket. An active human support team and service response commitment are not configured.",
      "To track test records: Orders & plans shows timestamped server state. A return from checkout is not proof of payment. Only a verified webhook marks a Stripe test payment paid. No real courier tracking is connected.",
    ],
  },
};
export function Information({ page }: { page: string }) {
  const item = content[page] ?? content.about;
  return (
    <article className={panel}>
      <p className="eyebrow">Nomilora preview</p>
      <h1 className="serif mt-3 text-5xl text-[#173b27]">{item.title}</h1>
      <div className="mt-7 space-y-5 text-sm leading-7 text-[#4d5c4a]">
        {item.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap gap-5 text-sm font-semibold text-[#a34d2c]">
        <Link href="/help" className="underline">
          Help & messages
        </Link>
        <Link href="/account" className="underline">
          My account
        </Link>
        <Link href="/waitlist" className="underline">
          Waitlist
        </Link>
      </div>
    </article>
  );
}
