"use client";

import Button from "../shared/Button";
import Dropdown from "../shared/Dropdown";
import { ACTIONS_BY_STATUS, STATUS_LABELS } from "./statusConfig";
import useBarqRaftarStatusStore from "../../app/(tenant)/integrations/barq-raftar/_lib/barqraftarStatusStore";
import { withBarqRaftarActions } from "../../app/(tenant)/integrations/barq-raftar/_lib/orderActions";
import usePostExStatusStore from "../../app/(tenant)/integrations/postex/_lib/postexStatusStore";
import { withPostExActions } from "../../app/(tenant)/integrations/postex/_lib/orderActions";
import { forOrdersBookingAccounts } from "./orderBookingAccount";

// Statuses where dispatch is a live concern - only these offer Scan and
// Download Invoices. Everywhere else they wouldn't do anything meaningful yet.
const DISPATCH_STAGE_STATUSES = new Set(["approved", "awaiting_dispatched", "dispatch_issue"]);

// The order detail's status actions, as one "Actions" dropdown instead of a
// row of buttons - same action list as OrderRowMenu.
export default function OrderActionsMenu({ order, onAction, onScan, working }) {
  const barqraftarConnected = useBarqRaftarStatusStore((s) => s.connected);
  const barqraftarOmsConnected = useBarqRaftarStatusStore((s) => s.omsConnected);
  const postexConnected = usePostExStatusStore((s) => s.connected);
  const postexOmsConnected = usePostExStatusStore((s) => s.omsConnected);
  // Only the documents/actions of the courier this order was booked with.
  const actions = forOrdersBookingAccounts(
    withPostExActions(
      order.status,
      withBarqRaftarActions(
        order.status, ACTIONS_BY_STATUS[order.status] || [], barqraftarConnected, barqraftarOmsConnected
      ),
      postexConnected,
      postexOmsConnected
    ),
    [order]
  );

  // Revert names where it goes ("Revert to Pending COD") and is left out
  // when there's nowhere to go back to - order.previous_status comes with
  // the detail view only.
  const items = actions
    .filter((a) => a.action !== "revert_status" || order.previous_status)
    .map((a) => ({
      key: a.key || a.action,
      label:
        a.action === "revert_status"
          ? `Revert to ${STATUS_LABELS[order.previous_status] || order.previous_status}`
          : a.label,
      disabled: a.disabled,
      onClick: () => onAction(a.action),
    }));
  if (DISPATCH_STAGE_STATUSES.has(order.status)) {
    items.push(
      { key: "dispatch_divider", divider: true },
      { key: "scan", label: "Scan", onClick: onScan },
      { key: "download_invoices", label: "Download Invoices", disabled: true }
    );
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
