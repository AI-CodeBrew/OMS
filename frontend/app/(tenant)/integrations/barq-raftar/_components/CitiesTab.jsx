"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "../../../../../components/shared/Button";
import barqraftarService from "../_lib/barqraftarService";

export default function CitiesTab({ onError, onNotice }) {
  const [cities, setCities] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  async function load(refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    onError("");
    try {
      const data = await barqraftarService.getCities(refresh);
      setCities(data.cities || []);
      if (refresh) onNotice("City list refreshed from BarqRaftar.");
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
    if (!q) return cities;
    return cities.filter((c) => (c.name || "").toLowerCase().includes(q));
  }, [cities, search]);

  return (
    <div className="rounded-lg border border-surface-border bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Cities</h3>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a city…"
            className="rounded-md border border-surface-border px-3 py-1.5 text-sm outline-none focus:border-brand-500"
          />
          <Button variant="secondary" loading={refreshing} onClick={() => load(true)}>
            Refresh
          </Button>
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-500">
        Used to match an order's city to BarqRaftar's own list when booking. An order whose city text
        doesn't match anything here moves to City Issue instead of being booked blind.
      </p>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No cities match your search.</p>
      ) : (
        <div className="grid max-h-96 grid-cols-2 gap-x-6 gap-y-1 overflow-y-auto sm:grid-cols-3">
          {filtered.map((c) => (
            <div key={c.id} className="truncate py-1 text-sm text-slate-700">
              {c.name}{" "}
              <span className="text-xs text-slate-400">#{c.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
