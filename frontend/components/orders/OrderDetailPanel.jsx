"use client";

import { useEffect, useState } from "react";
import Button from "../shared/Button";
import Modal from "../shared/Modal";
import ordersService from "../../services/ordersService";
import CustomerDetailPanel from "./CustomerDetailPanel";
import OrderDetailHeader, { OrderStatusBadge } from "./OrderDetailHeader";
import OrderDetailTabs from "./OrderDetailTabs";
import OrderMoneySummary from "./OrderMoneySummary";
import OrderActionsMenu from "./OrderActionsMenu";
import LineItemsTab from "./tabs/LineItemsTab";
import { draftPayable } from "./orderMoney";
import OrderActionModal from "./OrderActionModal";
import VerifyDispatchModal from "./VerifyDispatchModal";
import StockShortageModal from "./StockShortageModal";
import {
  BOOKING_ACCOUNTS,
  MOVE_TO_ASSIGNING,
  EDITABLE_STATUSES,
  EDIT_LOCKED_STATUSES,
  ASSIGNING_COURIER_ACTIONS,
  ASSIGNING_PRINT_ACTIONS,
  SMARTLANE_LOAD_SHEET_COURIERS,
  isBookingAccountCourier,
  cardTab,
  latestTag,
} from "./statusConfig";
import barqraftarService from "../../app/(tenant)/integrations/barq-raftar/_lib/barqraftarService";
import postexService from "../../app/(tenant)/integrations/postex/_lib/postexService";
import leopardsService from "../../app/(tenant)/integrations/leopards/_lib/leopardsService";

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
  "extra_discount",
  "gift_card_discount",
  "loyalty_amount",
  "wallet_amount",
  "total_tax",
  "donation_amount",
  "shipping_amount",
  "express_stitching_amount",
  "amount_paid",
];

// The money boxes: left empty they mean 0, and any decimal is taken
// (rounded to the 2 places the backend stores).
const AMOUNT_FIELDS = [
  "coupon_discount",
  "extra_discount",
  "gift_card_discount",
  "loyalty_amount",
  "wallet_amount",
  "total_tax",
  "donation_amount",
  "shipping_amount",
  "express_stitching_amount",
  "amount_paid",
];

