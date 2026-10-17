"use client";

import { useEffect, useState } from "react";
import wmsService from "../../services/wmsService";
import Modal from "../shared/Modal";
import Button from "../shared/Button";

const EMPTY = { sku: "", product_name: "", price: "", quantity: "0", reorder_level: "0" };

// Mirrors integrations.services MAX_PRODUCT_IMAGES / MAX_PRODUCT_IMAGE_BYTES.
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const inputClass =
  "w-full rounded-md border border-surface-border px-3 py-2 text-sm outline-none focus:border-brand-500";

export default function NewStockItemModal({ open, warehouses, shopifyConnected, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [warehouseId, setWarehouseId] = useState("");
  const [onShopify, setOnShopify] = useState(false);
  const [images, setImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setImages([]);
      setError("");
      setOnShopify(Boolean(shopifyConnected));
      // Default to the org's default warehouse, falling back to the first.
      const preferred = warehouses?.find((w) => w.is_default) || warehouses?.[0];
      setWarehouseId(preferred?.id || "");
    }
  }, [open, warehouses, shopifyConnected]);

  // Object URLs for the thumbnails, released when the selection changes.
  const [previews, setPreviews] = useState([]);
  useEffect(() => {
    const urls = images.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [images]);

  if (!open) return null;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const defaultWarehouse = warehouses?.find((w) => w.is_default) || warehouses?.[0];

  function onPickImages(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    const rejected = picked.filter((f) => !IMAGE_TYPES.includes(f.type) || f.size > MAX_IMAGE_BYTES);
    const accepted = picked.filter((f) => !rejected.includes(f));
    const next = [...images, ...accepted].slice(0, MAX_IMAGES);
    setImages(next);
    if (rejected.length) {
      setError(`Skipped ${rejected.map((f) => f.name).join(", ")} - use JPG, PNG, WEBP or GIF under 5 MB.`);
    } else if (images.length + accepted.length > MAX_IMAGES) {
      setError(`At most ${MAX_IMAGES} images - the extra ones were left out.`);
    } else {
      setError("");
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (onShopify) {
        const result = await wmsService.createStockItemOnShopify({
          sku: form.sku.trim(),
          product_name: form.product_name.trim(),
          price: form.price,
          quantity: parseInt(form.quantity, 10) || 0,
          reorder_level: parseInt(form.reorder_level, 10) || 0,
          images,
        });
        await onCreated?.(
          result.warning || `"${result.item.product_name}" was added here and created on Shopify.`,
          Boolean(result.warning)
        );
      } else {
        await wmsService.createStockItem({
          warehouse: warehouseId,
          sku: form.sku.trim(),
          product_name: form.product_name.trim(),
          quantity: parseInt(form.quantity, 10) || 0,
          reorder_level: parseInt(form.reorder_level, 10) || 0,
        });
        await onCreated?.();
      }
    } catch (err) {
      setError(err.message || "Failed to create stock item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="Add stock item" onClose={onClose}>
      {error ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-4">
        {shopifyConnected ? (
          <label className="flex items-start gap-2 rounded-md border border-surface-border bg-surface px-3 py-2.5">
            <input
              type="checkbox"
              checked={onShopify}
              onChange={(e) => setOnShopify(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">Also create on Shopify</span>
              <span className="block text-xs text-slate-500">
                Creates an active product on your store with this name, SKU, price, stock and
                images.
              </span>
            </span>
          </label>
        ) : null}

        {onShopify ? (
          <p className="text-xs text-slate-500">
            Warehouse: <strong className="text-slate-700">{defaultWarehouse?.name}</strong> (Shopify
            stock always lives in your default warehouse)
          </p>
        ) : (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Warehouse</span>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className={inputClass}
            >
              {(warehouses || []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">
            Product Name {onShopify ? <span className="text-red-500">*</span> : null}
          </span>
          <input
            required={onShopify}
            maxLength={255}
            value={form.product_name}
            onChange={set("product_name")}
            className={inputClass}
          />
        </label>

        <div className="flex gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-700">
              SKU <span className="text-red-500">*</span>
            </span>
            <input required maxLength={100} value={form.sku} onChange={set("sku")} className={inputClass} />
          </label>
          {onShopify ? (
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium text-slate-700">
                Price <span className="text-red-500">*</span>
              </span>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.price}
                onChange={set("price")}
                className={inputClass}
              />
            </label>
          ) : null}
        </div>
        <span className="-mt-2 block text-xs text-slate-400">
          {onShopify
            ? "A code only this product uses, e.g. TSHIRT-M-BLK. Orders find stock by SKU."
            : "Must match the SKU on your Shopify products, so orders can find this stock."}
        </span>

        <div className="flex gap-3">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-700">
              {onShopify ? "Quantity" : "Opening Quantity"}{" "}
              {onShopify ? <span className="text-red-500">*</span> : null}
            </span>
            <input
              required={onShopify}
              type="number"
              min={onShopify ? "0" : undefined}
              value={form.quantity}
              onChange={set("quantity")}
              className={inputClass}
            />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-700">Reorder Level</span>
            <input
              type="number"
              min="0"
              value={form.reorder_level}
              onChange={set("reorder_level")}
              className={inputClass}
            />
          </label>
        </div>

        {onShopify ? (
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-700">
              Images <span className="font-normal text-slate-400">(optional, up to {MAX_IMAGES})</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {previews.map((url, i) => (
                <div key={url} className="relative h-16 w-16 overflow-hidden rounded-md border border-surface-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  {i === 0 ? (
                    <span className="absolute bottom-0 left-0 right-0 bg-slate-900/60 text-center text-[10px] text-white">
                      Main
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() => setImages((list) => list.filter((_, j) => j !== i))}
                    className="absolute right-0.5 top-0.5 rounded-full bg-white/90 px-1.5 text-xs leading-5 text-slate-700 hover:bg-white"
                  >
                    ×
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES ? (
                <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border border-dashed border-surface-border text-xl text-slate-400 hover:border-brand-500 hover:text-brand-700">
                  +
                  <input
                    type="file"
                    accept={IMAGE_TYPES.join(",")}
                    multiple
                    onChange={onPickImages}
                    className="hidden"
                  />
                </label>
              ) : null}
            </div>
            <span className="mt-1 block text-xs text-slate-400">
              JPG, PNG, WEBP or GIF, 5 MB each. The first one is the main image on Shopify.
            </span>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!warehouseId} loading={saving}>
            {onShopify ? "Add & Create on Shopify" : "Add Item"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
