"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import ordersService from "../../../services/ordersService";
import { connectOrdersSocket } from "../../../lib/ordersSocket";
import {
  dashboardPresetKeys,
  getCachedCounts,
  getCachedOrdersList,
  invalidateViewCache,
  ordersListKey,
  setCachedCounts,
  setCachedOrdersList,
  unfilteredListsAreWarm,
} from "../../../lib/viewCache";
import { warmupViewsInBackground } from "../../../lib/warmupViews";
import couriersService from "../../../services/couriersService";
import integrationsService from "../../../services/integrationsService";
import dispatchHubAdminService from "../../../services/dispatchHubAdminService";
import useLoadingStore from "../../../store/loadingStore";
import { useEffectiveUser } from "../../../store/authStore";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";
import OrderStatusTabs from "../../../components/orders/OrderStatusTabs";
import OrdersToolbar from "../../../components/orders/OrdersToolbar";
import OrdersTable from "../../../components/orders/OrdersTable";
import HubOrderFilters from "../../../components/orders/HubOrderFilters";
import CsvExportButton from "../../../components/orders/CsvExportButton";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";
import {
  ACTIONS_BY_STATUS,
  ASSIGNING_COURIER_ACTIONS,
  ASSIGNING_COURIER_TAB,
  BOOKING_ACCOUNTS,
  SMARTLANE_LOAD_SHEET_COURIERS,
  STATUS_LABELS,
  STATUS_TABS,
  connectedBookingAccounts,
  isBookingAccountCourier,
  orderInTab,
} from "../../../components/orders/statusConfig";
// BarqRaftar's own service/status-store/action-list - kept inside its own
// feature folder rather than the shared services/ files above; see that
// folder for everything else BarqRaftar.
import barqraftarService from "../integrations/barq-raftar/_lib/barqraftarService";
import useBarqRaftarStatusStore from "../integrations/barq-raftar/_lib/barqraftarStatusStore";
import { withBarqRaftarActions } from "../integrations/barq-raftar/_lib/orderActions";
// PostEx's own service/status-store/action-list - same arrangement as
// BarqRaftar's just above, kept inside integrations/postex/.
import postexService from "../integrations/postex/_lib/postexService";
import usePostExStatusStore from "../integrations/postex/_lib/postexStatusStore";
import { withPostExActions } from "../integrations/postex/_lib/orderActions";
import { forOrdersBookingAccounts } from "../../../components/orders/orderBookingAccount";

// Modals/panels only ever render once opened (each returns null while
// closed) - loading them on demand instead of bundling them into the
// initial page load keeps the Orders page's first paint lean, since most
// visits never touch most of these.
const OrderActionModal = dynamic(() => import("../../../components/orders/OrderActionModal"), {
  ssr: false,
});
const StockShortageModal = dynamic(() => import("../../../components/orders/StockShortageModal"), {
  ssr: false,
});
const AirwayBillFilterModal = dynamic(() => import("../../../components/orders/AirwayBillFilterModal"), {
  ssr: false,
});
const NewOrderModal = dynamic(() => import("../../../components/orders/NewOrderModal"), {
  ssr: false,
});
const ImportOrdersModal = dynamic(() => import("../../../components/orders/ImportOrdersModal"), {
  ssr: false,
});
const ImportNewOrdersModal = dynamic(
  () => import("../../../components/orders/ImportNewOrdersModal"),
  { ssr: false }
);
const OrderDetailPanel = dynamic(() => import("../../../components/orders/OrderDetailPanel"), {
  ssr: false,
});
const PrintByCourierModal = dynamic(() => import("../../../components/orders/PrintByCourierModal"), {
  ssr: false,
});
const CreateTicketDialog = dynamic(() => import("../../../components/tickets/CreateTicketDialog"), {
  ssr: false,
});
const ScanPackModal = dynamic(() => import("../../../components/orders/ScanPackModal"), {
  ssr: false,
});

// store: comma-separated store ids; product: a JSON array of product names
// (a name can contain a comma) - both Dispatch Hub only, set by
// HubOrderFilters.
const EMPTY_FILTERS = {
  city: "", courier_id: "", gateway: "", date_from: "", date_to: "", store: "", product: "", dispatch_requested: "",
};
// "critical" is time-dependent rather than a status an order is moved into,
// so the backend never caches it or includes it in the warmup - leave it
// out of the "is every tab warm" check, and out of the list cache below.
const CRITICAL_TAB = "critical";
const TAB_STATUSES = STATUS_TABS.map((tab) => tab.value).filter((v) => v !== CRITICAL_TAB);
const IN_TRANSIT_STATUSES = new Set(["dispatched"]);
// Tabs from booking on - where the courier's own word for where the parcel
// is (its Sub Status) tells apart orders that share one of our statuses.
const SUB_STATUS_TABS = new Set([
  "card:assigning_courier", "card:dispatched", "card:undelivered", "card:delivered",
  "card:return_in_transit", "card:returned", "card:cancelled", CRITICAL_TAB,
  "booking_pending", "ready_to_print", "ready_to_pick", "awaiting_dispatched",
  "dispatched", "out_for_delivery", "attempt", "delivered", "cancelled", "returned",
]);

function isPlainTabQuery(queryParams) {
  return (
    !queryParams.search &&
    !queryParams.city &&
    !queryParams.courier_id &&
    !queryParams.gateway &&
    !queryParams.date_from &&
    !queryParams.date_to &&
    !queryParams.store &&
    !queryParams.product &&
    !queryParams.dispatch_requested
  );
}

