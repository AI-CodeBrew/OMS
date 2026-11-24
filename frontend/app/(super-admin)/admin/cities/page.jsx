"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "../../../../components/shared/Button";
import citiesAdminService from "../../../../services/citiesAdminService";

const SOURCE_LABEL = { manual: "Added by hand", postex: "PostEx", barqraftar: "BarqRaftar", leopards: "Leopards" };

// Misspellings people fixed by hand in Fix Cities (Orders > Awaiting
// Confirmation). Once one is fixed the same way `learnedAfter` times, Fix
// Cities fixes it by itself; Forget removes a wrong one.
function SavedSpellings() {
  const [rows, setRows] = useState([]);
  const [learnedAfter, setLearnedAfter] = useState(2);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await citiesAdminService.listSpellings(q.trim());
        if (cancelled) return;
        setRows(data.spellings || []);
        if (data.learned_after) setLearnedAfter(data.learned_after);
        setError("");
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load spellings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  async function onForget(row) {
    if (!window.confirm(`Forget "${row.typed}" → ${row.city}? Fix Cities will stop using it.`)) return;
    try {
      await citiesAdminService.removeSpelling(row.id);
      setRows((list) => list.filter((r) => r.id !== row.id));
    } catch (err) {
      setError(err.message || "Failed to forget the spelling");
    }
  }

  return (
    <div className="mt-5 rounded-lg border border-surface-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border p-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Saved spellings</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Learned from Fix Cities: a spelling fixed by hand {learnedAfter} times is then fixed automatically.
          </p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search spellings…"
          className="w-56 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
      </div>
      {error ? <div className="m-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {loading && !rows.length ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : !rows.length ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">
          {q ? "No spelling matches." : "Nothing learned yet - it fills up as cities are fixed by hand."}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Typed</th>
              <th className="px-4 py-2 font-medium">Fixed to</th>
              <th className="px-4 py-2 font-medium">Times</th>
              <th className="px-4 py-2 font-medium">Fixed automatically</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2 text-slate-800">{row.typed}</td>
                <td className="px-4 py-2 font-medium text-slate-900">{row.city}</td>
                <td className="px-4 py-2 tabular-nums text-slate-600">{row.times}</td>
                <td className="px-4 py-2">
                  {row.automatic ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Yes</span>
                  ) : (
                    <span className="text-xs text-slate-400">Suggested only</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button type="button" onClick={() => onForget(row)} className="text-xs font-medium text-red-600 hover:underline">
                    Forget
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// The one city list every store's orders are checked against: an order
// whose city isn't on it (e.g. "LHR" for Lahore) can't move to Approved.
// Filled from the couriers' own lists (Import) and by pasting names in.
export default function CitiesAdminPage() {
  const [cities, setCities] = useState([]);
  const [count, setCount] = useState(0);
  const [search, setSearch] = useState("");
  // "" = every city, "missing" = no province yet, else one province.
  const [provinceFilter, setProvinceFilter] = useState("");
  const [provinces, setProvinces] = useState([]);
  const [missing, setMissing] = useState(0);
  const [paste, setPaste] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function apply(data) {
    setCities(data.cities || []);
    setCount(data.count || 0);
    if (data.provinces) setProvinces(data.provinces);
    if (data.missing_province !== undefined) setMissing(data.missing_province);
  }

  const load = useCallback(async (q, province) => {
    setLoading(true);
    setError("");
    try {
      apply(await citiesAdminService.list(q, province));
    } catch (err) {
      setError(err.message || "Failed to load cities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(search.trim(), provinceFilter), 250);
    return () => clearTimeout(t);
  }, [search, provinceFilter, load]);

  // The orders report's Province column reads this - "Unknown" while blank.
  async function onProvince(city, province) {
    setError("");
    const before = city.province;
    setCities((list) => list.map((c) => (c.id === city.id ? { ...c, province } : c)));
    try {
      await citiesAdminService.setProvince(city.id, province);
      setMissing((n) => n + (before ? 0 : -1) + (province ? 0 : 1));
    } catch (err) {
      setCities((list) => list.map((c) => (c.id === city.id ? { ...c, province: before } : c)));
      setError(err.message || "Failed to save province");
    }
  }

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
          <p className="mt-1 text-sm text-slate-500">
            Each city's Province is what the orders report shows.{" "}
            {missing ? (
              <button
                type="button"
                onClick={() => setProvinceFilter("missing")}
                className="font-medium text-amber-700 hover:underline"
              >
                {missing} cit{missing === 1 ? "y has" : "ies have"} no province yet
              </button>
            ) : (
              <span className="text-emerald-700">Every city has a province.</span>
            )}
          </p>
        </div>
        <Button variant="secondary" loading={importing} onClick={onImport}>
          Import from PostEx / BarqRaftar / Leopards
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
          <div className="flex gap-2 border-b border-surface-border p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cities…"
              className="min-w-0 flex-1 rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <select
              value={provinceFilter}
              onChange={(e) => setProvinceFilter(e.target.value)}
              className="rounded-md border border-surface-border px-2 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value="">All Provinces</option>
              <option value="missing">No Province</option>
              {provinces.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {loading && !cities.length ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Loading…</p>
          ) : !cities.length ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {search || provinceFilter
                ? "No city matches."
                : "The list is empty - no order can be Approved until cities are added."}
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-surface-border overflow-y-auto">
              {cities.map((city) => (
                <li key={city.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 truncate text-slate-800">{city.name}</span>
                  <span className="flex shrink-0 items-center gap-3">
                    <select
                      value={city.province || ""}
                      onChange={(e) => onProvince(city, e.target.value)}
                      className={`rounded-md border px-2 py-1 text-xs outline-none focus:border-brand-500 ${
                        city.province ? "border-surface-border text-slate-700" : "border-amber-300 bg-amber-50 text-amber-800"
                      }`}
                    >
                      <option value="">No Province</option>
                      {provinces.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
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

      <SavedSpellings />
    </div>
  );
}
