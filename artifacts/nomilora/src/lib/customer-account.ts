import { useCallback, useEffect, useRef, useState } from "react";
import type { Account } from "@workspace/api-zod/account";
import { accountRequest } from "./auth";
import { WriteQueue } from "./write-queue";

export function useCustomerAccount(subject?: string) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(!!subject);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState({
    pending: 0,
    error: "",
    saved: false,
  });
  const [version, setVersion] = useState(0);
  const queue = useRef<WriteQueue | null>(null);
  useEffect(() => {
    const instance = new WriteQueue((pending, error) =>
      setSaveState({ pending, error, saved: pending === 0 && !error }),
    );
    queue.current = instance;
    return () => instance.dispose();
  }, []);
  useEffect(() => {
    if (!subject) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    void accountRequest(subject)
      .then((value) => {
        if (active) setAccount(value);
      })
      .catch((error) => {
        if (active) setLoadError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [subject, version]);
  useEffect(() => {
    if (!saveState.pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState.pending]);
  const update = useCallback(
    (
      change: (current: Account) => Account,
      path: string,
      method: string,
      body?: unknown,
    ) => {
      if (!subject || !account || !queue.current) return;
      setAccount((current) => (current ? change(current) : current));
      queue.current.enqueue(async () => {
        await accountRequest(subject, path, method, body);
      });
    },
    [subject, account],
  );
  return {
    account,
    loading,
    loadError,
    ...saveState,
    update,
    reload: () => setVersion((value) => value + 1),
    retry: () => queue.current?.retry(),
  };
}