function toAmount(value) {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

// The fields the line-items write takes - same full-replace shape the
// backend expects (services.update_order_detail recreates every item).
function serializeItem(item) {
  return {
    product_name: item.product_name,
    quantity: Number(item.quantity) || 1,
    unit_price: toAmount(item.unit_price),
    vendor: item.vendor ?? "",
    barcode: item.barcode ?? "",
    compare_at_price: item.compare_at_price ?? null,
    discount_amount: toAmount(item.discount_amount),
    weight_grams: item.weight_grams ?? null,
  };
}

function buildDraft(order) {
  const draft = {};
  EDITABLE_FIELDS.forEach((field) => {
    draft[field] = order[field];
  });
  draft.items = order.items.map((item) => ({ ...item }));
  return draft;
}

// What Save sends: the draft minus the view-only receivable, and items only
// when one actually changed (an untouched list would still be recreated).
function buildPatch(order, draft) {
  const { items, amount_receivable: _receivable, discount_total: _discount, ...fields } = draft;
  const before = JSON.stringify(order.items.map(serializeItem));
  const after = items.map(serializeItem);
  AMOUNT_FIELDS.forEach((field) => {
    if (field in fields) fields[field] = toAmount(fields[field]);
  });
  return JSON.stringify(after) === before ? fields : { ...fields, items: after };
}

// bookingAccounts: the connected entries of statusConfig's BOOKING_ACCOUNTS
// (see connectedBookingAccounts), resolved once by the orders page.
// startEditing: open straight into Edit - Assigning Courier's Edit Order,
// once the booking is cancelled.
// readOnly: opened from All Orders, which is for looking only - no
// Actions and no Edit.
// onRaiseTicket(order): the page's Raise ticket dialog.
export default function OrderDetailPanel({
  orderId,
  couriers,
  bookingAccounts = [],
  startEditing = false,
  readOnly = false,
  onRaiseTicket,
  // (action, order): Assigning Courier's five buttons, run by the Orders
  // page the same way as from its selection bar.
  onAssigningAction,
  onClose,
  onOrderChanged,
}) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [stockShortfall, setStockShortfall] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  // Move to Assigning Courier's booking choices (OrderActionsMenu).
  const [moveChoices, setMoveChoices] = useState([]);
  const [working, setWorking] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  // quiet: refresh the order in place (after an action or edit) instead
  // of swapping the whole panel for "Loading…".
  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const data = await ordersService.get(orderId);
      setOrder(data);
      setDraft(buildDraft(data));
      if (startEditing && !quiet) setEditing(true);
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
    // Amount Receivable (editable while partially paid) isn't a stored
    // field - typing it sets Amount Paid to whatever leaves that much
    // receivable. Any other change drops the typed figure so the cell
    // goes back to being worked out from the draft.
    if (field === "amount_receivable") {
      setDraft((d) => ({
        ...d,
        amount_receivable: value,
        amount_paid: Math.max(draftPayable(d) - (Number(value) || 0), 0).toFixed(2),
      }));
      return;
    }
    // Payment Status sets Amount Paid to match it - nothing typed for
    // another status carries over:
    // - back to the order's saved status: its saved Amount Paid;
    // - Paid: the whole amount payable (then it stays fixed and the
    //   receivable follows any later change);
    // - Pending / Partially Paid: 0, to be typed in for Partially Paid.
    if (field === "payment_status") {
      setDraft((d) => {
        let paid = "0.00";
        if (value === order?.payment_status) paid = toAmount(order.amount_paid);
        else if (value === "paid") paid = draftPayable(d).toFixed(2);
        return { ...d, amount_receivable: undefined, payment_status: value, amount_paid: paid };
      });
      return;
    }
    // Discount: Shopify's part stays as it is - what's typed beyond (or
    // below) it is the OMS discount, which lowers only the receivable.
    if (field === "discount_total") {
      setDraft((d) => ({
        ...d,
        amount_receivable: undefined,
        discount_total: value,
        extra_discount: ((Number(value) || 0) - (Number(d.coupon_discount) || 0)).toFixed(2),
      }));
      return;
    }
    setDraft((d) => ({ ...d, amount_receivable: undefined, [field]: value }));
  }

  function toggleEdit() {
    if (editing) setDraft(buildDraft(order));
    setEditing((e) => !e);
  }

  async function onSave() {
    setSaving(true);
    setError("");
    try {
      const updated = await ordersService.update(orderId, buildPatch(order, draft));
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
    await load({ quiet: true });
    onOrderChanged?.();
  }

  function startAction(action, choices) {
    if (choices) setMoveChoices(choices);
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

    // Same shape as print_airway_bill above - BarqRaftar's labels and our
    // own BarqRaftar load sheet both return a document directly, not a
    // bulk-action mutation.
    if (action === "print_barqraftar_labels" || action === "print_barqraftar_loadsheet") {
      setWorking(true);
      setError("");
      (action === "print_barqraftar_loadsheet"
        ? barqraftarService.printLoadSheet([orderId]).then(refreshAfterChange)
        : barqraftarService.printLabels([orderId]))
        .catch((err) => setError(err.message || "Print failed"))
        .finally(() => setWorking(false));
      return;
    }

    // PostEx's airway bill / load sheet - same interception as the orders
    // page (the load sheet hands the parcel over to PostEx, so it's
    // confirmed first).
    if (action === "print_postex_airway_bill" || action === "print_postex_loadsheet") {
      const isLoadSheet = action === "print_postex_loadsheet";
      if (
        isLoadSheet &&
        !window.confirm("Click to confirm")
      ) {
        return;
      }
      setWorking(true);
      setError("");
      (isLoadSheet
        ? postexService.printLoadSheet([orderId]).then(refreshAfterChange)
        : postexService.printAirwayBills([orderId]))
        .catch((err) => setError(err.message || "Print failed"))
        .finally(() => setWorking(false));
      return;
    }

    // Leopards' airway bill / load sheet - same interception again (its load
    // sheet is the hand-over to Leopards too, so it's confirmed first).
    if (action === "print_leopards_airway_bill" || action === "print_leopards_loadsheet") {
      const isLoadSheet = action === "print_leopards_loadsheet";
      if (
        isLoadSheet &&
        !window.confirm("Click to confirm")
      ) {
        return;
      }
      setWorking(true);
      setError("");
      (isLoadSheet
        ? leopardsService.printLoadSheet([orderId]).then(refreshAfterChange)
        : leopardsService.printAirwayBills([orderId]))
        .catch((err) => setError(err.message || "Print failed"))
        .finally(() => setWorking(false));
      return;
    }

    // Everything else opens OrderActionModal first - to collect its params
    // (its FIELD_BY_ACTION), or just to confirm.
    setPendingAction(action);
  }

  function onSubmitPendingAction(params) {
    // Close the popup right away; the action buttons' spinner (`working`)
    // shows progress and nothing else is blocked meanwhile.
    const action = pendingAction;
    setPendingAction(null);
    // Move to Assigning Courier: run the booking it was asked for - Assign
    // courier (Smartlane / OMS Courier) still asks for its account.
    if (action === MOVE_TO_ASSIGNING) {
      if (params.courier === "assign_courier") setPendingAction("assign_courier");
      else runAction(params.courier, {});
      return;
    }
    runAction(action, params);
  }

  async function runAction(action, params) {
    // Load sheet returns a document, not a bulk-action mutation - same
    // interception the orders page does, needed here too since Smartlane
    // only generates a load sheet for one courier at a time.
    if (action === "print_loadsheet") {
      const courier = params.courier;
      const couriersToPrint =
        courier === "all"
          ? SMARTLANE_LOAD_SHEET_COURIERS.filter((c) => !c.disabled && c.value !== "all").map((c) => c.value)
          : [courier];
      setWorking(true);
      setError("");
      try {
        await ordersService.printSmartlaneLoadSheetForCouriers([orderId], couriersToPrint);
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
      // "OMS Courier" / "Smartlane" are synthetic entries in the courier
      // picker (see the couriers prop below), not real Courier rows -
      // selecting one pushes a booking through that Smartlane account
      // instead of a plain manual courier assignment.
      const bookingAccount =
        action === "assign_courier" && BOOKING_ACCOUNTS.find((a) => a.id === params.courier_id);
      const resolvedAction = bookingAccount ? "push_to_smartlane" : action;
      const resolvedParams = bookingAccount ? { account: bookingAccount.account } : params;

      const { results } = await ordersService.bulkAction({
        action: resolvedAction,
        orderIds: [orderId],
        params: resolvedParams,
      });
      const result = results?.[0];
      if (result && result.error_code === "insufficient_stock") {
        setStockShortfall({ rows: [result], action: resolvedAction, params: resolvedParams });
        await refreshAfterChange();
      } else if (result && !result.success) {
        setError(result.error || "Action failed");
      } else {
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
    // Same as onSubmitPendingAction: close first, then run.
    const { action, params } = stockShortfall;
    setStockShortfall(null);
    setWorking(true);
    try {
      await ordersService.bulkAction({
        action,
        orderIds: [orderId],
        params: { ...params, force: true },
      });
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
        title={
          order ? (
            <span className="flex flex-wrap items-center gap-2">
              Order {order.order_number}
              <OrderStatusBadge order={order} />
            </span>
          ) : (
            "Order detail"
          )
        }
        width="max-w-6xl"
        // The buttons sit in the top bar, beside the order number and
        // status - above the line, not beside the tabs.
        headerRight={
          order && !loading && !readOnly ? (
            // One row - never wraps under itself.
            <div className="flex items-center justify-end gap-2">
              {/* Dispatched or later can't be edited. */}
              {editing ? (
                <>
                  <Button variant="secondary" onClick={toggleEdit} disabled={saving} className="px-3 py-1.5">
                    Cancel Edit
                  </Button>
                  <Button onClick={onSave} loading={saving} className="px-3 py-1.5">
                    Save
                  </Button>
                </>
              ) : EDIT_LOCKED_STATUSES.has(order.status) ? null : (
                <Button variant="secondary" onClick={toggleEdit} className="px-3 py-1.5">
                  Edit
                </Button>
              )}
              {editing ? null : onAssigningAction && order.workflow_card === "assigning_courier" ? (
                // Assigning Courier: the same five as the selection bar, as
                // buttons - no Raise ticket here.
                <>
                  {[...ASSIGNING_PRINT_ACTIONS, ...ASSIGNING_COURIER_ACTIONS].map((a) => (
                    <Button
                      key={a.key}
                      variant={a.action === "cancel" ? "danger" : "secondary"}
                      onClick={() => onAssigningAction(a.action, order)}
                      className="whitespace-nowrap px-2.5 py-1.5 text-[13px]"
                    >
                      {a.label}
                    </Button>
                  ))}
                </>
              ) : (
                <OrderActionsMenu
                  order={order}
                  onAction={startAction}
                  onScan={() => setScanOpen(true)}
                  onRaiseTicket={onRaiseTicket ? () => onRaiseTicket(order) : undefined}
                  working={working}
                />
              )}
            </div>
          ) : null
        }
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
                <OrderDetailTabs
                  order={order}
                  editing={editing}
                  lineItems={
                    <>
                      {/* Items stay locked once a courier is on the order - stock
                          is deducted from then on (see EDITABLE_STATUSES). */}
                      <LineItemsTab
                        order={order}
                        draft={draft}
                        editing={editing && EDITABLE_STATUSES.has(order.status)}
                        onChange={onDraftChange}
                      />
                      <OrderMoneySummary order={order} draft={draft} editing={editing} onChange={onDraftChange} />
                      <OrderDetailHeader order={order} draft={draft} editing={editing} onChange={onDraftChange} />
                    </>
                  }
                />
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <OrderActionModal
        action={pendingAction}
        count={1}
        fromCard={cardTab(order?.workflow_card)?.label}
        currentCourier={order?.courier_name}
        currentTag={order ? latestTag(order) : ""}
        couriers={
          pendingAction === "assign_courier" && bookingAccounts.length
            ? // Booking accounts stay first/default; real courier rows are
              // offered alongside them for a deliberate manual bypass - see
              // the same merge/reasoning on the orders page.
              [
                ...bookingAccounts.map(({ id, name }) => ({ id, name })),
                ...couriers.filter((c) => !isBookingAccountCourier(c)),
              ]
            : couriers
        }
        options={pendingAction === MOVE_TO_ASSIGNING ? moveChoices : undefined}
        onClose={() => setPendingAction(null)}
        onSubmit={onSubmitPendingAction}
      />

      <StockShortageModal
        shortfalls={stockShortfall?.rows}
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
