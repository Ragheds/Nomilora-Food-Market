import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import {
  addressInput,
  type Address,
  type AddressInput,
} from "@workspace/api-zod/account";
import { accountRequest, supabase, useAuth } from "../lib/auth";
import type { useCustomerAccount } from "../lib/customer-account";

const inputClass =
  "mt-1 w-full rounded-xl border border-[#d8d3c6] bg-[#fffdf8] px-4 py-3 text-[#173b27]";
const buttonClass =
  "rounded-full bg-[#173b27] px-5 py-3 font-semibold text-white disabled:opacity-50";
const blankAddress: AddressInput = {
  label: "Home",
  recipientName: "",
  phoneNumber: "",
  street1: "",
  street2: "",
  city: "Queens",
  region: "NY",
  postalCode: "",
  countryCode: "US",
  deliveryInstructions: "",
  isDefault: false,
};
type Customer = ReturnType<typeof useCustomerAccount>;

export function AccountPage({ customer }: { customer: Customer }) {
  const { session, recovery } = useAuth();
  const [changePassword, setChangePassword] = useState(false);
  const resetting = recovery || changePassword;
  const [passwordAssured, setPasswordAssured] = useState(false);
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "resend">(
    "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError("");
    setMessage("");
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}account`;
    try {
      if (resetting && session) {
        if (!passwordAssured)
          throw new Error(
            "Verify your authenticator before updating your password.",
          );
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        const result = await supabase.auth.signOut();
        if (result.error) throw result.error;
        setPassword("");
        setChangePassword(false);
        setMessage("Password updated. Sign in with your new password.");
      } else if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setPassword("");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        setPassword("");
        setMessage(
          "Check your email for a confirmation link before signing in.",
        );
      } else if (mode === "resend") {
        const { error } = await supabase.auth.resend({
          type: "signup",
          email,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        setMessage(
          "If confirmation is available for this address, check your email.",
        );
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (error) throw error;
        setMessage(
          "If an account exists for this address, a recovery email will arrive.",
        );
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Account access failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch {
      setError("Sign out failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-4xl px-5 py-12 md:px-10">
      <p className="eyebrow">Your Nomilora</p>
      <h1 className="serif mt-2 text-5xl text-[#173b27]">My account</h1>
      {message && (
        <p role="status" className="mt-5 rounded-xl bg-[#e9ecdf] p-4">
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-5 rounded-xl bg-[#faeee5] p-4 text-[#794d3a]"
        >
          {error}
        </p>
      )}
      {!supabase ? (
        <section className="mt-8 rounded-2xl border border-[#d8d3c6] p-6">
          <h2 className="serif text-2xl">Accounts are being prepared</h2>
          <p className="mt-3">
            Account access is not configured yet. You can still explore the
            preview and save a basket in this browser.
          </p>
          <Link
            href="/explore"
            className="mt-4 inline-block font-semibold underline"
          >
            Explore meals
          </Link>
        </section>
      ) : !session || resetting ? (
        <>
          {resetting && session && (
            <MfaSettings recovery onAssuranceChange={setPasswordAssured} />
          )}
          <form
            onSubmit={submit}
            className="mt-8 max-w-md space-y-5 rounded-2xl border border-[#d8d3c6] bg-[#fbf9f3] p-6"
          >
            <h2 className="serif text-3xl">
              {resetting
                ? "Set a new password"
                : {
                    login: "Welcome back",
                    signup: "Create your account",
                    forgot: "Recover your account",
                    resend: "Resend verification",
                  }[mode]}
            </h2>
            {!resetting && (
              <label className="block text-sm font-semibold">
                Email
                <input
                  required
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={inputClass}
                />
              </label>
            )}
            {(resetting || mode === "login" || mode === "signup") && (
              <label className="block text-sm font-semibold">
                Password
                <input
                  required
                  type="password"
                  autoComplete={
                    resetting || mode === "signup"
                      ? "new-password"
                      : "current-password"
                  }
                  minLength={mode === "login" && !resetting ? 1 : 12}
                  disabled={resetting && !passwordAssured}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={inputClass}
                />
                {(mode === "signup" || resetting) && (
                  <span className="mt-1 block text-xs font-normal">
                    Use at least 12 characters.
                  </span>
                )}
              </label>
            )}
            <button
              disabled={busy || (resetting && !passwordAssured)}
              className={buttonClass}
            >
              {busy
                ? "Please wait…"
                : resetting
                  ? "Update password"
                  : {
                      login: "Sign in",
                      signup: "Register",
                      forgot: "Send recovery email",
                      resend: "Send verification email",
                    }[mode]}
            </button>
            {!resetting && (
              <div className="flex flex-wrap gap-4 text-sm">
                {(["login", "signup", "forgot", "resend"] as const)
                  .filter((item) => item !== mode)
                  .map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setMode(item);
                        setError("");
                        setMessage("");
                        setPassword("");
                      }}
                      className="text-[#a34d2c] underline"
                    >
                      {
                        {
                          login: "Sign in",
                          signup: "Register",
                          forgot: "Forgot password?",
                          resend: "Verify email",
                        }[item]
                      }
                    </button>
                  ))}
              </div>
            )}
          </form>
        </>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <p>Signed in as {session.user.email}</p>
            <button
              disabled={busy || (customer.pending > 0 && !customer.error)}
              onClick={() => void logout()}
              className="rounded-full border border-[#d8d3c6] px-5 py-3"
            >
              {customer.error
                ? "Sign out and discard unsaved changes"
                : "Sign out"}
            </button>
          </div>
          <p className="mt-3 text-sm text-[#687164]">
            Saved account data stays separate from this browser’s guest preview.
            Addresses do not activate delivery.
          </p>
          <button
            type="button"
            className="mt-4 underline"
            onClick={() => {
              setPassword("");
              setPasswordAssured(false);
              setChangePassword(true);
              setError("");
            }}
          >
            Change password
          </button>
          {customer.account && (
            <>
              <MfaSettings />
              <AccountDetails key={customer.account.id} customer={customer} />
            </>
          )}
        </>
      )}
      <Link
        href="/profile"
        className="mt-8 inline-block font-semibold text-[#a34d2c] underline"
      >
        My tastes and saved meals
      </Link>
    </div>
  );
}

function AccountDetails({ customer }: { customer: Customer }) {
  const account = customer.account!;
  const { session } = useAuth();
  const [displayName, setDisplayName] = useState(account.displayName);
  const [phoneNumber, setPhoneNumber] = useState(account.phoneNumber);
  const [draft, setDraft] = useState<AddressInput>(blankAddress);
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const updateDraft = (key: keyof AddressInput, value: string | boolean) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const editAddress = (address: Address) => {
    const { id, ...value } = address;
    setDraft(value);
    setEditing(id);
  };
  const saveAddress = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = addressInput.safeParse(draft);
    if (!parsed.success || !session) {
      setError(
        "Check your address, including the two-letter state and ZIP code.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await accountRequest(
        session.user.id,
        editing ? `/addresses/${editing}` : "/addresses",
        editing ? "PUT" : "POST",
        parsed.data,
      );
      setDraft(blankAddress);
      setEditing(undefined);
      customer.reload();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Address could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteAddress = async (id: string) => {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      await accountRequest(session.user.id, `/addresses/${id}`, "DELETE");
      customer.reload();
    } catch {
      setError("Address could not be removed. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-8 space-y-8">
      <form
        className="space-y-4 rounded-2xl border border-[#d8d3c6] p-6"
        onSubmit={(event) => {
          event.preventDefault();
          customer.update(
            (current) => ({ ...current, displayName, phoneNumber }),
            "/profile",
            "PUT",
            { displayName, phoneNumber },
          );
        }}
      >
        <h2 className="serif text-3xl">Profile</h2>
        <label className="block text-sm font-semibold">
          Display name
          <input
            maxLength={200}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className={inputClass}
            autoComplete="name"
          />
        </label>
        <label className="block text-sm font-semibold">
          Phone
          <input
            type="tel"
            maxLength={30}
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            className={inputClass}
            autoComplete="tel"
          />
        </label>
        <button
          disabled={customer.pending > 0 || !!customer.error}
          className={buttonClass}
        >
          Save profile
        </button>
      </form>
      <section className="rounded-2xl border border-[#d8d3c6] p-6">
        <h2 className="serif text-3xl">Saved addresses</h2>
        <p className="mt-2 text-sm">
          Saved details are unverified. Service areas and delivery remain
          disabled.
        </p>
        {error && (
          <p role="alert" className="mt-4 text-[#a34d2c]">
            {error}
          </p>
        )}
        <ul className="mt-5 space-y-4">
          {account.addresses.map((address) => (
            <li key={address.id} className="rounded-xl bg-[#edf0e4] p-4">
              <p className="font-bold">
                {address.label}
                {address.isDefault ? " · Default" : ""}
              </p>
              <p>
                {address.recipientName} · {address.street1} {address.street2}
              </p>
              <p>
                {address.city}, {address.region} {address.postalCode}
              </p>
              <div className="mt-3 flex gap-5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => editAddress(address)}
                  className="underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy || customer.pending > 0}
                  onClick={() => void deleteAddress(address.id)}
                  className="text-[#a34d2c] underline"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form onSubmit={saveAddress} className="mt-6 space-y-4">
          <h3 className="serif text-2xl">
            {editing ? "Edit address" : "Add an address"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["label", "Label", "off"],
                ["recipientName", "Recipient name", "name"],
                ["phoneNumber", "Phone", "tel"],
                ["street1", "Street address", "address-line1"],
                ["street2", "Apartment / unit", "address-line2"],
                ["city", "City", "address-level2"],
                ["region", "State (two letters)", "address-level1"],
                ["postalCode", "ZIP code", "postal-code"],
              ] as const
            ).map(([key, label, autocomplete]) => (
              <label key={key} className="block text-sm font-semibold">
                {label}
                <input
                  required={!["phoneNumber", "street2"].includes(key)}
                  maxLength={key === "region" ? 2 : 200}
                  value={String(draft[key])}
                  onChange={(event) =>
                    updateDraft(
                      key,
                      key === "region"
                        ? event.target.value.toUpperCase()
                        : event.target.value,
                    )
                  }
                  autoComplete={autocomplete}
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          <label className="block text-sm font-semibold">
            Delivery notes
            <textarea
              maxLength={500}
              value={draft.deliveryInstructions}
              onChange={(event) =>
                updateDraft("deliveryInstructions", event.target.value)
              }
              className={inputClass}
            />
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(event) =>
                updateDraft("isDefault", event.target.checked)
              }
            />
            Default address
          </label>
          <div className="flex gap-4">
            <button
              disabled={busy || customer.pending > 0 || !!customer.error}
              className={buttonClass}
            >
              {busy ? "Saving…" : "Save address"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(undefined);
                  setDraft(blankAddress);
                }}
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

function MfaSettings({
  recovery = false,
  onAssuranceChange,
}: {
  recovery?: boolean;
  onAssuranceChange?: (allowed: boolean) => void;
} = {}) {
  const { session } = useAuth();
  const [factorId, setFactor] = useState(""),
    [qr, setQr] = useState(""),
    [code, setCode] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!supabase || !session) return;
    let active = true;
    onAssuranceChange?.(false);
    setError("");
    void Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])
      .then(([factors, aal]) => {
        if (!active) return;
        if (factors.error || aal.error) {
          setError("Authenticator settings could not be loaded.");
          return;
        }
        setFactor(
          factors.data.totp.find((factor) => factor.status === "verified")
            ?.id ?? "",
        );
        onAssuranceChange?.(
          aal.data.currentLevel === "aal2" || aal.data.nextLevel === "aal1",
        );
        setStatus(
          aal.data.currentLevel === "aal2"
            ? "Verified for this session"
            : factors.data.totp.length
              ? "Enter your authenticator code to verify this session"
              : "No authenticator enrolled",
        );
      })
      .catch(() => {
        if (active)
          setError(
            "Authenticator settings could not be loaded. Retry the security check.",
          );
      });
    return () => {
      active = false;
    };
  }, [session?.access_token, onAssuranceChange, version]);
  const enroll = async () => {
    if (!supabase) return;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Nomilora authenticator ${Date.now()}`,
      });
      if (error) throw error;
      setFactor(data.id);
      setQr(data.totp.qr_code);
      setStatus(
        "Scan the QR code in your authenticator, then verify its six-digit code.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enrollment failed.");
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || !factorId) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (error) throw error;
      setCode("");
      setQr("");
      setStatus("Verified for this session");
      onAssuranceChange?.(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-8 rounded-2xl border border-[#d8d3c6] p-6">
      <h2 className="serif text-3xl">
        {recovery ? "Verify your authenticator" : "Two-step account security"}
      </h2>
      <p className="mt-3 text-sm">
        {recovery ? (
          "If your account has two-step security enabled, enter a current code from your existing authenticator before changing your password. Keep your code private."
        ) : (
          <>
            Staff workflows require a verified authenticator session. Supabase
            manages enrollment and verification; no custom authentication
            secrets are stored in Nomilora.
          </>
        )}
      </p>
      <p role="status" className="mt-3 text-sm">
        {status}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-[#a34d2c]">
          {error}
        </p>
      )}
      {error && (
        <button
          type="button"
          className="mt-3 underline"
          onClick={() => setVersion((v) => v + 1)}
        >
          Retry security check
        </button>
      )}
      {qr && (
        <img
          alt="Authenticator enrollment QR code"
          className="mt-4 h-48 w-48"
          src={
            qr.startsWith("data:image/")
              ? qr
              : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`
          }
        />
      )}
      {!factorId && !recovery && (
        <button
          disabled={busy}
          className={`${buttonClass} mt-4`}
          onClick={() => void enroll()}
        >
          Enroll authenticator
        </button>
      )}
      {factorId && status !== "Verified for this session" && (
        <form onSubmit={verify} className="mt-4 max-w-sm space-y-3">
          <label className="block text-sm font-semibold">
            Authenticator code
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={inputClass}
            />
          </label>
          <button disabled={busy} className={buttonClass}>
            Verify session
          </button>
        </form>
      )}
    </section>
  );
}
