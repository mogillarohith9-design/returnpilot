import { useEffect, useState } from "react";
import { api, type OrderRow, type Result } from "../api";
import { DecisionBadge, ErrorBox, Flags, PhotoInput, Trace, inr } from "../ui";

export function CustomerView() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customerId, setCustomerId] = useState("C1");
  const [active, setActive] = useState<OrderRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.orders().then(d => { setCustomers(d.customers); setOrders(d.orders); }).catch(e => setError(e.message));
  }, []);

  const mine = orders.filter(o => o.customerId === customerId);
  if (active) return <ReturnFlow order={active} onBack={() => setActive(null)} />;

  return (
    <section>
      <div className="row between">
        <h2>My orders</h2>
        <label className="inline">Signed in as{" "}
          <select value={customerId} onChange={e => setCustomerId(e.target.value)}>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <ErrorBox error={error} />
      <div className="grid">
        {mine.map(o => (
          <div key={o.id} className="card">
            <div className="muted small">{o.id}</div>
            <h3>{o.product.name}</h3>
            <div>{o.product.colour} · {inr(o.price)}</div>
            <div className="muted small">Delivered {o.daysSinceDelivery} days ago</div>
            <button className="btn" onClick={() => setActive(o)}>Request return</button>
          </div>
        ))}
        {!mine.length && !error && <p className="muted">Loading orders…</p>}
      </div>
    </section>
  );
}

function ReturnFlow({ order, onBack }: { order: OrderRow; onBack: () => void }) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ caseId: string; result: Result; reply_customer?: string; language?: string } | null>(null);

  const issueCode = () => api.proofCode(order.id).then(setCode).catch(e => setError(e.message));
  useEffect(() => { issueCode(); }, [order.id]); // eslint-disable-line

  async function submit() {
    setBusy(true); setError(null);
    try { setOutcome(await api.createCase(order.id, text, photo)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function retry() { setOutcome(null); setPhoto(null); issueCode(); }

  if (outcome) {
    const r = outcome.result;
    return (
      <section className="narrow">
        <button className="link" onClick={onBack}>← My orders</button>
        <div className="card result">
          <div className="muted small">Case {outcome.caseId} · {order.product.name}</div>
          <DecisionBadge decision={r.decision} /> <Flags flags={r.flags} />
          <p className="big">{r.customerMessage}</p>
          {outcome.reply_customer && outcome.language && outcome.language.toLowerCase() !== "english" &&
            <p className="reply">💬 {outcome.reply_customer}</p>}
          {r.decision === "ASK_FOR_EVIDENCE" && <button className="btn" onClick={retry}>Take a new photo</button>}
          <details open><summary>Why this decision</summary><Trace steps={r.trace} /></details>
        </div>
      </section>
    );
  }

  return (
    <section className="narrow">
      <button className="link" onClick={onBack}>← My orders</button>
      <h2>Return: {order.product.name}</h2>
      <div className="muted">{order.id} · {order.product.colour} · {inr(order.price)} · delivered {order.daysSinceDelivery} days ago</div>

      <div className="card code-card">
        <div className="muted small">Proof-of-now code</div>
        <div className="code">{code?.code ?? "····"}</div>
        <div className="small">Write this number on a paper and keep it <b>next to the item</b> in your photo. Valid 10 minutes.</div>
      </div>

      <label className="field">What went wrong? (any language)
        <textarea rows={3} value={text} onChange={e => setText(e.target.value)}
          placeholder="e.g. The left earphone arrived cracked / ఇయర్‌ఫోన్ పగిలిపోయి వచ్చింది" />
      </label>
      <PhotoInput label="📷 Take or upload photo" value={photo} onChange={setPhoto} />
      <ErrorBox error={error} />
      <button className="btn primary" disabled={busy || !text.trim()} onClick={submit}>
        {busy ? "Agent is checking your evidence… (up to 30 s)" : "Submit return request"}
      </button>
    </section>
  );
}
