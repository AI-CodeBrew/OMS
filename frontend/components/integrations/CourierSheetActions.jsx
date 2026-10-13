"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Button from "../shared/Button";
import couriersService from "../../services/couriersService";
import ordersService from "../../services/ordersService";
import useAuthStore from "../../store/authStore";
import { courierSheet } from "../orders/courierSheets";

// Loaded on first open only - most visits to an integration page never use it.
const ImportOrdersModal = dynamic(() => import("../orders/ImportOrdersModal"), { ssr: false });

function letters(name) {
  return (name || "").toLowerCase().replace(/[^a-z]/g, "");
}

// The store's Courier row for this courier, by the backend's own rule
// (oms/importers.py _canonical_courier): "Burq Raftar" is BarqRaftar, "Post
// Ex" is PostEx, and the canonically named row wins.
function findCourier(couriers, label) {
  const key = letters(label);
  const matches = couriers.filter((c) =>
    key === "barqraftar"
      ? ["barq", "burq"].some((prefix) => letters(c.name).startsWith(prefix))
      : letters(c.name) === key
  );
  return matches.find((c) => c.name === label) || matches[0] || null;
}

// "Import sheet" / "Export orders" on a courier's integration page: import
// reads this courier's own portal export onto the store's orders (see
// ImportOrdersModal), export downloads the store's orders with this courier
// as the Orders page's "All" CSV. Hidden while the page manages FynkTech's
// own account (OMS Couriers) - that org has no orders of its own - and in
// the Dispatch Hub, where a sheet needs a store picked first.
export default function CourierSheetActions({ courier, onNotice, onError }) {
  const actingStore = useAuthStore((s) => s.actingStore);
  const format = courierSheet(courier);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (!format || actingStore?.platform || actingStore?.hub) return null;

  async function onExport() {
    setExporting(true);
    try {
      const match = findCourier(await couriersService.list(), format.label);
      if (!match) {
        onNotice?.(`No ${format.label} orders in OMS yet.`);
        return;
      }
      const blob = await ordersService.exportCsv({ courier_id: match.id, template: "all" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${format.key}_orders.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      onError?.(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => setImportOpen(true)}>
        Import sheet
      </Button>
      <Button variant="secondary" onClick={onExport} loading={exporting}>
        Export orders
      </Button>
      {importOpen ? (
        <ImportOrdersModal
          open
          courier={courier}
          onClose={() => setImportOpen(false)}
          onImported={(result) =>
            onNotice?.(
              `${result.to_update} order${result.to_update === 1 ? "" : "s"} updated from the ${format.label} sheet.`
            )
          }
        />
      ) : null}
    </div>
  );
}
