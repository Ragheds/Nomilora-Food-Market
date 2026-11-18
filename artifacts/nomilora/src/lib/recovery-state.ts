type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
// UI-only marker. Supabase authorizes password changes and MFA.
// Store only the subject, never passwords, access tokens or recovery URLs.
export function recoveryMarker(
  event: string,
  subject: string | undefined,
  getStorage: () => RecoveryStorage = () => window.sessionStorage,
): boolean {
  const key = "nomilora.password-recovery";
  try {
    const storage = getStorage();
    if (!subject || event === "SIGNED_OUT") {
      storage.removeItem(key);
      return false;
    }
    if (event === "PASSWORD_RECOVERY") storage.setItem(key, subject);
    else if (storage.getItem(key) !== subject) storage.removeItem(key);
    return storage.getItem(key) === subject;
  } catch {
    return !!subject && event === "PASSWORD_RECOVERY";
  }
}
