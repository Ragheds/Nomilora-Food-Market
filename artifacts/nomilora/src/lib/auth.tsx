import { createClient, type Session } from "@supabase/supabase-js";
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
      if (active)
        setState((current) => ({
          session,
          ready: true,
          recovery:
            event === "PASSWORD_RECOVERY" ||
            (current.recovery && event !== "SIGNED_OUT"),
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
export async function accountRequest(
  subject: string,
  path = "",
  method = "GET",
  body?: unknown,
) {
  if (!supabase) throw new Error("Account access is not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session || data.session.user.id !== subject)
    throw new Error("Your session changed. Sign in again before saving.");
  const response = await fetch(`/api/account${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error ?? "We could not save your changes.");
  }
  return response.status === 204 ? undefined : response.json();
}
