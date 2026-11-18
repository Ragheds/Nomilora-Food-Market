import { createClient, type Session } from "@supabase/supabase-js";
import { recoveryMarker } from "./recovery-state";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce",
        },
      })
    : null;
type AuthState = {
  session: Session | null;
  ready: boolean;
  recovery: boolean;
  error: string;
};
const AuthContext = createContext<AuthState>({
  session: null,
  ready: false,
  recovery: false,
  error: "",
});
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    ready: !supabase,
    recovery: false,
    error: "",
  });
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    // INITIAL_SESSION also covers PKCE confirmation/recovery redirects.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // UI-only recovery marker; Supabase still authorizes every password update.
      // No credentials or tokens are stored here, and the marker is account-scoped.
      const rememberedRecovery = recoveryMarker(event, session?.user.id);
      if (active)
        setState((current) => ({
          session,
          ready: true,
          recovery:
            event === "PASSWORD_RECOVERY" ||
            rememberedRecovery ||
            (!!session &&
              current.session?.user.id === session.user.id &&
              current.recovery &&
              event !== "SIGNED_OUT"),
          error: "",
        }));
    });
    void supabase.auth
      .getSession()
      .then(({ error }) => {
        if (active && error)
          setState({
            session: null,
            ready: true,
            recovery: false,
            error: "We could not restore your session. Please sign in again.",
          });
      })
      .catch(() => {
        if (active)
          setState({
            session: null,
            ready: true,
            recovery: false,
            error: "Account access is temporarily unavailable.",
          });
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
export async function authenticatedRequest(
  subject: string,
  url: string,
  method = "GET",
  body?: unknown,
) {
  if (!supabase) throw new Error("Account access is not configured.");
  const target = new URL(url, window.location.origin);
  if (
    target.origin !== window.location.origin ||
    !target.pathname.startsWith("/api/")
  )
    throw new Error("Account requests must stay on this application.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || data.session.user.id !== subject)
    throw new Error("Your session changed. Sign in again before saving.");
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error ?? "We could not save your changes.");
  }
  return response.status === 204 ? undefined : response.json();
}

export function accountRequest(
  subject: string,
  path = "",
  method = "GET",
  body?: unknown,
) {
  return authenticatedRequest(subject, `/api/account${path}`, method, body);
}
export function marketRequest(
  subject: string,
  path = "",
  method = "GET",
  body?: unknown,
) {
  return authenticatedRequest(subject, `/api/market${path}`, method, body);
}
