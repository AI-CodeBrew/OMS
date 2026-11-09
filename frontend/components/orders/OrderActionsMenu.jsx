"use client";

import Button from "../shared/Button";
import Dropdown from "../shared/Dropdown";
import { ACTIONS_BY_STATUS, STATUS_LABELS, withMoveToAssigning } from "./statusConfig";
import useBarqRaftarStatusStore from "../../app/(tenant)/integrations/barq-raftar/_lib/barqraftarStatusStore";
import { withBarqRaftarActions } from "../../app/(tenant)/integrations/barq-raftar/_lib/orderActions";
import usePostExStatusStore from "../../app/(tenant)/integrations/postex/_lib/postexStatusStore";
import { withPostExActions } from "../../app/(tenant)/integrations/postex/_lib/orderActions";
import useLeopardsStatusStore from "../../app/(tenant)/integrations/leopards/_lib/leopardsStatusStore";
import { withLeopardsActions } from "../../app/(tenant)/integrations/leopards/_lib/orderActions";
import { forOrdersBookingAccounts } from "./orderBookingAccount";

// Statuses where dispatch is a live concern - only these offer Scan and
// Download Invoices. Everywhere else they wouldn't do anything meaningful yet.
const DISPATCH_STAGE_STATUSES = new Set(["awaiting_dispatched", "dispatch_issue"]);

// The order detail's status actions, as one "Actions" dropdown instead of a
// row of buttons - same action list as OrderRowMenu. onRaiseTicket adds
// Raise ticket at the end, as the Orders page's Actions menu has it.
export default function OrderActionsMenu({ order, onAction, onScan, onRaiseTicket, working }) {
  const barqraftarConnected = useBarqRaftarStatusStore((s) => s.connected);
  const barqraftarOmsConnected = useBarqRaftarStatusStore((s) => s.omsConnected);
  const postexConnected = usePostExStatusStore((s) => s.connected);
  const postexOmsConnected = usePostExStatusStore((s) => s.omsConnected);
  const leopardsConnected = useLeopardsStatusStore((s) => s.connected);
  const leopardsOmsConnected = useLeopardsStatusStore((s) => s.omsConnected);
  // Only the documents/actions of the courier this order was booked with.
  const actions = withMoveToAssigning(forOrdersBookingAccounts(
    withLeopardsActions(
      order.status,
      withPostExActions(
        order.status,
        withBarqRaftarActions(
          order.status, ACTIONS_BY_STATUS[order.status] || [], barqraftarConnected, barqraftarOmsConnected
        ),
        postexConnected,
        postexOmsConnected
      ),
      leopardsConnected,
      leopardsOmsConnected
    ),
    [order]
  ));

  // Revert names where it goes ("Revert to Pending COD") and is left out
  // when there's nowhere to go back to - order.previous_status comes with
  // the detail view only.
  const items = actions
    .filter((a) => a.action !== "revert_status" || order.previous_status)
    // Shipper Advice is for the Undelivered card only (not a failed attempt
    // already in Return in Transit).
    .filter((a) => a.action !== "shipper_advice" || order.workflow_card === "undelivered")
    .map((a) => ({
      key: a.key || a.action,
      label:
        a.action === "revert_status"
          ? `Revert to ${STATUS_LABELS[order.previous_status] || order.previous_status}`
          : a.label,
      disabled: a.disabled,
      // Move to Assigning Courier's booking choices go along for its popup.
      onClick: () => onAction(a.action, a.choices),
    }));
  if (DISPATCH_STAGE_STATUSES.has(order.status)) {
    items.push(
      { key: "dispatch_divider", divider: true },
      { key: "scan", label: "Scan", onClick: onScan },
      { key: "download_invoices", label: "Download Invoices", disabled: true }
    );
  }
  // A short list (Awaiting Confirmation's Approve / Update Tag / Cancel)
  // shows as buttons; a longer one stays one dropdown.
  if (items.length > 0 && items.length <= 3) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {items.map((item) => (
          <Button
            key={item.key}
            variant={item.key === "cancel" ? "danger" : item.key === "acknowledge" ? "primary" : "secondary"}
            disabled={item.disabled || working}
            onClick={item.onClick}
            className="px-3 py-1.5"
          >
            {item.label}
          </Button>
        ))}
        {onRaiseTicket ? (
          <Button variant="secondary" disabled={working} onClick={onRaiseTicket} className="px-3 py-1.5">
            Raise ticket
          </Button>
        ) : null}
      </div>
    );
  }

  // Nothing to do but raise a ticket: a button, not a one-item menu.
  if (items.length === 0) {
    return onRaiseTicket ? (
      <Button variant="secondary" disabled={working} onClick={onRaiseTicket} className="px-3 py-1.5">
        Raise ticket
      </Button>
    ) : null;
  }

  if (onRaiseTicket) {
    if (items.length) items.push({ key: "ticket_divider", divider: true });
    items.push({ key: "raise_ticket", label: "Raise ticket", onClick: onRaiseTicket });
  }

  if (items.length === 0) return null;

  return (
    <Dropdown
      align="right"
      disabled={working}
      trigger={
        <Button variant="secondary" loading={working} className="px-3 py-1.5">
          Actions ▾
        </Button>
      }
      items={items}
    />
  );
}
