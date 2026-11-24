"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../../../components/shared/Button";
import DateInput, { formatDmy } from "../../../components/shared/DateInput";
import Modal from "../../../components/shared/Modal";
import usePageAccess from "../../../lib/usePageAccess";
import receivingsService from "../../../services/receivingsService";

// The three kinds (backend oms.models.Receiving.KIND_CHOICES).
const KINDS = [
  {
    key: "loadsheet",
    label: "Load Sheet Receiving",
    hint: "The courier's signed load sheet / waybills at pickup.",
    courierRequired: true,
  },
  {
    key: "return",
    label: "Return Receiving",
    hint: "Returned parcels as the courier hands them back.",
    courierRequired: true,
  },
  {
    key: "inventory",
    label: "Inventory Receiving",
    hint: "New stock arriving at the warehouse.",
    courierRequired: false,
  },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));
const MAX_IMAGES = 20;
const MAX_BYTES = 15 * 1024 * 1024;

// Today in the browser's own time zone, as yyyy-mm-dd.
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KindIcon({ kind, className = "h-5 w-5" }) {
  const paths = {
    loadsheet: "M6 2.5h6l3 3v12H6v-15ZM12 2.5v3h3M8.5 9h4M8.5 12h4M8.5 15h2.5",
    return: "M8 6 4.5 9.5 8 13M4.5 9.5h8a3.5 3.5 0 0 1 0 7H10",
    inventory: "m10 2.5 6.5 3.25v8.5L10 17.5l-6.5-3.25v-8.5L10 2.5ZM3.5 5.75 10 9l6.5-3.25M10 9v8.5",
  };
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d={paths[kind]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Any picture type (user, 2026-11-23) - the browser's image/* or, when it
// can't tell (HEIC on Windows), the file name. SVG is refused: it can carry
// script. Same rules as the server (oms/receivings_api.py).
const PICTURE_EXT = /\.(jpe?g|jfif|png|webp|gif|bmp|tiff?|avif|heic|heif)$/i;
const SVG_FILE = /\.svgz?$/i;

function pictureProblem(file) {
  if (SVG_FILE.test(file.name) || file.type === "image/svg+xml") {
    return `${file.name} is an SVG file (not allowed)`;
  }
  if (!file.type.startsWith("image/") && !PICTURE_EXT.test(file.name)) return `${file.name} isn't a picture`;
  if (file.size > MAX_BYTES) return `${file.name} is bigger than 15 MB`;
  return "";
}

// A picture, or - for a type this browser can't show (HEIC/TIFF outside
// Safari) - a plain tile with its type, instead of a broken image.
function Picture({ url, name, className = "h-full w-full object-cover" }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    const ext = (name.split(".").pop() || "").toUpperCase().slice(0, 5);
    return (
      <span className="flex h-full w-full flex-col items-center justify-center bg-slate-100 p-1 text-center text-[10px] leading-tight text-slate-500">
        <span className="font-semibold">{ext || "FILE"}</span>
        <span>No preview</span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name} className={className} onError={() => setBroken(true)} />;
}

// The big view: the picture, or a Download link when it can't be shown here.
function PicturePreview({ url, name }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="py-10 text-center text-sm text-slate-600">
        <p>This browser can&apos;t show {name}.</p>
        <a href={url} download={name} className="mt-3 inline-block font-medium text-brand-700 underline">
          Download it
        </a>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      className="mx-auto max-h-[65vh] w-auto rounded-md"
      onError={() => setBroken(true)}
    />
  );
}

// A saved picture: the storage zone is private, so it's fetched with the
// login's headers and shown from a blob: URL.
function Thumb({ image, onOpen }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made = "";
    receivingsService
      .imageUrl(image.id)
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [image.id]);
  return (
    <button
      type="button"
      onClick={() => url && onOpen(url, image.name)}
      title={image.name}
      className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-surface-border bg-slate-100 hover:ring-2 hover:ring-brand-500"
    >
      {url ? (
        <Picture url={url} name={image.name} />
      ) : (
        <span className="text-[10px] text-slate-400">{failed ? "Not found" : "…"}</span>
      )}
    </button>
  );
}

