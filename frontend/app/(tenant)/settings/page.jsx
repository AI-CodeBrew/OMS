"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "../../../lib/supabaseClient";
import Button from "../../../components/shared/Button";
import useAuthStore from "../../../store/authStore";

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);

  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  async function onChangeEmail(e) {
    e.preventDefault();
    setEmailError("");
    setEmailStatus("");
    setEmailLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ email });
      if (error) throw new Error(error.message);
      setEmailStatus(
        "Confirmation email sent - your login email won't change until you click the link Supabase just sent you."
      );
      setEmail("");
    } catch (err) {
      setEmailError(err.message || "Failed to change email");
    } finally {
      setEmailLoading(false);
    }
  }

  async function onChangePassword(e) {
    e.preventDefault();
    setPasswordError("");
    setPasswordStatus("");
    if (password.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    setPasswordLoading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      setPasswordStatus("Password updated.");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(err.message || "Failed to change password");
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold text-slate-900">Account settings</h1>
      <p className="mt-1 text-sm text-slate-500">Signed in as {user?.email}</p>

      <div className="mt-6 rounded-lg border border-surface-border bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Change email</h2>
        {emailError ? (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{emailError}</p>
        ) : null}
        {emailStatus ? (
          <p className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {emailStatus}
          </p>
        ) : null}
        <form onSubmit={onChangeEmail} className="mt-3 flex gap-2">
          <input
            required
            type="email"
            placeholder="new-email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <Button type="submit" disabled={emailLoading}>
            {emailLoading ? "Saving…" : "Update email"}
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          Requires Supabase to actually deliver the confirmation email - if this project has no
          custom SMTP configured, delivery can be delayed or rate-limited by Supabase&apos;s
          default sandbox sender.
        </p>
      </div>

      <div className="mt-6 rounded-lg border border-surface-border bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Change password</h2>
        {passwordError ? (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {passwordError}
          </p>
        ) : null}
        {passwordStatus ? (
          <p className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {passwordStatus}
          </p>
        ) : null}
        <form onSubmit={onChangePassword} className="mt-3 space-y-3">
          <input
            required
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <input
            required
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <Button type="submit" disabled={passwordLoading}>
            {passwordLoading ? "Saving…" : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
