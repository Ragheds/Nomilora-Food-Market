import type { RequestHandler } from "express";
import { z } from "zod";
import type { Role } from "@workspace/api-zod/account";

export type Identity = { subject: string; email: string };
export type VerifyToken = (token: string) => Promise<Identity>;
export class AuthFailure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const verifySupabaseToken: VerifyToken = async (token) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new AuthFailure(503, "Account access is not configured yet.");
  let response: Response;
  try {
    // Supabase validates the token on its Auth server; never trust decoded claims or user_metadata roles.
    response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new AuthFailure(
      503,
      "Account verification is temporarily unavailable.",
    );
  }
  if (response.status >= 500 || response.status === 429)
    throw new AuthFailure(
      503,
      "Account verification is temporarily unavailable.",
    );
  if (!response.ok) throw new AuthFailure(401, "Please sign in again.");
  const parsed = z
    .object({
      id: z.string().uuid(),
      email: z.string().email().optional(),
      is_anonymous: z.boolean().optional(),
      email_confirmed_at: z.string().nullable().optional(),
    })
    .safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw new AuthFailure(
      503,
      "Account verification returned an invalid response.",
    );
  const user = parsed.data;
  if (!user.email || user.is_anonymous || !user.email_confirmed_at)
    throw new AuthFailure(
      403,
      "Verify your email before accessing your account.",
    );
  return { subject: user.id, email: user.email };
};

export function authenticate(
  verify: VerifyToken = verifySupabaseToken,
): RequestHandler {
  return async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? "");
    if (!match || match[1].length > 8192) {
      res.status(401).json({ error: "Please sign in." });
      return;
    }
    try {
      res.locals.identity = await verify(match[1]);
      next();
    } catch (error) {
      if (error instanceof AuthFailure) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}

export function requireRoles(...allowed: Role[]): RequestHandler {
  return (_req, res, next) => {
    const roles: Role[] = res.locals.roles ?? [];
    if (!roles.some((role) => allowed.includes(role))) {
      res
        .status(403)
        .json({ error: "You do not have permission to access this area." });
      return;
    }
    next();
  };
}
