import { test } from "node:test";
import assert from "node:assert/strict";
import { recoveryMarker } from "../src/lib/recovery-state.ts";
const fixture = () => {
  const values = new Map<string, string>();
  return {
    values,
    storage: () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    }),
  };
};
test("recovery UI survives refresh and reload but clears on sign-out or identity change", () => {
  const { storage, values } = fixture();
  assert.equal(
    recoveryMarker("PASSWORD_RECOVERY", "fixture-one", storage),
    true,
  );
  assert.deepEqual([...values.values()], ["fixture-one"]);
  assert.equal(recoveryMarker("TOKEN_REFRESHED", "fixture-one", storage), true);
  assert.equal(recoveryMarker("INITIAL_SESSION", "fixture-one", storage), true);
  assert.equal(recoveryMarker("SIGNED_IN", "fixture-two", storage), false);
  assert.equal(values.size, 0);
  assert.equal(
    recoveryMarker("PASSWORD_RECOVERY", "fixture-two", storage),
    true,
  );
  assert.equal(recoveryMarker("SIGNED_OUT", undefined, storage), false);
  assert.equal(values.size, 0);
});
test("blocked browser storage does not break recovery or create a remembered session", () => {
  const unavailable = () => {
    throw new Error("Storage blocked");
  };
  assert.equal(
    recoveryMarker("PASSWORD_RECOVERY", "fixture", unavailable),
    true,
  );
  assert.equal(
    recoveryMarker("INITIAL_SESSION", "fixture", unavailable),
    false,
  );
  assert.equal(recoveryMarker("SIGNED_OUT", undefined, unavailable), false);
});