// Patches one order in/out of/within `list` - a pure function (no state
// reads/writes) so a whole WebSocket batch can be folded over one fresh
// `prev` inside a single setOrders updater, rather than each item risking
// acting on a stale array if several land in the same flush.
function applyPatchToList(list, freshOrder, view) {
  const onCriticalTab = view.activeStatus === CRITICAL_TAB;
  // The Critical tab holds Dispatched (In Transit) orders: one stays while
  // it is still Dispatched, and leaves once the courier moves it on (Out for
  // Delivery, Delivered, ...). A pushed row has no age (in_transit_days
  // comes only with the tab's own list), so the row's existing one is kept,
  // and nothing is ever inserted - whether a new arrival is 3 days old is
  // for the next reload to say.
  const matchesTab = onCriticalTab
    ? IN_TRANSIT_STATUSES.has(freshOrder.status)
    : orderInTab(freshOrder, view.activeStatus);
  const noOtherFilters =
    !view.appliedSearch && Object.values(view.appliedFilters).every((v) => !v);
  const idx = list.findIndex((o) => o.id === freshOrder.id);

  if (idx !== -1) {
    if (matchesTab) {
      const next = list.slice();
      next[idx] = onCriticalTab
        ? { ...freshOrder, in_transit_days: list[idx].in_transit_days }
        : freshOrder;
      return { list: next, delta: 0 };
    }
    const next = list.slice();
    next.splice(idx, 1);
    return { list: next, delta: -1 };
  }
  // Only insert the narrow, unambiguous case - page 1, this tab, no
  // search/city/courier/gateway/date filter active. Anything more (mid
  // pagination, filters applied) would need replicating the backend's full
  // filter matching client-side just to decide, which isn't worth the risk
  // of drifting out of sync - it shows up on the next reload there instead,
  // same as before this existed.
  if (matchesTab && !onCriticalTab && view.page === 1 && noOtherFilters) {
    return { list: [freshOrder, ...list].slice(0, view.pageSize), delta: 1 };
  }
  return { list, delta: 0 };
}

// The bulk-action endpoint reports per-order outcomes with HTTP 200, so
// rejections have to be pulled out of the body and shown explicitly.
function describeFailures(failed) {
  const shown = failed
    .slice(0, 3)
    .map((r) => `${r.order_number || r.order_id}: ${r.error || "failed"}`)
    .join("; ");
  const rest = failed.length > 3 ? ` (+${failed.length - 3} more)` : "";
  return `${failed.length} order${failed.length === 1 ? "" : "s"} could not be updated - ${shown}${rest}`;
}