// The popup: courier, pictures from the gallery, optional note.
function ReceivingModal({ kind, couriers, onClose, onSaved }) {
  const meta = KINDS.find((k) => k.key === kind);
  const [courier, setCourier] = useState("");
  // The day the goods came in: today by default, changeable.
  const [receivedOn, setReceivedOn] = useState(todayLocal);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState([]); // [{file, url}]
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  // Previews are freed one by one on Remove, and the rest when the popup closes.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  function onPick(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    setError("");
    const problems = [];
    const ok = picked.filter((file) => {
      const problem = pictureProblem(file);
      if (problem) problems.push(problem);
      return !problem;
    });
    setFiles((list) => {
      const room = MAX_IMAGES - list.length;
      if (ok.length > room) problems.push(`only ${MAX_IMAGES} pictures at a time`);
      return [...list, ...ok.slice(0, Math.max(room, 0)).map((file) => ({ file, url: URL.createObjectURL(file) }))];
    });
    if (problems.length) setError(`Skipped: ${problems.join(", ")}.`);
  }

  function removeFile(index) {
    setFiles((list) => {
      URL.revokeObjectURL(list[index].url);
      return list.filter((_, i) => i !== index);
    });
  }

  async function onSave() {
    if (meta.courierRequired && !courier) {
      setError("Pick a courier.");
      return;
    }
    if (!receivedOn) {
      setError("Pick the date.");
      return;
    }
    if (!files.length) {
      setError("Choose at least one picture.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const data = await receivingsService.create({
        kind,
        courier,
        receivedOn,
        note,
        files: files.map((f) => f.file),
      });
      onSaved(data.receiving);
    } catch (err) {
      setError(err.message || "Couldn't save the pictures");
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={saving ? undefined : onClose}
      title={meta.label}
      width="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} loading={saving} disabled={!files.length}>
            {saving ? "Uploading…" : `Save${files.length ? ` ${files.length} picture${files.length === 1 ? "" : "s"}` : ""}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-slate-700">Date</span>
          <DateInput
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            max={todayLocal()}
            aria-label="Received date"
            className="mt-1 w-full rounded-md border border-surface-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-700">
            Courier{meta.courierRequired ? "" : " (optional)"}
          </span>
          <select
            value={courier}
            onChange={(e) => setCourier(e.target.value)}
            className="mt-1 w-full rounded-md border border-surface-border bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
          >
            <option value="">{meta.courierRequired ? "Select a courier" : "No courier"}</option>
            {couriers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        </div>

        <div>
          <span className="text-xs font-medium text-slate-700">Pictures</span>
          <input ref={inputRef} type="file" accept="image/*" multiple onChange={onPick} className="hidden" />
          {files.length ? (
            <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {files.map((f, i) => (
                <div key={f.url} className="relative aspect-square overflow-hidden rounded-md border border-surface-border">
                  <Picture url={f.url} name={f.file.name} />
                  {!saving ? (
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${f.file.name}`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/70 text-xs text-white hover:bg-slate-900"
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              ))}
              {files.length < MAX_IMAGES && !saving ? (
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center rounded-md border-2 border-dashed border-surface-border text-xs font-medium text-slate-500 hover:border-brand-500 hover:text-brand-700"
                >
                  <span className="text-xl leading-none">+</span>
                  Add more
                </button>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-1 flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-surface-border px-4 py-8 text-sm text-slate-500 hover:border-brand-500 hover:text-brand-700"
            >
              <KindIcon kind={kind} className="h-7 w-7" />
              <span className="font-medium">Choose from gallery</span>
              <span className="text-xs text-slate-400">Any picture - JPG, PNG, WEBP, HEIC… · up to {MAX_IMAGES}, 15 MB each</span>
            </button>
          )}
        </div>

        <label className="block">
          <span className="text-xs font-medium text-slate-700">Note (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. 42 parcels, 2 boxes damaged"
            className="mt-1 w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
        </label>

        {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      </div>
    </Modal>
  );
}

