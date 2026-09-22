"use client";

import { useState } from "react";
import Dropdown from "../shared/Dropdown";
import { Spinner } from "../shared/Button";
import ordersService from "../../services/ordersService";

const TEMPLATES = [
  { key: "all", label: "All", filename: "orders.csv" },
  { key: "smartlane", label: "Smartlane Template", filename: "orders_smartlane.csv" },
  { key: "leopard", label: "Leopard (Coming Soon)", disabled: true },
  { key: "postex", label: "PostEx (Coming Soon)", disabled: true },
];

export default function CsvExportButton({ filterParams }) {
  const [exporting, setExporting] = useState(false);

  // Deliberately no global loadingStore begin/end here - that fired the
  // full-screen LoadingOverlay on top of this button's own inline Spinner,
  // blocking the whole screen for what should be a quiet background
  // download. The inline spinner below is the only feedback now.
  async function onExport(template, filename) {
    setExporting(true);
    try {
      const blob = await ordersService.exportCsv({ ...filterParams, template });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      // Non-critical - user can retry the export directly.
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dropdown
      align="right"
      disabled={exporting}
      trigger={
        <span className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-surface">
          {exporting ? <Spinner className="text-slate-500" /> : null}
          Export CSV <span className="text-xs">▾</span>
        </span>
      }
      items={TEMPLATES.map((t) => ({
        key: t.key,
        label: t.label,
        disabled: t.disabled,
        onClick: () => onExport(t.key, t.filename),
      }))}
    />
  );
}
