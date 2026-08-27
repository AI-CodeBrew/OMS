"use client";

import Link from "next/link";
import OrderDeskMock from "../components/landing/OrderDeskMock";
import "./landing.css";

const DEMO_WHATSAPP =
  "https://api.whatsapp.com/send/?phone=923394223327&text&type=phone_number&app_absent=0";

const FEATURES = [
  {
    n: "01",
    tag: "OMS",
    title: "One queue for every order status.",
    text: "Pending COD, approval, packing, dispatch, and returns — filtered the way your ops team actually works, with scan dispatch and loadsheets built in.",
    bullets: [
      "Local & all-orders views",
      "COD and approval queues",
      "Scan dispatch, loadsheets & airway bills",
    ],
    mock: "orders",
  },
  {
    n: "02",
    tag: "WMS",
    title: "Warehouse stock that stays honest.",
    text: "Multi-warehouse inventory, adjustments, SKU import, and a returns desk that puts product back where it belongs.",
    bullets: [
      "Stock levels & adjustments",
      "Movement history",
      "Return scan into inventory",
    ],
    mock: "wms",
  },
  {
    n: "03",
    tag: "Financify",
    title: "Close the COD and cash loop.",
    text: "Finance is built for reconciliation — payments, invoices, refunds, and COD as your money ops mature with the stack.",
    bullets: [
      "COD reconciliation",
      "Payments & refunds",
      "Invoices & expenses",
    ],
    mock: "finance",
  },
  {
    n: "04",
    tag: "Connect",
    title: "Shopify in. Couriers tracking. Done.",
    text: "Import storefront orders and keep shipment status flowing — Shopify and Smartlane live, domestic couriers next.",
    bullets: [
      "Shopify order import & webhooks",
      "Smartlane real-time tracking",
      "Leopards & PostEx coming soon",
    ],
    mock: "connect",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Connect channels",
    text: "Link Shopify and courier tracking from Integrations.",
  },
  {
    n: "2",
    title: "Run the desk",
    text: "Verify, approve, pack, print, and scan-dispatch in OMS.",
  },
  {
    n: "3",
    title: "Ship & reconcile",
    text: "WMS holds stock truth; Financify closes COD and cash.",
  },
];

