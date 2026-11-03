"use client";

import { useState } from "react";
import Button from "../../../../../components/shared/Button";
import PasswordInput from "../../../../../components/shared/PasswordInput";
import leopardsService from "../_lib/leopardsService";

export default function ConnectForm({ onConnected, onError }) {
  const [apiKey, setApiKey] = useState("");
  const [apiPassword, setApiPassword] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setConnecting(true);
    onError("");
    try {
      const data = await leopardsService.connect({
        api_key: apiKey.trim(),
        api_password: apiPassword.trim(),
      });
      setApiKey("");
      setApiPassword("");
      onConnected(data);
    } catch (err) {
      onError(err.message || "Failed to connect Leopards");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-surface-border bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Connect Leopards</h2>
      <p className="text-xs text-slate-500">
        Use the API key and password from your Leopards merchant account (API Management under API Settings).
        They&apos;re checked with Leopards before they&apos;re saved. Afterwards you&apos;ll get a webhook
        URL and header to register with Leopards for live status updates.
      </p>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">API Key</span>
        <PasswordInput
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Your Leopards API key"
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          required
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">API Password</span>
        <PasswordInput
          value={apiPassword}
          onChange={(e) => setApiPassword(e.target.value)}
          placeholder="Your Leopards API password"
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
