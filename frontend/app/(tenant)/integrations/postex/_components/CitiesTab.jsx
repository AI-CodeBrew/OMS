"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "../../../../../components/shared/Button";
import postexService from "../_lib/postexService";

const INPUT =
  "rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500";

export default function CitiesTab({ status, onChanged, onError, onNotice }) {
  const [cities, setCities] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [aliasFrom, setAliasFrom] = useState("");
  const [aliasTo, setAliasTo] = useState("");
  const [savingAliases, setSavingAliases] = useState(false);

  const aliases = status.city_aliases || {};

  async function load(refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    onError("");
    try {
      const data = await postexService.getCities(refresh);
      setCities(data.cities || []);
      if (refresh) onNotice("City list refreshed from PostEx.");
    } catch (err) {
      onError(err.message || "Failed to load cities");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!cities) return [];
    const q = search.trim().toLowerCase();
    return q ? cities.filter((c) => c.toLowerCase().includes(q)) : cities;
  }, [cities, search]);

  async function saveAliases(next, message) {
    setSavingAliases(true);
    onError("");
    try {
      await postexService.updateSettings({ city_aliases: next });
      onNotice(message);
      onChanged();
      return true;
    } catch (err) {
      onError(err.message || "Failed to save city aliases");
      return false;
    } finally {
      setSavingAliases(false);
    }
  }

  function onAddAlias(e) {
    e.preventDefault();
    const from = aliasFrom.trim();
    const to = aliasTo.trim();
    if (!from || !to) return;
    if (cities && !cities.some((c) => c.toLowerCase() === to.toLowerCase())) {
      onError(`"${to}" isn't one of PostEx's cities - pick it from the list.`);
      return;
    }
    saveAliases({ ...aliases, [from]: to }, `Orders for "${from}" will now book to ${to}.`).then((ok) => {
      if (!ok) return;
      setAliasFrom("");
      setAliasTo("");
    });
  }

  function onRemoveAlias(key) {
    if (!window.confirm(`Remove the alias for "${key}"?`)) return;
    const next = { ...aliases };
    delete next[key];
    saveAliases(next, "Alias removed.");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-surface-border bg-white p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-900">City aliases</h3>
        <p className="mb-3 text-xs text-slate-500">
          When an order&apos;s city doesn&apos;t match a PostEx city name exactly (e.g. &quot;Model Town&quot;),
          booking leaves it in Awaiting Assigning. Map that spelling to a PostEx city here. Common short forms
          (isb, pindi, khi, lhr, D.G. Khan, …) are already understood.
        </p>
        <form onSubmit={onAddAlias} className="mb-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Order city says</span>
            <input value={aliasFrom} onChange={(e) => setAliasFrom(e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">PostEx city</span>
            <input
              list="postex-alias-cities"
              value={aliasTo}
              onChange={(e) => setAliasTo(e.target.value)}
              placeholder="Start typing…"
              className={INPUT}
            />
            <datalist id="postex-alias-cities">
              {(cities || []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <Button type="submit" variant="secondary" loading={savingAliases}>
            Add alias
          </Button>
        </form>
        {Object.keys(aliases).length === 0 ? (
          <p className="text-xs text-slate-400">No custom aliases yet.</p>
        ) : (
          <ul className="divide-y divide-surface-border text-sm">
            {Object.entries(aliases).map(([from, to]) => (
              <li key={from} className="flex items-center justify-between py-1.5">
                <span>
                  {from} <span className="text-slate-400">→</span> {to}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAlias(from)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-surface-border bg-white p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">
            PostEx cities {cities ? <span className="font-normal text-slate-400">({cities.length})</span> : null}
          </h3>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a city…"
              className={INPUT}
            />
            <Button variant="secondary" loading={refreshing} onClick={() => load(true)}>
              Refresh
            </Button>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500">No cities match your search.</p>
        ) : (
          <div className="grid max-h-96 grid-cols-2 gap-x-6 gap-y-1 overflow-y-auto sm:grid-cols-3">
            {filtered.map((c) => (
              <div key={c} className="truncate py-1 text-sm text-slate-700">
                {c}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
