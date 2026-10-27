"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "../../../../components/shared/Button";
import citiesAdminService from "../../../../services/citiesAdminService";

const SOURCE_LABEL = { manual: "Added by hand", postex: "PostEx", barqraftar: "BarqRaftar" };

// The one city list every store's orders are checked against: an order
// whose city isn't on it (e.g. "LHR" for Lahore) can't move to Approved.
// Filled from the couriers' own lists (Import) and by pasting names in.
export default function CitiesAdminPage() {
  const [cities, setCities] = useState([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  const [paste, setPaste] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function apply(data) {
    setCities(data.cities || []);
    setCount(data.count || 0);
  }

  const load = useCallback(async (q) => {
    setLoading(true);
    setError("");
    try {
      apply(await citiesAdminService.list(q));
    } catch (err) {
      setError(err.message || "Failed to load cities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  async function onAdd() {
    if (!paste.trim()) return;
    setAdding(true);
    setError("");
    setNotice("");
    try {
      const data = await citiesAdminService.add(paste);
      setPaste("");
      setSearch("");
      apply(data);
      setNotice(data.added ? `Added ${data.added} new cit${data.added === 1 ? "y" : "ies"}.` : "Those are all on the list already.");
    } catch (err) {
      setError(err.message || "Failed to add cities");
    } finally {
      setAdding(false);
    }
  }

  async function onImport() {
    setImporting(true);
    setError("");
    setNotice("");
    try {
      const data = await citiesAdminService.importFromCouriers();
      setSearch("");
      apply(data);
      const added = Object.entries(data.added || {}).map(([c, n]) => `${c}: ${n} new`);
      const failed = Object.entries(data.errors || {}).map(([c, msg]) => `${c} - ${msg}`);
      setNotice([added.length ? `Imported - ${added.join(", ")}.` : "", failed.join(" ")].filter(Boolean).join(" "));
    } catch (err) {
      setError(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function onRemove(city) {
    if (!window.confirm(`Remove ${city.name} from the city list? Orders with this city won't be approved any more.`)) return;
    setError("");
    try {
      await citiesAdminService.remove(city.id);
      setCities((list) => list.filter((c) => c.id !== city.id));
      setCount((n) => Math.max(0, n - 1));
    } catch (err) {
      setError(err.message || "Failed to remove city");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cities</h1>
          <p className="mt-1 text-sm text-slate-500">
            An order can only be Approved if its city is on this list - e.g. "LHR" is held back until it reads
            "Lahore". {count} cit{count === 1 ? "y" : "ies"} on the list.
          </p>
        </div>
        <Button variant="secondary" loading={importing} onClick={onImport}>
          Import from PostEx / BarqRaftar
        </Button>
      </div>

      {error ? <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_2fr]">
        <div className="rounded-lg border border-surface-border bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">Add cities</h2>
          <p className="mt-0.5 text-xs text-slate-500">One city per line. Names already on the list are skipped.</p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={10}
            placeholder={"Lahore\nKarachi\nIslamabad"}
            className="mt-3 w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <Button className="mt-2" loading={adding} disabled={!paste.trim()} onClick={onAdd}>
            Add to list
          </Button>
        </div>

        <div className="rounded-lg border border-surface-border bg-white">
          <div className="border-b border-surface-border p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cities…"
              className="w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
          </div>
          {loading && !cities.length ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Loading…</p>
          ) : !cities.length ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {search ? "No city matches." : "The list is empty - no order can be Approved until cities are added."}
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-surface-border overflow-y-auto">
              {cities.map((city) => (
                <li key={city.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="text-slate-800">{city.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">{SOURCE_LABEL[city.source] || city.source}</span>
                    <button
                      type="button"
                      onClick={() => onRemove(city)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
