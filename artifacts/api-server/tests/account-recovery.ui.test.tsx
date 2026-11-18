import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AccountPage } from "../../nomilora/src/pages/account";
const auth = vi.hoisted(() => ({
  current: "aal1",
  next: "aal2",
  failed: false,
  updateUser: vi.fn(async () => ({ error: null })),
  signOut: vi.fn(async () => ({ error: null })),
  verify: vi.fn(),
}));
vi.mock("../../nomilora/src/lib/auth", () => ({
  useAuth: () => ({
    session: { user: { id: "recovery-fixture" }, access_token: "fixture" },
    recovery: true,
  }),
  accountRequest: vi.fn(),
  supabase: {
    auth: {
      updateUser: auth.updateUser,
      signOut: auth.signOut,
      mfa: {
        listFactors: async () => ({
          data: {
            totp:
              auth.next === "aal2"
                ? [{ id: "existing-fixture-factor", status: "verified" }]
                : [],
          },
          error: auth.failed ? new Error("offline") : null,
        }),
        getAuthenticatorAssuranceLevel: async () => ({
          data: { currentLevel: auth.current, nextLevel: auth.next },
          error: null,
        }),
        challengeAndVerify: auth.verify,
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  auth.current = "aal1";
  auth.next = "aal2";
  auth.failed = false;
});
const renderRecovery = () =>
  render(
    <AccountPage
      customer={{} as Parameters<typeof AccountPage>[0]["customer"]}
    />,
  );

test("MFA-protected recovery requires successful existing-factor verification before password update", async () => {
  auth.verify
    .mockResolvedValueOnce({ error: new Error("Invalid authenticator code") })
    .mockImplementationOnce(async () => {
      auth.current = "aal2";
      return { error: null };
    });
  renderRecovery();
  const update = screen.getByRole("button", {
    name: "Update password",
  }) as HTMLButtonElement;
  expect(update.disabled).toBe(true);
  const code = await screen.findByLabelText("Authenticator code");
  fireEvent.change(code, { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify session" }));
  await screen.findByText("Invalid authenticator code");
  expect(update.disabled).toBe(true);
  expect(auth.updateUser).not.toHaveBeenCalled();
  fireEvent.change(code, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify session" }));
  await waitFor(() => expect(update.disabled).toBe(false));
  expect(auth.verify).toHaveBeenLastCalledWith({
    factorId: "existing-fixture-factor",
    code: "123456",
  });
  expect(screen.queryByLabelText("Authenticator code")).toBeNull();
  fireEvent.change(screen.getByLabelText(/^Password/), {
    target: { value: "Fixture-only-new-password!" },
  });
  fireEvent.click(update);
  await screen.findByText("Password updated. Sign in with your new password.");
  expect(auth.updateUser).toHaveBeenCalledOnce();
  expect(auth.signOut).toHaveBeenCalledOnce();
});

test("security lookup failures keep password recovery locked and can be retried", async () => {
  auth.failed = true;
  renderRecovery();
  await screen.findByText("Authenticator settings could not be loaded.");
  expect(
    (
      screen.getByRole("button", {
        name: "Update password",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  auth.failed = false;
  auth.next = "aal1";
  fireEvent.click(screen.getByRole("button", { name: "Retry security check" }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Update password",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(
    screen.queryByRole("button", { name: "Enroll authenticator" }),
  ).toBeNull();
  expect(auth.updateUser).not.toHaveBeenCalled();
});
