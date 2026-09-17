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
import useLoadingStore from "../../../store/loadingStore";
import Button from "../../../components/shared/Button";
import Pagination from "../../../components/shared/Pagination";
import OrderStatusTabs from "../../../components/orders/OrderStatusTabs";
import OrdersToolbar from "../../../components/orders/OrdersToolbar";
import OrdersFilterPanel from "../../../components/orders/OrdersFilterPanel";
import OrdersTable from "../../../components/orders/OrdersTable";
import CsvExportButton from "../../../components/orders/CsvExportButton";
import DateRangeFilter from "../../../components/orders/DateRangeFilter";
import {
  ACTIONS_BY_STATUS,
  ACTIONS_NEEDING_PARAMS,
  SMARTLANE_LOAD_SHEET_COURIERS,
  STATUS_TABS,
} from "../../../components/orders/statusConfig";

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
const VerifyDispatchModal = dynamic(() => import("../../../components/orders/VerifyDispatchModal"), {
  ssr: false,
});
const ScanReturnModal = dynamic(() => import("../../../components/orders/ScanReturnModal"), {
  ssr: false,
});
const NewOrderModal = dynamic(() => import("../../../components/orders/NewOrderModal"), {
  ssr: false,
});
const ImportOrdersModal = dynamic(() => import("../../../components/orders/ImportOrdersModal"), {
  ssr: false,
});
const OrderDetailPanel = dynamic(() => import("../../../components/orders/OrderDetailPanel"), {
  ssr: false,
});
const CreateTicketDialog = dynamic(() => import("../../../components/tickets/CreateTicketDialog"), {
  ssr: false,
});

const EMPTY_FILTERS = { city: "", courier_id: "", gateway: "", date_from: "", date_to: "" };
const TAB_STATUSES = STATUS_TABS.map((tab) => tab.value);

function isPlainTabQuery(queryParams) {
  return !queryParams.search && !queryParams.city && !queryParams.courier_id && !queryParams.gateway && !queryParams.date_from && !queryParams.date_to;
}