function FeatureMock({ type }) {
  if (type === "orders") return <OrderDeskMock compact />;
  if (type === "wms") {
    return (
      <div className="landing__ui">
        <div className="landing__ui-bar">
          <span>WMS · Inventory</span>
          <span className="landing__ui-pill">3 warehouses</span>
        </div>
        <ul className="landing__ui-list">
          <li>
            <span>SKU-1042</span>
            <span>Main hub</span>
            <span className="landing__ui-strong">128</span>
          </li>
          <li>
            <span>SKU-2088</span>
            <span>Lahore</span>
            <span className="landing__ui-strong">54</span>
          </li>
          <li>
            <span>SKU-3011</span>
            <span>Returns desk</span>
            <span className="landing__ui-strong">12</span>
          </li>
        </ul>
      </div>
    );
  }
  if (type === "finance") {
    return (
      <div className="landing__ui">
        <div className="landing__ui-bar">
          <span>Financify · COD</span>
          <span className="landing__ui-pill landing__ui-pill--warm">Open</span>
        </div>
        <div className="landing__ui-stats">
          <div>
            <em>Collected</em>
            <strong>1.2M</strong>
          </div>
          <div>
            <em>Outstanding</em>
            <strong>184k</strong>
          </div>
        </div>
        <ul className="landing__ui-list">
          <li>
            <span>Leopards</span>
            <span>Settlement</span>
            <span>Due Fri</span>
          </li>
          <li>
            <span>PostEx</span>
            <span>Reconciled</span>
            <span>✓</span>
          </li>
        </ul>
      </div>
    );
  }
  return (
    <div className="landing__ui">
      <div className="landing__ui-bar">
        <span>Integrations</span>
        <span className="landing__ui-pill landing__ui-pill--live">Connected</span>
      </div>
      <ul className="landing__ui-list">
        <li>
          <span>Shopify</span>
          <span>Orders + webhooks</span>
          <span className="landing__ui-strong">Live</span>
        </li>
        <li>
          <span>Smartlane</span>
          <span>Tracking</span>
          <span className="landing__ui-strong">Live</span>
        </li>
        <li>
          <span>Leopards</span>
          <span>Shipping</span>
          <span>Soon</span>
        </li>
      </ul>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing__nav">
        <span className="landing__nav-spacer" aria-hidden="true" />
        <nav className="landing__nav-links" aria-label="Page">
          <a href="#product">Product</a>
          <a href="#how">How it works</a>
          <a href="#integrations">Integrations</a>
        </nav>
        <div className="landing__nav-actions">
          <Link href="/login" className="landing__btn landing__btn--text landing__btn--sm">
            Sign in
          </Link>
          <a
            href={DEMO_WHATSAPP}
            target="_blank"
            rel="noopener noreferrer"
            className="landing__btn landing__btn--primary landing__btn--sm"
          >
            Book a demo
          </a>
        </div>
      </header>

      <main id="top">
        <section className="landing__hero">
          <div className="landing__hero-bg" aria-hidden="true">
            <div className="landing__hero-grid" />
            <div className="landing__hero-orb landing__hero-orb--a" />
            <div className="landing__hero-orb landing__hero-orb--b" />
            <div className="landing__hero-orb landing__hero-orb--c" />
            <div className="landing__hero-ring landing__hero-ring--a" />
            <div className="landing__hero-ring landing__hero-ring--b" />
            <div className="landing__hero-beams" />
          </div>
          <div className="landing__hero-inner">
            <div className="landing__hero-copy">
              <p className="landing__eyebrow">Commerce operating system</p>
              <h1 className="landing__headline">
                Orders, warehouse, and finance — one desk for teams that ship.
              </h1>
              <p className="landing__lede">
                Run COD queues, scan dispatch, stock, returns, and reconciliation
                without jumping between spreadsheets and chats.
              </p>
              <div className="landing__ctas">
                <a
                  href={DEMO_WHATSAPP}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="landing__btn landing__btn--primary"
                >
                  Book a demo
                </a>
                <Link href="/login" className="landing__btn landing__btn--secondary">
                  Sign in
                </Link>
              </div>
              <p className="landing__trust">
                Shopify &amp; Smartlane live · Multi-tenant · Built for daily ops
              </p>
            </div>

            <div className="landing__hero-visual">
              <div className="landing__hero-glow" />
              <div className="landing__hero-panel landing__hero-panel--desk">
                <OrderDeskMock />
              </div>
            </div>
          </div>
        </section>

        <section className="landing__works landing__band--light" aria-label="Works with">
          <p>Works with</p>
          <ul>
            <li>Shopify</li>
            <li>Smartlane</li>
            <li>Leopards</li>
            <li>PostEx</li>
            <li>COD logistics</li>
          </ul>
        </section>

        <section className="landing__problem landing__band--light">
          <div className="landing__problem-inner">
            <p className="landing__eyebrow">Built for ops teams</p>
            <h2>Missed statuses and spreadsheet chaos cost you every day.</h2>
            <p>
              Customers expect fast dispatch. Your team needs one queue for orders,
              stock, and cash — not five tools and a group chat.
            </p>
          </div>
        </section>

        <section id="product" className="landing__features landing__band--light">
          {FEATURES.map((feature, i) => (
            <article
              key={feature.n}
              className={`landing__feature ${i % 2 === 1 ? "landing__feature--flip" : ""}`}
            >
              <div className="landing__feature-copy">
                <p className="landing__feature-n">
                  {feature.n} · {feature.tag}
                </p>
                <h3>{feature.title}</h3>
                <p className="landing__feature-text">{feature.text}</p>
                <ul>
                  {feature.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
              <div className="landing__feature-visual">
                <FeatureMock type={feature.mock} />
              </div>
            </article>
          ))}
        </section>

        <section id="how" className="landing__how landing__band--dark">
          <div className="landing__how-head">
            <p className="landing__eyebrow">How it works</p>
            <h2>Live in three steps</h2>
          </div>
          <ol className="landing__how-grid">
            {STEPS.map((step) => (
              <li key={step.n}>
                <span>{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="integrations" className="landing__integrate landing__band--light">
          <div className="landing__integrate-inner">
            <div>
              <p className="landing__eyebrow">Integrations</p>
              <h2>Plugs into the stack you already use</h2>
              <p>
                Connect your storefront and tracking today. Expand courier coverage
                as you grow — without rebuilding ops.
              </p>
            </div>
            <ul className="landing__integrate-list">
              <li>
                <strong>Shopify</strong>
                <span>Live</span>
                <p>Import orders and keep webhooks flowing into the desk.</p>
              </li>
              <li>
                <strong>Smartlane</strong>
                <span>Live</span>
                <p>Real-time shipment status straight onto the order.</p>
              </li>
              <li>
                <strong>Leopards &amp; PostEx</strong>
                <span>Soon</span>
                <p>Domestic booking and labels on the roadmap.</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="landing__cta-band">
          <h2>Ready to put your order desk on rails?</h2>
          <p>
            Book a WhatsApp demo, or sign in if your organization is already set up.
          </p>
          <div className="landing__ctas">
            <a
              href={DEMO_WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className="landing__btn landing__btn--primary"
            >
              Book a demo
            </a>
            <Link href="/login" className="landing__btn landing__btn--secondary">
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing__footer landing__band--dark">
        <div className="landing__footer-inner">
          <div>
            <p className="landing__footer-brand">OMS</p>
            <p>© {new Date().getFullYear()} FynkTech · Order · Warehouse · Finance</p>
          </div>
          <div className="landing__footer-links">
            <Link href="/login">Sign in</Link>
            <a href={DEMO_WHATSAPP} target="_blank" rel="noopener noreferrer">
              Book a demo
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
