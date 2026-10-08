"use client";

import { useState } from "react";
import Button from "../../../../../components/shared/Button";
import PasswordInput from "../../../../../components/shared/PasswordInput";
import postexService from "../_lib/postexService";

export default function ConnectForm({ onConnected, onError }) {
  const [apiToken, setApiToken] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setConnecting(true);
    onError("");
    try {
      const data = await postexService.connect({ api_token: apiToken.trim() });
      setApiToken("");
      onConnected(data);
    } catch (err) {
      onError(err.message || "Failed to connect PostEx");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-surface-border bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Connect PostEx</h2>
      <p className="text-xs text-slate-500">
        Paste the API token from your PostEx merchant portal (or ask support@postex.pk). It&apos;s checked
        with PostEx before it&apos;s saved.
      </p>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">API Token</span>
        <PasswordInput
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder="Your PostEx API token"
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          required
        />
      </label>

      <Button type="submit" loading={connecting} className="w-full">
        Connect
      </Button>
    </form>
  );
}
