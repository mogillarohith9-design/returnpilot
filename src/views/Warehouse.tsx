import { useEffect, useState } from "react";
import { api, type OrderRow } from "../api";
import { DecisionBadge, ErrorBox, Flags, PhotoInput, Trace } from "../ui";

export function WarehouseView() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => Promise.all([api.orders(), api.cases()])
    .then(([o, c]) => { setOrders(o.orders); setCases(c.cases); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const incoming = cases.filter(c => c.status === "APPROVED" || c.status === "REFUND_HELD" || c.status === "RESOLVED");

  return (
    <section>
      <h2>Warehouse</h2>
      <ErrorBox error={error} />
      <h3>1 · Packing photos (taken before dispatch)</h3>
      <p className="muted small">The agent compares the customer's photo and the returned item against this photo.</p>
      <div className="grid">{orders.map(o => <DispatchCard key={o.id} order={o} onSaved={load} />)}</div>

      <h3>2 · Returned parcels</h3>
      <p className="muted small">Photograph what actually came back. The agent checks it against the packing photo before the refund is released.</p>
      <div className="grid">{incoming.map(c => <ReceiveCard key={c.id} c={c} onDone={load} />)}</div>
      {!incoming.length && <p className="muted">No approved returns waiting.</p>}
    </section>
  );
}

function DispatchCard({ order, onSaved }: { order: OrderRow; onSaved: () => void }) {
  const [photo, setPhoto] = useState<string | null>(order.dispatchPhoto);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = photo && photo !== order.dispatchPhoto;
  return (
    <div className="card">
      <div className="muted small">{order.id} · {order.customerName}</div>
      <b>{order.product.name}</b> <span className="muted">({order.product.colour})</span>
      <PhotoInput label="📦 Add packing photo" value={photo} onChange={setPhoto} />
      <ErrorBox error={error} />
      {changed && <button className="btn" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await api.uploadDispatch(order.id, photo!); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? "Saving…" : "Save packing photo"}</button>}
    </div>
  );
}

function ReceiveCard({ c, onDone }: { c: any; onDone: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<any>(null);
  return (
    <div className="card">
      <div className="row between"><b>{c.id}</b><span className="badge">{c.status.replace("_", " ")}</span></div>
      <div className="small">{c.orders?.products?.name} · {c.orders?.customers?.name}</div>
      {c.status === "APPROVED" && <>
        <PhotoInput label="🏭 Photo of returned item" value={photo} onChange={setPhoto} />
        <ErrorBox error={error} />
        {photo && <button className="btn primary" disabled={busy} onClick={async () => {
          setBusy(true); setError(null);
          try { setRes(await api.caseAction({ caseId: c.id, action: "received", receivedPhoto: photo })); onDone(); }
          catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? "Comparing with packing photo…" : "Check returned item"}</button>}
      </>}
      {res && <div className="result">
        <DecisionBadge decision={res.result.decision} /> <Flags flags={res.result.flags} />
        <Trace steps={res.result.trace} />
      </div>}
    </div>
  );
}