export default function OrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const beginLoading = useLoadingStore((s) => s.begin);
  const endLoading = useLoadingStore((s) => s.end);
  const user = useEffectiveUser();

  const [activeStatus, setActiveStatusState] = useState(() => searchParams.get("status") || "all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  // A dashboard card links here with its date range (and its statuses as
  // the tab) - read once on arrival; after that the date filter is the
  // user's to change.
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    date_from: searchParams.get("date_from") || "",
    date_to: searchParams.get("date_to") || "",
  }));
  const [appliedFilters, setAppliedFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    date_from: searchParams.get("date_from") || "",
    date_to: searchParams.get("date_to") || "",
  }));
  const fromDashboard = searchParams.get("from") === "dashboard";
  const dashboardGroup = searchParams.get("group") || "";

  const [orders, setOrders] = useState([]);
  const [orderCount, setOrderCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [counts, setCounts] = useState(() => getCachedCounts());
  const [couriers, setCouriers] = useState([]);
  const [smartlaneConnected, setSmartlaneConnected] = useState(false);
  const [omsCourierConnected, setOmsCourierConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());

  const [newOrderOpen, setNewOrderOpen] = useState(false);
  // The order a row's "Recreate order" copies into the Manual Order form.
  const [recreateFrom, setRecreateFrom] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importOrdersOpen, setImportOrdersOpen] = useState(false);
  const [hubStoreOptions, setHubStoreOptions] = useState(null);
  // This store is on the Dispatch Hub, so it may send orders to FynkTech to ship.
  const [inDispatchHub, setInDispatchHub] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // { action, orderIds }
  const [airwayBillFilterOrders, setAirwayBillFilterOrders] = useState(null);
  // { kind: "loadsheet" | "airway_bill", orders } - the bulk print buttons'
  // "which courier?" picker.
  const [printRequest, setPrintRequest] = useState(null);
  // Set when a push-to-Smartlane was rejected for lack of stock - holds the
  // per-order shortage detail plus the ids to retry with force=true.
  const [stockShortfall, setStockShortfall] = useState(null);
  const [detailOrderId, setDetailOrderId] = useState(null);
  // Edit Order opens the order straight into Edit once its booking is cancelled.
  const [detailStartEditing, setDetailStartEditing] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [ticketOrder, setTicketOrder] = useState(null);
  const reloadTimer = useRef(null);
  const loadGen = useRef(0);
  // Read by the WebSocket patch callbacks below, which need the *current*
  // tab/page/filters at the moment a message arrives but must not force the
  // socket effect to reconnect every time the user changes any of them (see
  // that effect's dependency array).
  const viewRef = useRef({ activeStatus, page, pageSize, appliedSearch, appliedFilters });
  useEffect(() => {
    viewRef.current = { activeStatus, page, pageSize, appliedSearch, appliedFilters };
  }, [activeStatus, page, pageSize, appliedSearch, appliedFilters]);

  // The contextual sidebar links to /orders?status=... - stay in sync when
  // navigation changes the URL externally (not just on first mount).
  useEffect(() => {
    setActiveStatusState(searchParams.get("status") || "all");
  }, [searchParams]);

  function setActiveStatus(status) {
    setActiveStatusState(status);
    const params = new URLSearchParams(searchParams.toString());
    if (status === "all") params.delete("status");
    else params.set("status", status);
    // Picking a tab leaves the dashboard card's view (its label would no
    // longer be true); the date filter it set stays as the user's filter.
    params.delete("group");
    params.delete("date_from");
    params.delete("date_to");
    router.replace(`/orders${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const queryParams = useMemo(
    () => ({
      status: activeStatus === "all" ? undefined : activeStatus,
      search: appliedSearch || undefined,
      // One box searches order no., customer, phone, product, SKU,
      // tracking and city at once (backend: search_field "all").
      search_field: appliedSearch ? "all" : undefined,
      ...appliedFilters,
    }),
    [activeStatus, appliedSearch, appliedFilters]
  );

  // Newest order first - by when it was placed (Shopify's own date),
  // falling back to when it reached OMS.
  const sortedOrders = useMemo(
    () =>
      [...orders].sort(
        (a, b) =>
          new Date(b.placed_at || b.created_at || 0).getTime() -
          new Date(a.placed_at || a.created_at || 0).getTime()
      ),
    [orders]
  );

  // A pushed counts frame is one store's unfiltered counts - right only for
  // a single store's plain view. The Dispatch Hub (several stores) or any
  // filter re-fetches its own counts instead of taking it.
  const pushedCountsFitRef = useRef(true);
  const queryParamsRef = useRef(queryParams);
  useEffect(() => {
    queryParamsRef.current = queryParams;
    pushedCountsFitRef.current = !user?.isDispatchHub && isPlainTabQuery(queryParams);
  }, [queryParams, user?.isDispatchHub]);
  const countsTimer = useRef(null);

  // Any filter change invalidates the current page.
  useEffect(() => {
    setPage(1);
  }, [queryParams]);

  const applyCachedTab = useCallback(
    (keepSelection = false) => {
      const key = ordersListKey({
        status: queryParams.status,
        page,
        pageSize,
        filters: queryParams,
      });
      const cachedList = getCachedOrdersList(key);
      const cachedCounts = getCachedCounts();
      if (cachedList) {
        setOrders(cachedList.orders);
        setOrderCount(cachedList.orderCount);
      }
      if (cachedCounts && isPlainTabQuery(queryParams)) setCounts(cachedCounts);
      if (!keepSelection) setSelectedIds(new Set());
      return Boolean(cachedList);
    },
    [queryParams, page, pageSize]
  );

  const load = useCallback(async (opts = {}) => {
    const gen = ++loadGen.current;
    const force = opts.force === true;
    const plain = isPlainTabQuery(queryParams);
    const cacheable = queryParams.status !== CRITICAL_TAB;
    const key = ordersListKey({
      status: queryParams.status,
      page,
      pageSize,
      filters: queryParams,
    });
    setError("");

    if (plain) {
      const alreadyWarm = unfilteredListsAreWarm(pageSize, TAB_STATUSES);
      if (!force && alreadyWarm && cacheable && getCachedOrdersList(key)) {
        applyCachedTab();
        setLoading(false);
        return;
      }
      if (!force) {
        setOrders([]);
        setOrderCount(0);
        if (!alreadyWarm) setCounts(null);
        setSelectedIds(new Set());
        setLoading(true);
      }
      try {
        // Fetch only the tab actually on screen, then paint. This used to
        // await warmupViews() first, which loads all 17 status tabs in one
        // backend request - fine once warm, but on a cold Redis it is ~51
        // sequential queries and the user stared at a spinner for the whole
        // thing before seeing a single row.
        const [orderData, countData] = await Promise.all([
          ordersService.list({ ...queryParams, page, page_size: pageSize }),
          ordersService.counts(queryParams),
        ]);
        if (gen !== loadGen.current) return;
        const nextOrders = orderData.results || [];
        const nextCount = orderData.count || 0;
        setOrders(nextOrders);
        setOrderCount(nextCount);
        setCounts(countData);
        if (cacheable) setCachedOrdersList(key, { orders: nextOrders, orderCount: nextCount });
        setCachedCounts(countData);
        if (!force) setSelectedIds(new Set());
      } catch (err) {
        if (gen !== loadGen.current) return;
        setError(err.message || "Failed to load orders");
      } finally {
        if (gen === loadGen.current) setLoading(false);
      }

      // The other tabs still get warmed - just after the user has something
      // to look at rather than before. Started even when this generation is
      // stale: the payload is keyed by pageSize, not by which tab asked, so
      // the work is still the work everyone needs.
      if (force || !alreadyWarm) {
        warmupViewsInBackground({ pageSize, dashKeys: dashboardPresetKeys() });
      }
      return;
    }

    if (!force) {
      const cachedList = cacheable ? getCachedOrdersList(key) : null;
      if (cachedList) {
        setOrders(cachedList.orders);
        setOrderCount(cachedList.orderCount);
        setSelectedIds(new Set());
        setLoading(false);
        return;
      }
      setOrders([]);
      setOrderCount(0);
      setSelectedIds(new Set());
      setLoading(true);
    }
    try {
      const [orderData, countData] = await Promise.all([
        ordersService.list({ ...queryParams, page, page_size: pageSize }),
        ordersService.counts(queryParams),
      ]);
      if (gen !== loadGen.current) return;
      setOrders(orderData.results || []);
      setOrderCount(orderData.count || 0);
      setCounts(countData);
      if (!force) setSelectedIds(new Set());
      if (cacheable) {
        setCachedOrdersList(key, { orders: orderData.results || [], orderCount: orderData.count || 0 });
      }
      warmupViewsInBackground({ pageSize, dashKeys: dashboardPresetKeys() });
    } catch (err) {
      if (gen !== loadGen.current) return;
      setError(err.message || "Failed to load orders");
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [applyCachedTab, queryParams, page, pageSize]);

  const reloadAfterChange = useCallback(() => {
    invalidateViewCache();
    return load({ force: true });
  }, [load]);

  // Applies every order a WebSocket flush carried, without refetching -
  // used when the push already included fresh rows (see the socket effect
  // below). Identity never changes (only reads viewRef/uses stable setState
  // functions) so it's safe to list in that effect's deps.
  const applyOrderPatches = useCallback((freshOrders) => {
    const view = viewRef.current;
    let totalDelta = 0;
    setOrders((prev) => {
      let next = prev;
      for (const freshOrder of freshOrders) {
        const result = applyPatchToList(next, freshOrder, view);
        next = result.list;
        totalDelta += result.delta;
      }
      return next;
    });
    if (totalDelta !== 0) {
      setOrderCount((c) => Math.max(0, c + totalDelta));
    }
  }, []);

  // The backend's WebSocket push carries the per-status counts only - the
  // Critical count changes with the clock, not with orders, so it is kept
  // from the last fetch rather than wiped by each push.
  const applyCountsPatch = useCallback((counts) => {
    const critical = counts.critical ?? getCachedCounts()?.critical;
    const merged = critical === undefined ? counts : { ...counts, critical };
    setCounts((prev) =>
      merged.critical === undefined && prev?.critical !== undefined
        ? { ...merged, critical: prev.critical }
        : merged
    );
    setCachedCounts(merged);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user?.isDispatchHub) return;
    dispatchHubAdminService
      .listStores()
      .then((stores) => setHubStoreOptions(stores.map((s) => ({ id: s.id, name: s.name }))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.isDispatchHub]);

  useEffect(() => {
    if (user?.isDispatchHub) return;
    ordersService.isInDispatchHub().then(setInDispatchHub).catch(() => {});
  }, [user?.isDispatchHub]);

  useEffect(() => {
    couriersService.list().then(setCouriers).catch(() => {});
    integrationsService
      .getSmartlaneStatus()
      .then((d) => setSmartlaneConnected(Boolean(d.connected)))
      .catch(() => {});
    integrationsService
      .getOmsCourierOnboarding()
      .then((d) => setOmsCourierConnected(Boolean(d.live)))
      .catch(() => {});
    barqraftarService
      .getStatus()
      .then((d) => useBarqRaftarStatusStore.getState().setStatus(d))
      .catch(() => {});
    postexService
      .getStatus()
      .then((d) => usePostExStatusStore.getState().setStatus(d))
      .catch(() => {});
  }, []);

  // Live updates: the backend pushes a message here the moment an order is
  // created/updated (Shopify webhook, manual edit, status change, ...)
  // instead of us waiting for a manual click/reload. See lib/ordersSocket.js
  // and backend/core/{consumers,realtime}.py.
  //
  // Each flush is a batch of frames (ordersSocket.js coalesces bursts, not
  // individual pushes). A frame that already carries a fresh `order` (and
  // usually `counts`) - status changes, tracking-only updates - gets patched
  // in place with no refetch. Anything else (new orders, or the backend's
  // own failure fallback when it couldn't serialize a row) still falls back
  // to the original debounced full reload, unchanged.
  useEffect(() => {
    const cleanup = connectOrdersSocket((batch) => {
      const patchable = [];
      let latestCounts = null;
      let needsFullReload = false;

      for (const frame of batch) {
        if (frame?.order) {
          patchable.push(frame.order);
          if (frame.counts) latestCounts = frame.counts;
        } else {
          needsFullReload = true;
        }
      }

      if (patchable.length > 0) applyOrderPatches(patchable);
      if (latestCounts && pushedCountsFitRef.current) {
        applyCountsPatch(latestCounts);
      } else if (latestCounts) {
        clearTimeout(countsTimer.current);
        countsTimer.current = setTimeout(() => {
          ordersService.counts(queryParamsRef.current).then(setCounts).catch(() => {});
        }, 500);
      }

      if (needsFullReload) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(() => {
          reloadAfterChange();
        }, 300);
      }
    });
    return () => {
      clearTimeout(reloadTimer.current);
      clearTimeout(countsTimer.current);
      cleanup();
    };
  }, [reloadAfterChange, applyOrderPatches, applyCountsPatch]);

  function onToggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onToggleSelectAll(visibleOrders) {
    setSelectedIds((prev) => {
      const allSelected = visibleOrders.every((o) => prev.has(o.id));
      if (allSelected) return new Set();
      return new Set(visibleOrders.map((o) => o.id));
    });
  }

  const selectedOrders = useMemo(
    () => orders.filter((o) => selectedIds.has(o.id)),
    [orders, selectedIds]
  );

  const barqraftarConnected = useBarqRaftarStatusStore((s) => s.connected);
  const barqraftarOmsConnected = useBarqRaftarStatusStore((s) => s.omsConnected);
  const postexConnected = usePostExStatusStore((s) => s.connected);
  const postexOmsConnected = usePostExStatusStore((s) => s.omsConnected);

  // Memoized so OrderDetailPanel gets a stable prop between renders. The
  // per-org "is X connected" checks these come from don't mean anything
  // for the Dispatch Hub (no single org to check) - booking there always
  // offers both and lets the per-order push fail with a clear reason for
  // whichever store hasn't actually connected that account (see
  // push_order_to_smartlane).
  const bookingAccounts = useMemo(
    () =>
      user?.isDispatchHub
        ? connectedBookingAccounts({ smartlaneConnected: true, omsCourierConnected: true })
        : connectedBookingAccounts({ smartlaneConnected, omsCourierConnected }),
    [user?.isDispatchHub, smartlaneConnected, omsCourierConnected]
  );

  const availableActions = useMemo(() => {
    if (selectedOrders.length === 0) return [];
    // Each courier's own actions are only offered when a selected order was
    // booked with it. Where the plain Print Loadsheet / Print Airway Bill are
    // on offer they already ask which courier (see PrintByCourierModal), so
    // the couriers' own copies of those documents are left out as duplicates;
    // in statuses without the plain ones (Ready to Pick, ...) they stay.
    const actionsFor = (status) =>
      forOrdersBookingAccounts(
        withPostExActions(
          status,
          withBarqRaftarActions(
            status, ACTIONS_BY_STATUS[status] || [], barqraftarConnected, barqraftarOmsConnected
          ),
          postexConnected,
          postexOmsConnected
        ),
        selectedOrders,
        ["print_loadsheet", "print_airway_bill"]
      );
    // Booking Pending and Awaiting Dispatched list orders of more than one
    // status (Ready to Print beside them) - a mixed selection gets the
    // actions every one of its statuses offers.
    const keyOf = (a) => a.key || a.action;
    const [first, ...rest] = Array.from(new Set(selectedOrders.map((o) => o.status))).map(actionsFor);
    const actions = rest.reduce(
      (common, list) => common.filter((a) => list.some((b) => keyOf(b) === keyOf(a))),
      first
    );
    const covered = new Set();
    if (actions.some((a) => a.action === "print_airway_bill")) {
      covered.add("print_barqraftar_labels").add("print_postex_airway_bill");
    }
    if (actions.some((a) => a.action === "print_loadsheet")) {
      covered.add("print_barqraftar_loadsheet").add("print_postex_loadsheet");
      // Ready to Print's bulk list stays at its five plain actions; a
      // courier's pickup notice is still on each order's own menu.
      covered.add("barqraftar_ready_for_pickup");
    }
    const plain = actions.filter((a) => !covered.has(a.action));
    // All in Assigning Courier: its own Cancel / Change Courier / Edit Order
    // come first, then whatever the statuses offer (printing, load sheet,
    // ...), whichever status each order has within the card.
    if (selectedOrders.every((o) => o.workflow_card === "assigning_courier")) {
      const rest = plain.filter((a) => a.action !== "cancel");
      return [
        ...ASSIGNING_COURIER_ACTIONS,
        ...(rest.length ? [{ key: "assigning_courier_divider", divider: true }, ...rest] : []),
      ];
    }
    return plain;
  }, [selectedOrders, barqraftarConnected, barqraftarOmsConnected, postexConnected, postexOmsConnected]);

  // Change Courier's picker: every courier this store can book with right
  // now. Values are the backend's CHANGE_COURIER_TARGETS keys.
  const changeCourierOptions = useMemo(
    () => [
      ...bookingAccounts.map((a) => ({ value: a.id, label: a.name })),
      ...(barqraftarConnected ? [{ value: "barqraftar", label: "BarqRaftar" }] : []),
      ...(barqraftarOmsConnected ? [{ value: "barqraftar_oms", label: "BarqRaftar (OMS Courier)" }] : []),
      ...(postexConnected ? [{ value: "postex", label: "PostEx" }] : []),
      ...(postexOmsConnected ? [{ value: "postex_oms", label: "PostEx (OMS Courier)" }] : []),
    ],
    [bookingAccounts, barqraftarConnected, barqraftarOmsConnected, postexConnected, postexOmsConnected]
  );

  // Why the Actions menu is empty, so it says so instead of opening blank:
  // a status with no actions (Delivered, Cancelled, ...) or a mix of
  // statuses with none in common.
  const noActionsReason = useMemo(() => {
    if (selectedOrders.length === 0 || availableActions.length > 0) return "";
    const labels = Array.from(new Set(selectedOrders.map((o) => STATUS_LABELS[o.status] || o.status)));
    return labels.length === 1
      ? `No actions for ${labels[0]} orders`
      : `No action fits all of: ${labels.join(", ")} - select orders of one status`;
  }, [selectedOrders, availableActions]);

  // The couriers the picker offers: whichever this org can print for.
  const printAccounts = useMemo(
    () => [
      ...bookingAccounts.map((a) => a.id),
      ...(barqraftarConnected || barqraftarOmsConnected ? ["barqraftar"] : []),
      ...(postexConnected || postexOmsConnected ? ["postex"] : []),
    ],
    [bookingAccounts, barqraftarConnected, barqraftarOmsConnected, postexConnected, postexOmsConnected]
  );

  // fromBulk: the toolbar/selection bar (several orders, maybe several
  // couriers) rather than one order's own menu.
  async function startAction(action, orderIds, fromBulk = false) {
    // Bulk loadsheet / airway bill: ask which courier's to download rather
    // than always going to Smartlane.
    if (fromBulk && (action === "print_loadsheet" || action === "print_airway_bill")) {
      setPrintRequest({
        kind: action === "print_loadsheet" ? "loadsheet" : "airway_bill",
        orders: orders.filter((o) => orderIds.includes(o.id)),
      });
      return;
    }

    // Airway bill needs no courier param (Smartlane returns whichever
    // courier actually booked it) - fetch the real document and open it,
    // bypassing the bulk-action endpoint entirely since this returns a
    // document rather than mutating state. print_loadsheet DOES need a
    // courier param (Smartlane's load sheet api is one courier per call),
    // so it falls through to the param-collecting modal below instead.
    if (action === "print_airway_bill") {
      // With more than one order, let the operator split by product (or
      // keep the old "everyone in one PDF" behavior) before anything
      // downloads - see AirwayBillFilterModal.
      if (orderIds.length > 1) {
        setAirwayBillFilterOrders(orders.filter((o) => orderIds.includes(o.id)));
        return;
      }
      beginLoading("Preparing airway bill");
      try {
        await ordersService.printSmartlaneAirwayBill(orderIds);
      } catch (err) {
        setError(err.message || "Print failed");
      } finally {
        endLoading();
      }
      return;
    }

    // Same shape as print_airway_bill above - BarqRaftar's labels and our
    // own BarqRaftar load sheet both return a document directly, not a
    // bulk-action mutation.
    if (action === "print_barqraftar_labels" || action === "print_barqraftar_loadsheet") {
      const isLoadSheet = action === "print_barqraftar_loadsheet";
      beginLoading(isLoadSheet ? "Preparing load sheet" : "Preparing labels");
      try {
        await (isLoadSheet
          ? barqraftarService.printLoadSheet(orderIds)
          : barqraftarService.printLabels(orderIds));
        // A load sheet moves its orders on to Awaiting Dispatched.
        if (isLoadSheet) await reloadAfterChange();
      } catch (err) {
        setError(err.message || "Print failed");
      } finally {
        endLoading();
      }
      return;
    }

    // PostEx's airway bills and load sheet are documents too. The load
    // sheet is also PostEx's hand-over step (their Unbooked -> Booked), so
    // it's confirmed first.
    if (action === "print_postex_airway_bill" || action === "print_postex_loadsheet") {
      const isLoadSheet = action === "print_postex_loadsheet";
      const count = `${orderIds.length} order${orderIds.length === 1 ? "" : "s"}`;
      if (
        isLoadSheet &&
        !window.confirm(`Generate the PostEx load sheet for ${count}? This hands the parcels over to PostEx for pickup.`)
      ) {
        return;
      }
      beginLoading(isLoadSheet ? "Preparing PostEx load sheet" : "Preparing PostEx airway bills");
      try {
        await (isLoadSheet ? postexService.printLoadSheet(orderIds) : postexService.printAirwayBills(orderIds));
        if (isLoadSheet) await reloadAfterChange();
      } catch (err) {
        setError(err.message || "Print failed");
      } finally {
        endLoading();
      }
      return;
    }

    // Everything else opens OrderActionModal first - to collect its params
    // (its FIELD_BY_ACTION), or just to confirm.
    setPendingAction({ action, orderIds });
  }

  function onSubmitPendingAction(params) {
    // Close the popup right away and run in the background - the corner
    // progress pill (LoadingOverlay) shows it's working, and the rest of
    // the page stays usable meanwhile.
    const { action, orderIds } = pendingAction;
    setPendingAction(null);
    runAction(action, orderIds, params);
  }

  async function runAction(action, orderIds, params) {
    const ordersLabel = `${orderIds.length} order${orderIds.length === 1 ? "" : "s"}`;

    // Load sheet returns a document instead of mutating state, so it
    // bypasses the bulk-action endpoint entirely - Smartlane generates it
    // for one courier at a time. We don't actually know which real
    // courier (Leopards, BarqRaftar, ...) Smartlane assigned to a given
    // order - that lives only in Smartlane's own system - so "All" fetches
    // one load sheet per enabled courier instead: each request sends every
    // selected order, and Smartlane's own PDF only includes the ones that
    // actually belong to that courier. Couriers with none of the orders
    // fail quietly - see printSmartlaneLoadSheetForCouriers.
    if (action === "print_loadsheet") {
      const courier = params.courier;
      const couriersToPrint =
        courier === "all"
          ? SMARTLANE_LOAD_SHEET_COURIERS.filter((c) => !c.disabled && c.value !== "all").map((c) => c.value)
          : [courier];
      beginLoading(`Printing load sheet for ${ordersLabel}`);
      try {
        await ordersService.printSmartlaneLoadSheetForCouriers(orderIds, couriersToPrint);
        await reloadAfterChange();
      } catch (err) {
        setError(err.message || "Print failed");
      } finally {
        endLoading();
      }
      return;
    }

    beginLoading(`Updating ${ordersLabel}`);
    try {
      // "OMS Courier" / "Smartlane" are synthetic entries in the courier
      // picker (see BOOKING_ACCOUNTS), not real Courier rows - selecting one
      // pushes a booking through that Smartlane account instead of a plain
      // manual courier assignment.
      const bookingAccount =
        action === "assign_courier" && BOOKING_ACCOUNTS.find((a) => a.id === params.courier_id);
      const resolvedAction = bookingAccount ? "push_to_smartlane" : action;
      const resolvedParams = bookingAccount ? { account: bookingAccount.account } : params;

      const data = await ordersService.bulkAction({
        action: resolvedAction,
        orderIds,
        params: resolvedParams,
      });

      // The endpoint reports per-order outcomes with HTTP 200, so a stock
      // rejection arrives here rather than as a thrown error. Surface it as
      // the override prompt instead of a generic failure.
      const blocked = (data?.results || []).filter((r) => r.error_code === "insufficient_stock");
      if (blocked.length > 0) {
        setStockShortfall({
          rows: blocked,
          action: resolvedAction,
          orderIds: blocked.map((r) => r.order_id),
          params: resolvedParams,
        });
        await reloadAfterChange();
        return;
      }

      // Every other per-order rejection (wrong status, Smartlane refused the
      // booking, ...) also comes back with HTTP 200. Without this the modal
      // just closed and the list reloaded unchanged, so a refused action
      // looked exactly like a successful one.
      const failed = (data?.results || []).filter((r) => !r.success);

      // After reloadAfterChange(), which clears the error banner on the way in.
      await reloadAfterChange();
      if (failed.length > 0) setError(describeFailures(failed));
      // Edit Order on one order: its booking is cancelled, so open it to edit.
      if (action === "edit_order" && orderIds.length === 1 && failed.length === 0) {
        setDetailStartEditing(true);
        setDetailOrderId(orderIds[0]);
      }
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      endLoading();
    }
  }

  async function onProceedDespiteShortage() {
    if (!stockShortfall) return;
    // Same as onSubmitPendingAction: close first, run in the background.
    const { action, orderIds, params } = stockShortfall;
    setStockShortfall(null);
    beginLoading(`Updating ${orderIds.length} order${orderIds.length === 1 ? "" : "s"}`);
    try {
      const data = await ordersService.bulkAction({
        action,
        orderIds,
        params: { ...params, force: true },
      });
      const failed = (data?.results || []).filter((r) => !r.success);
      await reloadAfterChange();
      if (failed.length > 0) setError(describeFailures(failed));
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      endLoading();
    }
  }

  // Dispatch Hub stores only: flag the selected orders for FynkTech to
  // dispatch (or take the flag back). Not a status change, so it bypasses
  // the per-status action menus entirely.
  async function sendForDispatch(withdraw = false) {
    const orderIds = Array.from(selectedIds);
    beginLoading(withdraw ? "Withdrawing dispatch request" : "Sending for dispatch");
    try {
      const data = await ordersService.bulkAction({
        action: withdraw ? "withdraw_dispatch_request" : "request_dispatch",
        orderIds,
      });
      const failed = (data?.results || []).filter((r) => !r.success);
      await reloadAfterChange();
      if (failed.length > 0) setError(describeFailures(failed));
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      endLoading();
    }
  }

  function onSubmitSearch(e) {
    e.preventDefault();
    setAppliedSearch(search);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            {fromDashboard ? (
              <button
                type="button"
                // Back keeps the dashboard's range; a link opened on its own
                // has nothing to go back to.
                onClick={() => (window.history.length > 1 ? router.back() : router.push("/dashboard"))}
                aria-label="Back to dashboard"
                title="Back to dashboard"
                className="-ml-1 rounded-md p-1 text-slate-500 hover:bg-surface hover:text-slate-900"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            ) : null}
            <h1 className="text-[28px] font-semibold leading-8 text-slate-900">
              {user?.isDispatchHub ? "Dispatch Hub Orders" : "Local Orders"}
              {dashboardGroup ? <span className="text-slate-400"> · {dashboardGroup}</span> : null}
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {counts == null
              ? "Loading orders…"
              : user?.isDispatchHub
                ? `${counts.all ?? 0} orders across every Dispatch Hub store.`
                : `${counts.all ?? 0} orders for your organization.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter
            dateFrom={appliedFilters.date_from}
            dateTo={appliedFilters.date_to}
            onApplyDateRange={(date_from, date_to) => {
              setFilters((f) => ({ ...f, date_from, date_to }));
              setAppliedFilters((f) => ({ ...f, date_from, date_to }));
            }}
            onClearDateRange={() => {
              setFilters((f) => ({ ...f, date_from: "", date_to: "" }));
              setAppliedFilters((f) => ({ ...f, date_from: "", date_to: "" }));
            }}
          />
          {!user?.isDispatchHub ? (
            <Button variant="secondary" onClick={() => setNewOrderOpen(true)}>
              Manual Order
            </Button>
          ) : null}
          <CsvExportButton filterParams={queryParams} />
          {user?.isDispatchHub ? (
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              Import
            </Button>
          ) : user?.is_manual_store ? (
            <Button variant="secondary" onClick={() => setImportOrdersOpen(true)}>
              Import orders
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              Import
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mt-6">
        <OrderStatusTabs counts={counts} activeStatus={activeStatus} onChange={setActiveStatus} />

        <OrdersToolbar
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            // Emptying the box brings every order back without another click.
            if (!value.trim() && appliedSearch) setAppliedSearch("");
          }}
          onSubmitSearch={onSubmitSearch}
          selectedCount={selectedIds.size}
          availableActions={availableActions}
          noActionsReason={noActionsReason}
          onRaiseTicket={() => setTicketOrder(selectedOrders[0])}
          onAction={(action) => startAction(action, Array.from(selectedIds), true)}
          onRefresh={() => {
            // A real page reload, like the browser's - the cached view is
            // dropped first so the reload can't paint stale rows from it.
            invalidateViewCache();
            window.location.reload();
          }}
          refreshing={loading}
          extraFilters={
            user?.isDispatchHub ? (
              <HubOrderFilters
                stores={hubStoreOptions || []}
                storeIds={appliedFilters.store ? appliedFilters.store.split(",") : []}
                productNames={appliedFilters.product ? JSON.parse(appliedFilters.product) : []}
                status={activeStatus === "all" ? undefined : activeStatus}
                onChange={({ storeIds, productNames }) => {
                  const next = {
                    store: storeIds.join(","),
                    product: productNames.length ? JSON.stringify(productNames) : "",
                  };
                  setFilters((f) => ({ ...f, ...next }));
                  setAppliedFilters((f) => ({ ...f, ...next }));
                }}
              />
            ) : null
          }
        />

        {activeStatus === ASSIGNING_COURIER_TAB ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-surface-border bg-white px-4 py-2">
            <span className="text-sm text-slate-600">
              Scan each parcel&apos;s barcode to mark it Packed - only orders with a tracking number (To Be Packed).
            </span>
            <Button onClick={() => setScanOpen(true)}>Scan</Button>
          </div>
        ) : null}

        {appliedFilters.date_from || appliedFilters.date_to ? (
          <div className="mb-3 flex items-center justify-between rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
            <div className="flex items-center gap-2">
              <span className="font-medium text-brand-900">Active Date Filter:</span>
              <span className="rounded bg-brand-100 px-1.5 py-0.5 font-semibold text-brand-800">
                {appliedFilters.date_from || "Start"} to {appliedFilters.date_to || "Today"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setFilters((f) => ({ ...f, date_from: "", date_to: "" }));
                setAppliedFilters((f) => ({ ...f, date_from: "", date_to: "" }));
              }}
              className="font-medium text-brand-700 hover:text-brand-900 hover:underline"
            >
              Clear Date Filter
            </button>
          </div>
        ) : null}

        {selectedIds.size > 0 ? (
          <div className="mb-3 flex items-center justify-between rounded-md border border-brand-200 bg-brand-50 px-4 py-2">
            <span className="text-sm font-medium text-brand-900">
              {selectedIds.size} order{selectedIds.size === 1 ? "" : "s"} selected
            </span>
            <div className="flex flex-wrap gap-2">
              {inDispatchHub && !user?.isDispatchHub ? (
                selectedOrders.some((o) => o.dispatch_requested_at) ? (
                  <Button variant="secondary" onClick={() => sendForDispatch(true)}>
                    Withdraw dispatch request
                  </Button>
                ) : (
                  <Button onClick={() => sendForDispatch(false)}>Send for dispatch</Button>
                )
              ) : null}
              {/* Every action is in the toolbar's Actions menu. */}
            </div>
          </div>
        ) : null}

        <OrdersTable
          orders={sortedOrders}
          loading={loading}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onToggleSelectAll={onToggleSelectAll}
          onOpenDetail={setDetailOrderId}
          showStoreColumn={Boolean(user?.isDispatchHub)}
          showProductColumn={Boolean(user?.isDispatchHub)}
          showTransitColumn={activeStatus === CRITICAL_TAB}
          showSubStatusColumn={SUB_STATUS_TABS.has(activeStatus)}
          onRecreate={(order) => {
            setRecreateFrom(order);
            setNewOrderOpen(true);
          }}
        />

        <Pagination
          page={page}
          pageSize={pageSize}
          count={orderCount}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>

      <NewOrderModal
        open={newOrderOpen}
        recreateFrom={recreateFrom}
        onClose={() => {
          setNewOrderOpen(false);
          setRecreateFrom(null);
        }}
        onCreated={reloadAfterChange}
      />
      <ImportOrdersModal
        stores={user?.isDispatchHub ? hubStoreOptions || [] : null}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={reloadAfterChange}
      />
      <ImportNewOrdersModal
        open={importOrdersOpen}
        onClose={() => setImportOrdersOpen(false)}
        onImported={reloadAfterChange}
      />
      <OrderActionModal
        action={pendingAction?.action}
        count={pendingAction?.orderIds?.length || 0}
        couriers={
          pendingAction?.action === "assign_courier" && bookingAccounts.length
            ? // Only the synthetic booking-account entries actually book
              // anything right now (see bookingAccount/resolvedAction above) -
              // real courier rows (Trax, TCS, Leopards, ...), minus the
              // "Smartlane"/"OMS Courier" rows those bookings create as
              // plain Courier FKs, are shown greyed out as coming soon
              // instead of offered as a working manual-assign path.
              [
                ...bookingAccounts.map(({ id, name }) => ({ id, name })),
                ...couriers
                  .filter((c) => !isBookingAccountCourier(c))
                  .map((c) => ({ ...c, name: `${c.name} (Coming Soon)`, disabled: true })),
              ]
            : couriers
        }
        options={pendingAction?.action === "change_courier" ? changeCourierOptions : undefined}
        onClose={() => setPendingAction(null)}
        onSubmit={onSubmitPendingAction}
      />
      <StockShortageModal
        shortfalls={stockShortfall?.rows}
        onProceed={onProceedDespiteShortage}
        onClose={() => setStockShortfall(null)}
      />
      <PrintByCourierModal
        request={printRequest}
        accounts={printAccounts}
        onClose={() => setPrintRequest(null)}
        onPrinted={(kind) => {
          // Any courier's load sheet moves its orders on to Awaiting Dispatched.
          if (kind === "loadsheet") reloadAfterChange();
        }}
      />
      <AirwayBillFilterModal
        orders={airwayBillFilterOrders}
        onClose={() => setAirwayBillFilterOrders(null)}
      />
      <OrderDetailPanel
        orderId={detailOrderId}
        couriers={couriers}
        bookingAccounts={bookingAccounts}
        startEditing={detailStartEditing}
        onClose={() => {
          setDetailOrderId(null);
          setDetailStartEditing(false);
        }}
        onOrderChanged={reloadAfterChange}
      />
      <ScanPackModal open={scanOpen} onClose={() => setScanOpen(false)} onPacked={reloadAfterChange} />
      <CreateTicketDialog
        open={Boolean(ticketOrder)}
        order={ticketOrder}
        onClose={() => setTicketOrder(null)}
        onCreated={() => setTicketOrder(null)}
      />
    </div>
  );
}