export default function ReceivingsPage() {
  const { canWrite } = usePageAccess("oms.receivings");
  // An organization with several stores sees all of them - with the store's name.
  const [grouped, setGrouped] = useState(false);
  const [receivings, setReceivings] = useState([]);
  const [counts, setCounts] = useState({});
  const [couriers, setCouriers] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openKind, setOpenKind] = useState(null);
  const [preview, setPreview] = useState(null); // {url, name}

  const load = useCallback(async (kind) => {
    setLoading(true);
    setError("");
    try {
      const data = await receivingsService.list(kind);
      setReceivings(data.receivings || []);
      setCounts(data.counts || {});
      setCouriers(data.couriers || []);
      setGrouped(Boolean(data.grouped));
    } catch (err) {
      setError(err.message || "Failed to load receivings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  function onSaved(receiving) {
    setOpenKind(null);
    const n = receiving.images.length;
    setNotice(`${receiving.kind_label}${receiving.courier ? ` · ${receiving.courier}` : ""} - ${n} picture${n === 1 ? "" : "s"} saved.`);
    load(filter);
  }

  async function onRemove(receiving) {
    const n = receiving.images.length;
    if (!window.confirm(`Delete this ${receiving.kind_label} and its ${n} picture${n === 1 ? "" : "s"}?`)) return;
    setError("");
    try {
      await receivingsService.remove(receiving.id);
      setReceivings((list) => list.filter((r) => r.id !== receiving.id));
      setCounts((c) => ({ ...c, [receiving.kind]: Math.max(0, (c[receiving.kind] || 1) - 1) }));
    } catch (err) {
      setError(err.message || "Failed to delete");
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Receivings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pictures of what comes in - load sheets at pickup, returned parcels and new stock.
        </p>
      </div>

      {error ? <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {KINDS.map((kind) => (
          <button
            key={kind.key}
            type="button"
            disabled={!canWrite}
            onClick={() => {
              setNotice("");
              setOpenKind(kind.key);
            }}
            className="group flex flex-col items-start rounded-lg border border-surface-border bg-white p-4 text-left transition enabled:hover:border-brand-500 enabled:hover:shadow-sm disabled:cursor-default"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50 text-brand-800">
              <KindIcon kind={kind.key} />
            </span>
            <span className="mt-3 text-sm font-semibold text-slate-900">{kind.label}</span>
            <span className="mt-0.5 text-xs text-slate-500">{kind.hint}</span>
            <span className="mt-3 flex w-full items-center justify-between text-xs">
              <span className="text-slate-400">{counts[kind.key] || 0} saved</span>
              {canWrite ? <span className="font-medium text-brand-700 group-hover:underline">Add pictures →</span> : null}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-surface-border bg-white">
        <div className="flex flex-wrap gap-1 border-b border-surface-border p-2">
          {[{ key: "", label: "All", count: total }, ...KINDS.map((k) => ({ ...k, count: counts[k.key] || 0 }))].map(
            (tab) => (
              <button
                key={tab.key || "all"}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  filter === tab.key ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {tab.label} <span className="text-xs text-slate-400">{tab.count}</span>
              </button>
            )
          )}
        </div>
        {loading && !receivings.length ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : !receivings.length ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            {canWrite ? "No receivings yet - pick one of the options above to add pictures." : "No receivings yet."}
          </p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {receivings.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      {KIND_LABEL[r.kind] || r.kind_label}
                      {r.courier ? <span className="text-slate-500"> · {r.courier}</span> : null}
                      {grouped && r.store ? (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {r.store}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      Received {formatDmy(r.received_on)} · uploaded {formatDate(r.created_at)}
                      {r.created_by_email ? ` · ${r.created_by_email}` : ""} · {r.images.length} picture
                      {r.images.length === 1 ? "" : "s"}
                    </p>
                    {r.note ? <p className="mt-1 text-sm text-slate-700">{r.note}</p> : null}
                  </div>
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => onRemove(r)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.images.map((image) => (
                    <Thumb key={image.id} image={image} onOpen={(url, name) => setPreview({ url, name })} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openKind ? (
        <ReceivingModal kind={openKind} couriers={couriers} onClose={() => setOpenKind(null)} onSaved={onSaved} />
      ) : null}

      {preview ? (
        <Modal open onClose={() => setPreview(null)} title={preview.name} width="max-w-4xl">
          <PicturePreview url={preview.url} name={preview.name} />
        </Modal>
      ) : null}
    </div>
  );
}
