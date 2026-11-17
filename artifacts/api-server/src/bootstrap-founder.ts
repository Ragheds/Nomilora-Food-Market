import { and, eq, sql } from "drizzle-orm";
import { db, pool, appUsers, userRoles, auditEvents } from "@workspace/db";
import { z } from "zod";
const subject = z.string().uuid().parse(process.env.NOMILORA_FOUNDER_SUBJECT);
if (process.env.CONFIRM_FOUNDER_SETUP !== "yes")
  throw new Error("Explicit founder bootstrap confirmation is required.");
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(81277391)`);
    const existing = await tx
      .select()
      .from(userRoles)
      .where(eq(userRoles.role, "founder_admin"));
    const [user] = await tx
      .select()
      .from(appUsers)
      .where(
        and(
          eq(appUsers.authProvider, "supabase"),
          eq(appUsers.authSubject, subject),
        ),
      );
    if (!user || user.disabledAt)
      throw new Error(
        "The exact Supabase user must first verify email and sign in to this app.",
      );
    if (existing.some((role) => role.userId !== user.id))
      throw new Error(
        "A founder already exists. Use its protected role-management workflow.",
      );
    await tx
      .insert(userRoles)
      .values({
        userId: user.id,
        role: "founder_admin",
        grantedByUserId: user.id,
      })
      .onConflictDoNothing();
    await tx
      .insert(auditEvents)
      .values({
        actorId: user.id,
        action: "founder.bootstrap",
        entityId: user.id,
      });
    console.log(
      "The verified account is now the initial founder. Authenticator verification is required for staff operations.",
    );
  });
} finally {
  await pool.end();
}
