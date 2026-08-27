"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const TABS = [
  { value: "all", label: "All" },
  { value: "pending_cod", label: "Pending COD" },
  { value: "awaiting_dispatched", label: "Awaiting Dispatch" },
  { value: "dispatched", label: "Dispatched" },
];

const DEMO_ORDERS = [
  {
    id: "1",
    order_number: "#10482",
    status: "pending_cod",
    statusLabel: "Pending COD",
    customer_name: "Ahmed Raza",
    city: "Karachi",
    amount: "4,890",
  },
  {
    id: "2",
    order_number: "#10481",
    status: "pending_cod",
    statusLabel: "Pending COD",
    customer_name: "Sara Khan",
    city: "Lahore",
    amount: "2,150",
  },
  {
    id: "3",
    order_number: "#10480",
    status: "awaiting_dispatched",
    statusLabel: "Awaiting Dispatch",
    customer_name: "Nadia Ali",
    city: "Multan",
    amount: "3,400",
  },
  {
    id: "4",
    order_number: "#10479",
    status: "awaiting_dispatched",
    statusLabel: "Awaiting Dispatch",
    customer_name: "Bilal Hussain",
    city: "Islamabad",
    amount: "7,200",
  },
  {
    id: "5",
    order_number: "#10478",
    status: "dispatched",
    statusLabel: "Dispatched",
    customer_name: "Omar Sheikh",
    city: "Faisalabad",
    amount: "1,980",
  },
  {
    id: "6",
    order_number: "#10477",
    status: "dispatched",
    statusLabel: "Dispatched",
    customer_name: "Hina Malik",
    city: "Karachi",
    amount: "5,100",
  },
];

const ROTATE_MS = 3200;

function CursorIcon({ clicking }) {
  return (
    <svg
      className={`desk-mock__cursor-svg ${clicking ? "is-clicking" : ""}`}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M5.5 3.2 18.2 12.1l-5.1 1.3 2.6 6.2-2.4 1-2.7-6.3-3.9 3.8V3.2Z"
        fill="#0f172a"
        stroke="#fff"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function OrderDeskMock({ compact = false }) {
  const [tabIndex, setTabIndex] = useState(0);
  const [clicking, setClicking] = useState(false);
  const [cursor, setCursor] = useState({ x: 24, y: 28, ready: false });
  const tabsRef = useRef(null);
  const tabRefs = useRef([]);

  const activeStatus = TABS[tabIndex].value;

  const updateCursor = (index, withClick) => {
    const tab = tabRefs.current[index];
    const track = tabsRef.current;
    if (!tab || !track) return;
    const tabBox = tab.getBoundingClientRect();
    const trackBox = track.getBoundingClientRect();
    const x = tabBox.left - trackBox.left + tabBox.width * 0.55;
    const y = tabBox.top - trackBox.top + tabBox.height * 0.65;
    setCursor({ x, y, ready: true });
    if (withClick) {
      setClicking(true);
      window.setTimeout(() => setClicking(false), 220);
    }
  };

  useLayoutEffect(() => {
    updateCursor(tabIndex, false);
    const clickTimer = window.setTimeout(() => updateCursor(tabIndex, true), 480);
    return () => window.clearTimeout(clickTimer);
  }, [tabIndex, compact]);

  useEffect(() => {
    const onResize = () => updateCursor(tabIndex, false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [tabIndex]);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return undefined;

    const id = window.setInterval(() => {
      setTabIndex((i) => (i + 1) % TABS.length);
    }, ROTATE_MS);

    return () => window.clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const next = { all: DEMO_ORDERS.length };
    for (const order of DEMO_ORDERS) {
      next[order.status] = (next[order.status] || 0) + 1;
    }
    return next;
  }, []);

  const visibleOrders = useMemo(() => {
    const rows =
      activeStatus === "all"
        ? DEMO_ORDERS
        : DEMO_ORDERS.filter((o) => o.status === activeStatus);
    return rows.slice(0, 4);
  }, [activeStatus]);

  return (
    <div className={`desk-mock ${compact ? "desk-mock--compact" : ""}`} aria-hidden="true">
      <div className="desk-mock__chrome">
        <div className="desk-mock__topbar">
          <span className="desk-mock__mark" title="OMS">
            <span />
            <span />
            <span />
          </span>
          <nav className="desk-mock__modules">
            <span className="is-active">OMS</span>
            <span>WMS</span>
            <span>Finance</span>
          </nav>
          <span className="desk-mock__org">Demo Brand</span>
        </div>

        <div className="desk-mock__body">
          <aside className="desk-mock__rail">
            <span className="is-on" />
            <span />
            <span />
          </aside>

          <div className="desk-mock__main">
            <div className="desk-mock__toolbar">
              <div>
                <h3>Orders</h3>
                <p>Demo queue</p>
              </div>
            </div>

            <div className="desk-mock__tabs" ref={tabsRef}>
              {TABS.map((tab, i) => (
                <div
                  key={tab.value}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  className={i === tabIndex ? "is-active" : ""}
                >
                  <em>{tab.label}</em>
                  <strong>{counts[tab.value] ?? 0}</strong>
                </div>
              ))}
              <div
                className={`desk-mock__cursor ${cursor.ready ? "is-ready" : ""} ${
                  clicking ? "is-clicking" : ""
                }`}
                style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
              >
                <CursorIcon clicking={clicking} />
                {clicking ? <span className="desk-mock__click-ripple" /> : null}
              </div>
            </div>

            <div className="desk-mock__table-wrap">
              <table className="desk-mock__table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>City</th>
                    <th className="is-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((order) => (
                    <tr key={`${activeStatus}-${order.id}`}>
                      <td>
                        <div className="desk-mock__order-no">{order.order_number}</div>
                        <div className="desk-mock__status">{order.statusLabel}</div>
                      </td>
                      <td>{order.customer_name}</td>
                      <td>{order.city}</td>
                      <td className="is-right">Rs {order.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
