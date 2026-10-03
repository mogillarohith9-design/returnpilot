import { useEffect, useState } from "react";
import { api } from "./api";
import { CustomerView } from "./views/Customer";
import { SupportView } from "./views/Support";
import { WarehouseView } from "./views/Warehouse";
import { AdminView } from "./views/Admin";

const TABS = [
  { id: "customer", label: "Customer" },
  { id: "support", label: "Support" },
  { id: "warehouse", label: "Warehouse" },
  { id: "admin", label: "Admin · Policy" },
] as const;
type Tab = typeof TABS[number]["id"];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "customer");
  const [health, setHealth] = useState<any>(null);

  useEffect(() => { location.hash = tab; }, [tab]);
  useEffect(() => { api.health().then(setHealth).catch(e => setHealth({ ok: false, error: e.message })); }, []);

  return (
    <>
      <header className="top">
        <div className="brand"><span className="logo">↩</span> ReturnPilot <span className="tag">Evidence-based returns agent</span></div>
        <nav>{TABS.map(t => <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>)}</nav>
      </header>
      {health && !health.ok && (
        <div className="error-box wide">
          Setup problem: {health.error ?? `keys ${JSON.stringify(health.env)}, database: ${health.database}`}
        </div>
      )}
      <main>
        {tab === "customer" && <CustomerView />}
        {tab === "support" && <SupportView />}
        {tab === "warehouse" && <WarehouseView />}
        {tab === "admin" && <AdminView />}
      </main>
      <footer className="muted small">Demo data only · Pickup, carrier and refund payments are sandboxed · AI reads evidence, a fixed policy engine decides</footer>
    </>
  );
}
