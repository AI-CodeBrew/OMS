"use client";

import { useEffect, useState } from "react";
import Modal from "../shared/Modal";
import ordersService from "../../services/ordersService";
import CustomerDetailPanel from "./CustomerDetailPanel";
import OrderDetailHeader from "./OrderDetailHeader";
import OrderDetailTabs from "./OrderDetailTabs";
import OrderItemsEditor from "./OrderItemsEditor";
import OrderActionModal from "./OrderActionModal";
import VerifyDispatchModal from "./VerifyDispatchModal";
import StockShortageModal from "./StockShortageModal";
import { ACTIONS_NEEDING_PARAMS, SMARTLANE_LOAD_SHEET_COURIERS } from "./statusConfig";

const EDITABLE_FIELDS = [
  "customer_name",
  "customer_email",
  "customer_phone",
  "secondary_phone",
  "city",
  "country",
  "postal_code",
  "address_line1",
  "address_line2",
  "agent_id",
  "customer_type",
  "cnic",
  "customer_tags",
  "price_conversion_rate",
  "preferred_courier",
  "risk_status",
  "expected_delivery_date",
  "payment_status",
  "order_source",
  "shipping_type",
  "coupon_discount",
  "gift_card_discount",
  "loyalty_amount",
  "wallet_amount",
  "total_tax",
  "donation_amount",
  "shipping_amount",
  "express_stitching_amount",
  "amount_paid",
];

function buildDraft(order) {
  const draft = {};
  EDITABLE_FIELDS.forEach((field) => {
    draft[field] = order[field];
  });
  return draft;
}

export default function OrderDetailPanel({ orderId, couriers, smartlaneConnected, onClose, onOrderChanged }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [stockShortfall, setStockShortfall] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [working, setWorking] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await ordersService.get(orderId);
      setOrder(data);
      setDraft(buildDraft(data));
    } catch (err) {
      setError(err.message || "Failed to load order");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (orderId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  function onDraftChange(field, value) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function toggleEdit() {
    if (editing) setDraft(buildDraft(order));
    setEditing((e) => !e);
  }

  async function onSave() {
    setSaving(true);
    setError("");
    try {
      const updated = await ordersService.update(orderId, draft);
      setOrder(updated);
      setDraft(buildDraft(updated));
      setEditing(false);
      onOrderChanged?.();
    } catch (err) {
      setError(err.message || "Failed to save order");
    } finally {
      setSaving(false);
    }
  }

  async function refreshAfterChange() {
    await load();
    onOrderChanged?.();
  }

  function startAction(action) {
    // Airway bill needs no courier param (Smartlane returns whichever
    // courier actually booked it) - fetch the real document directly,
    // same shortcut the orders page takes, bypassing the bulk-action
    // endpoint entirely since it isn't a real bulk-action on the backend.
    if (action === "print_airway_bill") {
      setWorking(true);
      setError("");
      ordersService
        .printSmartlaneAirwayBill([orderId])
        .catch((err) => setError(err.message || "Print failed"))
        .finally(() => setWorking(false));
      return;
    }

    if (ACTIONS_NEEDING_PARAMS.has(action)) {
      setPendingAction(action);
    } else {
      runAction(action, {});
    }
  }

  async function runAction(action, params) {
    // Load sheet returns a document, not a bulk-action mutation - same
    // interception the orders page does, needed here too since Smartlane
    // only generates a load sheet for one courier at a time.
    if (action === "print_loadsheet") {
      let courier = params.courier;
      if (courier === "all") {
        const enabled = SMARTLANE_LOAD_SHEET_COURIERS.filter((c) => !c.disabled && c.value !== "all");
        if (enabled.length !== 1) {
          setError("More than one courier is enabled - pick a specific courier instead of All.");
          return;
        }
        courier = enabled[0].value;
      }
      setWorking(true);
      setError("");
      try {
        await ordersService.printSmartlaneLoadSheet([orderId], courier);
        setPendingAction(null);
        await refreshAfterChange();
      } catch (err) {
        setError(err.message || "Print failed");
      } finally {
        setWorking(false);
      }
      return;
    }

    setWorking(true);
    setError("");
    try {
      // "Smartlane" is a synthetic entry in the courier picker (see the
      // couriers prop below), not a real Courier row - selecting it pushes
      // a booking to Smartlane instead of a plain manual courier assignment.
      const isSmartlane = action === "assign_courier" && params.courier_id === "smartlane";
      const resolvedAction = isSmartlane ? "push_to_smartlane" : action;
      const resolvedParams = isSmartlane ? {} : params;

      const { results } = await ordersService.bulkAction({
        action: resolvedAction,
        orderIds: [orderId],
        params: resolvedParams,
      });
      const result = results?.[0];
      if (result && result.error_code === "insufficient_stock") {
        setPendingAction(null);
        setStockShortfall({ rows: [result], action: resolvedAction, params: resolvedParams });
        await refreshAfterChange();
      } else if (result && !result.success) {
        setError(result.error || "Action failed");
      } else {
        setPendingAction(null);
        await refreshAfterChange();
      }
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      setWorking(false);
    }
  }

  async function onProceedDespiteShortage() {
    if (!stockShortfall) return;
    setWorking(true);
    try {
      await ordersService.bulkAction({
        action: stockShortfall.action,
        orderIds: [orderId],
        params: { ...stockShortfall.params, force: true },
      });
      setStockShortfall(null);
      await refreshAfterChange();
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Modal
        open={Boolean(orderId)}
        onClose={onClose}
        title={order ? `Order ${order.order_number}` : "Order detail"}
        width="max-w-6xl"
      >
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : error && !order ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : order ? (
          <div>
            {error ? (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="flex gap-6">
              <CustomerDetailPanel order={order} draft={draft} editing={editing} onChange={onDraftChange} />

              <div className="min-w-0 flex-1">
                <OrderDetailHeader
                  order={order}
                  draft={draft}
                  editing={editing}
                  onChange={onDraftChange}
                  onToggleEdit={toggleEdit}
                  onSave={onSave}
                  saving={saving}
                />

                <OrderDetailTabs order={order} onOrderChanged={refreshAfterChange} />

                <OrderItemsEditor
                  order={order}
                  draft={draft}
                  editing={editing}
                  onChange={onDraftChange}
                  onAction={startAction}
                  onScan={() => setScanOpen(true)}
                  working={working}
                />
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <OrderActionModal
        action={pendingAction}
        count={1}
        couriers={
          pendingAction === "assign_courier" && smartlaneConnected
            ? // Manual couriers are hidden while Smartlane is connected -
              // see the same restriction/reasoning on the orders page.
              [{ id: "smartlane", name: "Smartlane" }]
            : couriers
        }
        submitting={working}
        onClose={() => setPendingAction(null)}
        onSubmit={(params) => runAction(pendingAction, params)}
      />

      <StockShortageModal
        shortfalls={stockShortfall?.rows}
        submitting={working}
        onProceed={onProceedDespiteShortage}
        onClose={() => setStockShortfall(null)}
      />

      <VerifyDispatchModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDispatched={refreshAfterChange}
      />
    </>
  );
}