// Patches one order in/out of/within `list` - a pure function (no state
// reads/writes) so a whole WebSocket batch can be folded over one fresh
// `prev` inside a single setOrders updater, rather than each item risking
// acting on a stale array if several land in the same flush.
function applyPatchToList(list, freshOrder, view) {
  const matchesTab = view.activeStatus === "all" || freshOrder.status === view.activeStatus;
  const noOtherFilters =
    !view.appliedSearch && Object.values(view.appliedFilters).every((v) => !v);
  const idx = list.findIndex((o) => o.id === freshOrder.id);

  if (idx !== -1) {
    if (matchesTab) {
      const next = list.slice();
      next[idx] = freshOrder;
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
  if (matchesTab && view.page === 1 && noOtherFilters) {
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

  const [activeStatus, setActiveStatusState] = useState(() => searchParams.get("status") || "all");
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState("order_number");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [orders, setOrders] = useState([]);
  const [orderCount, setOrderCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [counts, setCounts] = useState(() => getCachedCounts());
  const [couriers, setCouriers] = useState([]);
  const [smartlaneConnected, setSmartlaneConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());

  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // { action, orderIds }
  const [airwayBillFilterOrders, setAirwayBillFilterOrders] = useState(null);
  // Set when a push-to-Smartlane was rejected for lack of stock - holds the
  // per-order shortage detail plus the ids to retry with force=true.
  const [stockShortfall, setStockShortfall] = useState(null);
  const [applyingAction, setApplyingAction] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState(null);
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
    router.replace(`/orders${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const queryParams = useMemo(
    () => ({
      status: activeStatus === "all" ? undefined : activeStatus,
      search: appliedSearch || undefined,
      search_field: appliedSearch ? searchField : undefined,
      ...appliedFilters,
    }),
    [activeStatus, appliedSearch, searchField, appliedFilters]
  );

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
    const key = ordersListKey({
      status: queryParams.status,
      page,
      pageSize,
      filters: queryParams,
    });
    setError("");

    if (plain) {
      const alreadyWarm = unfilteredListsAreWarm(pageSize, TAB_STATUSES);
      if (!force && alreadyWarm && getCachedOrdersList(key)) {
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
        setCachedOrdersList(key, { orders: nextOrders, orderCount: nextCount });
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
      const cachedList = getCachedOrdersList(key);
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
      setCachedOrdersList(key, { orders: orderData.results || [], orderCount: orderData.count || 0 });
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

  const applyCountsPatch = useCallback((counts) => {
    setCounts(counts);
    setCachedCounts(counts);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    couriersService.list().then(setCouriers).catch(() => {});
    integrationsService
      .getSmartlaneStatus()
      .then((d) => setSmartlaneConnected(Boolean(d.connected)))
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
      if (latestCounts) applyCountsPatch(latestCounts);

      if (needsFullReload) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(() => {
          reloadAfterChange();
        }, 300);
      }
    });
    return () => {
      clearTimeout(reloadTimer.current);
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

  const availableActions = useMemo(() => {
    if (selectedOrders.length === 0) return [];
    const statuses = new Set(selectedOrders.map((o) => o.status));
    if (statuses.size > 1) return [];
    const [status] = statuses;
    return ACTIONS_BY_STATUS[status] || [];
  }, [selectedOrders]);

  async function startAction(action, orderIds) {
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
      setApplyingAction(true);
      try {
        await ordersService.printSmartlaneAirwayBill(orderIds);
      } catch (err) {
        setError(err.message || "Print failed");
      } finally {
        setApplyingAction(false);
      }
      return;
    }

    if (ACTIONS_NEEDING_PARAMS.has(action)) {
      setPendingAction({ action, orderIds });
    } else {
      runAction(action, orderIds, {});
    }
  }

  async function runAction(action, orderIds, params) {
    // The centered overlay is reserved for genuinely bulk actions - a
    // single order already gets adequate feedback from the modal's own
    // button spinner.
    const bulk = orderIds.length > 1;

    // Load sheet returns a document instead of mutating state, so it
    // bypasses the bulk-action endpoint entirely - Smartlane generates it
    // for one courier at a time. We don't actually know which real
    // courier (Leopards, BarqRaftar, ...) Smartlane assigned to a given
    // order - that lives only in Smartlane's own system - so "All" fetches
    // one load sheet per enabled courier instead: each request sends every
    // selected order, and Smartlane's own PDF only includes the ones that
    // actually belong to that courier.
    if (action === "print_loadsheet") {
      const courier = params.courier;
      const couriersToPrint =
        courier === "all"
          ? SMARTLANE_LOAD_SHEET_COURIERS.filter((c) => !c.disabled && c.value !== "all").map((c) => c.value)
          : [courier];
      setApplyingAction(true);
      if (bulk) beginLoading(`Printing ${orderIds.length} load sheets`);
      try {
        for (const c of couriersToPrint) {
          await ordersService.printSmartlaneLoadSheet(orderIds, c);
        }
        setPendingAction(null);
        await reloadAfterChange();
      } catch (err) {
        setError(err.message || "Print failed");
      } finally {
        setApplyingAction(false);
        if (bulk) endLoading();
      }
      return;
    }

    setApplyingAction(true);
    if (bulk) beginLoading(`Applying to ${orderIds.length} orders`);
    try {
      // "Smartlane" is a synthetic entry in the courier picker (see
      // OrderActionModal), not a real Courier row - selecting it pushes a
      // booking to Smartlane instead of a plain manual courier assignment.
      const isSmartlane = action === "assign_courier" && params.courier_id === "smartlane";
      const resolvedAction = isSmartlane ? "push_to_smartlane" : action;
      const resolvedParams = isSmartlane ? {} : params;

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
        setPendingAction(null);
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

      setPendingAction(null);
      // After reloadAfterChange(), which clears the error banner on the way in.
      await reloadAfterChange();
      if (failed.length > 0) setError(describeFailures(failed));
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      setApplyingAction(false);
      if (bulk) endLoading();
    }
  }

  async function onProceedDespiteShortage() {
    if (!stockShortfall) return;
    const bulk = stockShortfall.orderIds.length > 1;
    setApplyingAction(true);
    if (bulk) beginLoading(`Applying to ${stockShortfall.orderIds.length} orders`);
    try {
      const data = await ordersService.bulkAction({
        action: stockShortfall.action,
        orderIds: stockShortfall.orderIds,
        params: { ...stockShortfall.params, force: true },
      });
      const failed = (data?.results || []).filter((r) => !r.success);
      setStockShortfall(null);
      await reloadAfterChange();
      if (failed.length > 0) setError(describeFailures(failed));
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      setApplyingAction(false);
      if (bulk) endLoading();
    }
  }

  function onSubmitSearch(e) {
    e.preventDefault();
    setAppliedSearch(search);
  }

  function onQuickFilter(patch) {
    setFilters((f) => ({ ...f, ...patch }));
    setAppliedFilters((f) => ({ ...f, ...patch }));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-[28px] font-semibold leading-8 text-slate-900">Local Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            {counts == null ? "Loading orders…" : `${counts.all ?? 0} orders for your organization.`}
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
          <Button variant="secondary" onClick={() => setNewOrderOpen(true)}>
            New Order
          </Button>
          <CsvExportButton filterParams={queryParams} />
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import
          </Button>
          <Button variant="secondary" onClick={() => setReturnOpen(true)}>
            Scan and Return
          </Button>
          <Button onClick={() => setDispatchOpen(true)}>Verify and Dispatch</Button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="mt-6">
        <OrderStatusTabs counts={counts} activeStatus={activeStatus} onChange={setActiveStatus} />

        <OrdersToolbar
          search={search}
          onSearchChange={setSearch}
          searchField={searchField}
          onSearchFieldChange={setSearchField}
          onSubmitSearch={onSubmitSearch}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((o) => !o)}
          selectedCount={selectedIds.size}
          availableActions={availableActions}
          onAction={(action) => startAction(action, Array.from(selectedIds))}
          onRefresh={reloadAfterChange}
          refreshing={loading}
        />

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

        {filtersOpen ? (
          <OrdersFilterPanel
            filters={filters}
            onChange={setFilters}
            couriers={couriers}
            onApply={() => setAppliedFilters(filters)}
            onClear={() => {
              setFilters(EMPTY_FILTERS);
              setAppliedFilters(EMPTY_FILTERS);
            }}
          />
        ) : null}

        {selectedIds.size > 0 ? (
          <div className="mb-3 flex items-center justify-between rounded-md border border-brand-200 bg-brand-50 px-4 py-2">
            <span className="text-sm font-medium text-brand-900">
              {selectedIds.size} order{selectedIds.size === 1 ? "" : "s"} selected
            </span>
            <div className="flex flex-wrap gap-2">
              {availableActions.slice(0, 4).map((a) => (
                <Button
                  key={a.key || a.action}
                  variant="secondary"
                  disabled={a.disabled}
                  onClick={() => startAction(a.action, Array.from(selectedIds))}
                >
                  {a.label}
                </Button>
              ))}
              {availableActions.length === 0 ? (
                <span className="text-xs text-brand-700">Mixed statuses - clear selection to act</span>
              ) : null}
            </div>
          </div>
        ) : null}

        <OrdersTable
          orders={orders}
          loading={loading}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onToggleSelectAll={onToggleSelectAll}
          onRowAction={(action, order) => startAction(action, [order.id])}
          onOpenDetail={setDetailOrderId}
          onRaiseTicket={setTicketOrder}
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

      <NewOrderModal open={newOrderOpen} onClose={() => setNewOrderOpen(false)} onCreated={reloadAfterChange} />
      <VerifyDispatchModal open={dispatchOpen} onClose={() => setDispatchOpen(false)} onDispatched={reloadAfterChange} />
      <ScanReturnModal open={returnOpen} onClose={() => setReturnOpen(false)} onReturned={reloadAfterChange} />
      <ImportOrdersModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={reloadAfterChange}
      />
      <OrderActionModal
        action={pendingAction?.action}
        count={pendingAction?.orderIds?.length || 0}
        couriers={
          pendingAction?.action === "assign_courier" && smartlaneConnected
            ? // Only the synthetic "smartlane" entry actually books
              // anything right now (see isSmartlane/resolvedAction below) -
              // real courier rows (Trax, TCS, Leopards, ...), including any
              // "Smartlane" row Smartlane itself created as a plain Courier
              // FK, are shown greyed out as coming soon instead of offered
              // as a working manual-assign path.
              [
                { id: "smartlane", name: "Smartlane" },
                ...couriers
                  .filter((c) => (c.name || "").trim().toLowerCase() !== "smartlane")
                  .map((c) => ({ ...c, name: `${c.name} (Coming Soon)`, disabled: true })),
              ]
            : couriers
        }
        submitting={applyingAction}
        onClose={() => setPendingAction(null)}
        onSubmit={(params) => runAction(pendingAction.action, pendingAction.orderIds, params)}
      />
      <StockShortageModal
        shortfalls={stockShortfall?.rows}
        submitting={applyingAction}
        onProceed={onProceedDespiteShortage}
        onClose={() => setStockShortfall(null)}
      />
      <AirwayBillFilterModal
        orders={airwayBillFilterOrders}
        onClose={() => setAirwayBillFilterOrders(null)}
      />
      <OrderDetailPanel
        orderId={detailOrderId}
        couriers={couriers}
        smartlaneConnected={smartlaneConnected}
        onClose={() => setDetailOrderId(null)}
        onOrderChanged={reloadAfterChange}
      />
      <CreateTicketDialog
        open={Boolean(ticketOrder)}
        order={ticketOrder}
        onClose={() => setTicketOrder(null)}
        onCreated={() => setTicketOrder(null)}
      />
    </div>
  );
}
