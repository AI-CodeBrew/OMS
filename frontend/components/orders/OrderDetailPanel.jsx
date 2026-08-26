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
import { ACTIONS_NEEDING_PARAMS } from "./statusConfig";

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

export default function OrderDetailPanel({ orderId, couriers, onClose, onOrderChanged }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
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
    if (ACTIONS_NEEDING_PARAMS.has(action)) {
      setPendingAction(action);
    } else {
      runAction(action, {});
    }
  }

  async function runAction(action, params) {
    setWorking(true);
    setError("");
    try {
      const { results } = await ordersService.bulkAction({ action, orderIds: [orderId], params });
      const result = results?.[0];
      if (result && !result.success) {
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
        couriers={couriers}
        submitting={working}
        onClose={() => setPendingAction(null)}
        onSubmit={(params) => runAction(pendingAction, params)}
      />

      <VerifyDispatchModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDispatched={refreshAfterChange}
      />
    </>
  );
}
