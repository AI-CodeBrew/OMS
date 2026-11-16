"""Shared by the couriers' airway bill / label / load sheet printing.

A courier only prints its own account's parcels, so a selection is split
into (store, booking account) groups and each group is printed on its own.

`problems`: the Dispatch Hub's print-by-courier passes a list, and then one
bad group never blocks the rest - a group whose account isn't connected, or
whose print the courier refuses, is left out, described in `problems`, and
everything else still prints (oms.views.print_by_courier names them in its
X-Print-Failed header). Without a list (a store printing its own orders),
the first problem is the error, as it always was."""

from rest_framework import status as http_status
from rest_framework.response import Response


def _numbers(shipments_or_numbers):
    numbers = [
        item if isinstance(item, str) else item.order.order_number for item in shipments_or_numbers
    ]
    shown = ", ".join(numbers[:10])
    return shown + (f" (+{len(numbers) - 10} more)" if len(numbers) > 10 else "")


def not_connected_message(courier, via_platform):
    if via_platform:
        return f"FynkTech's {courier} account isn't connected (super admin's OMS Couriers tab)"
    return f"{courier} is not connected"


def group_by_account(shipments, *, courier, connection_for, platform_connection, through_platform=None,
                     problems=None):
    """(groups, error_response). groups: [(organization_id, connection,
    shipments)] in first-seen order.

    through_platform(shipment): whether it was booked through FynkTech's
    account (default: its order's platform_reference). connection_for(
    shipment): the account it was booked through, or None. A parcel that
    looks like the store's own booking while the store has no account of
    its own connected can only have gone through FynkTech's: another
    courier's booking rewrites order.platform_reference, wiping the mark -
    so FynkTech's account is tried for it."""
    through_platform = through_platform or (lambda s: bool(s.order.platform_reference))
    connections, groups, skipped = {}, {}, {}
    for shipment in shipments:
        via_platform = through_platform(shipment)
        key = (str(shipment.organization_id), via_platform)
        if key not in connections:
            connection = connection_for(shipment)
            if connection is None and not via_platform:
                connection = platform_connection()
            connections[key] = connection
        if connections[key] is None:
            skipped.setdefault(via_platform, []).append(shipment)
            continue
        groups.setdefault(key, []).append(shipment)

    messages = [
        f"{not_connected_message(courier, via_platform)} - not printed: {_numbers(left_out)}"
        for via_platform, left_out in skipped.items()
    ]
    if messages and (problems is None or not groups):
        return None, Response({"detail": "; ".join(messages)}, status=http_status.HTTP_404_NOT_FOUND)
    if problems is not None:
        problems.extend(messages)
    return [(key[0], connections[key], group) for key, group in groups.items()], None


def by_shared_account(groups):
    """Load sheets only: group_by_account's (store, account) groups merged by
    account, so the stores booked through one account (FynkTech's, mostly)
    share ONE load sheet - one challan, rows running on from store to store -
    instead of a sheet per store that starts on a fresh, half-empty page.
    Airway bills and labels stay per store. Returns [(organization_ids,
    connection, shipments)] in first-seen order."""
    merged = {}
    for organization_id, connection, shipments in groups:
        pk = getattr(connection, "pk", None)
        key = (type(connection).__name__, pk if pk is not None else id(connection))
        entry = merged.setdefault(key, ([], connection, []))
        if organization_id not in entry[0]:
            entry[0].append(organization_id)
        entry[2].extend(shipments)
    return list(merged.values())


def save_load_sheet(save_print_batch, shipments, *, content, actor_user_id):
    """Files a load sheet PDF for the Batch page. One store's sheet goes into
    that store's history, as always. A sheet shared by several stores
    (by_shared_account) lists every store's customers, so it is kept in
    FynkTech's own (platform) history only - no store sees another's
    orders - while each store's orders still get their Printed Loadsheet
    tag. `save_print_batch`: the courier's own _save_print_batch."""
    import logging

    from core.platform_service import platform_organization_id
    from oms.services import mark_orders_printed

    by_org = {}
    for shipment in shipments:
        by_org.setdefault(str(shipment.organization_id), []).append(shipment.order.order_number)
    if len(by_org) == 1:
        (organization_id, numbers), = by_org.items()
        save_print_batch(
            organization_id=organization_id, order_numbers=numbers,
            content=content, actor_user_id=actor_user_id, kind="loadsheet",
        )
        return
    for organization_id, numbers in by_org.items():
        try:
            mark_orders_printed(organization_id, numbers, "loadsheet", actor_user_id=actor_user_id)
        except Exception:
            logging.getLogger(__name__).exception("failed to mark load sheet printed (%s)", organization_id)
    platform_id = platform_organization_id()
    if platform_id:
        save_print_batch(
            organization_id=platform_id, order_numbers=[n for ns in by_org.values() for n in ns],
            content=content, actor_user_id=actor_user_id, kind="loadsheet", mark_printed=False,
        )


def group_failed(problems, detail, shipments_or_numbers, status=http_status.HTTP_502_BAD_GATEWAY):
    """One group's print failed: with `problems`, noted (naming its orders)
    and None returned so the caller carries on with the next group; without,
    the error response to return."""
    if problems is None:
        return Response({"detail": str(detail)}, status=status)
    problems.append(f"{str(detail).rstrip('. ')} - not printed: {_numbers(shipments_or_numbers)}")
    return None


def nothing_printed(problems):
    """The error when every group failed (problems list given)."""
    return Response({"detail": "; ".join(problems or []) or "Nothing could be printed."},
                    status=http_status.HTTP_502_BAD_GATEWAY)
