"use client";

import { useState } from "react";
import Button from "../../../../../components/shared/Button";
import PasswordInput from "../../../../../components/shared/PasswordInput";
import barqraftarService from "../_lib/barqraftarService";

const EMPTY_FORM = { api_key: "", api_secret: "" };

export default function ConnectForm({ onConnected, onError }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [connecting, setConnecting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setConnecting(true);
    onError("");
    try {
      const data = await barqraftarService.connect(form);
      setForm(EMPTY_FORM);
      onConnected(data);
    } catch (err) {
      onError(err.message || "Failed to connect BarqRaftar");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-surface-border bg-white p-5"
    >
      <h2 className="text-sm font-semibold text-slate-900">Connect BarqRaftar</h2>
      <p className="text-xs text-slate-500">
        Get your API key and secret from BarqRaftar support (support@barqraftar.pk).
      </p>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">API Key</span>
        <PasswordInput
          value={form.api_key}
          onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
          placeholder="Your BarqRaftar api_key"
          className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          required
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">API Secret</span>
        <PasswordInput
          value={form.api_secret}
          onChange={(e) => setForm((f) => ({ ...f, api_secret: e.target.value }))}
          placeholder="Your BarqRaftar api_secret"
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
