import { useEffect, useState } from "react";
import { api, type Decision } from "../api";
import { DecisionBadge, ErrorBox, Flags, Trace, inr, when } from "../ui";

const STATUS_TONE: Record<string, string> = {
  APPROVED: "good", RESOLVED: "good", REJECTED: "bad", REFUND_HELD: "bad", NEEDS_INFO: "warn", AWAITING_HUMAN: "warn",
};

export function SupportView() {
  const [cases, setCases] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.cases().then(d => setCases(d.cases)).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const count = (pred: (c: any) => boolean) => cases.filter(pred).length;
  // "Resolved by agent" = the agent itself approved or rejected (not "needs info", not a human decision).
  const auto = count(c => c.latest && c.latest.stage !== "human" && (c.latest.decision.startsWith("APPROVE") || c.latest.decision === "REJECT"));

  return (
    <section>
      <div className="row between"><h2>Return cases</h2><button className="btn secondary" onClick={load}>↻ Refresh</button></div>
      <ErrorBox error={error} />
      <div className="stats">
        <div><b>{cases.length}</b><span>Total cases</span></div>
        <div><b>{auto}</b><span>Resolved by agent</span></div>
        <div><b>{count(c => c.status === "AWAITING_HUMAN")}</b><span>Waiting for human</span></div>
        <div><b>{count(c => (c.latest?.flags ?? []).some((f: string) => f !== "TRANSIT_DAMAGE"))}</b><span>Fraud signals</span></div>
      </div>
      <div className="split">
        <div className="list">
          {cases.map(c => (
            <button key={c.id} className={`list-item ${selected === c.id ? "sel" : ""}`} onClick={() => setSelected(c.id)}>
              <div className="row between"><b>{c.id}</b><span className={`badge ${STATUS_TONE[c.status] ?? ""}`}>{c.status.replace("_", " ")}</span></div>
              <div className="small">{c.orders?.products?.name} · {c.orders?.customers?.name}</div>
              <div className="muted small">{c.summary ?? c.customer_text}</div>
              <Flags flags={c.latest?.flags} />
            </button>
          ))}
          {!cases.length && <p className="muted">No cases yet. File one from the Customer tab.</p>}
        </div>
        <div className="detail">{selected ? <CaseDetail id={selected} onChanged={load} /> : <p className="muted">Select a case.</p>}</div>
      </div>
    </section>
  );
}

function CaseDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Decision>("APPROVE_REPLACEMENT");
  const [note, setNote] = useState("");
  const load = () => api.caseDetail(id).then(setD).catch(e => setError(e.message));
  useEffect(() => { setD(null); load(); }, [id]); // eslint-disable-line

  async function act(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try { await api.caseAction({ caseId: id, ...body }); await load(); onChanged(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!d) return <p className="muted">{error ?? "Loading…"}</p>;
  const k = d.case, o = k.orders, last = d.decisions[d.decisions.length - 1];
  return (
    <div className="card">
      <div className="row between"><h3>{k.id}</h3>{last && <DecisionBadge decision={last.decision} />}</div>
      <div className="small">{o.products.name} ({o.products.colour}) · {inr(o.price)} · {o.customers.name} · order {o.id}</div>
      <p><b>Customer wrote{k.language ? ` (${k.language})` : ""}:</b> “{k.customer_text}”</p>
      {k.summary && <p><b>AI summary:</b> {k.summary}</p>}

      <div className="photos">
        <figure><figcaption>📦 Packed (seller)</figcaption>{o.dispatch_photo ? <img src={o.dispatch_photo} /> : <div className="empty">No packing photo</div>}</figure>
        <figure><figcaption>📱 Customer photo</figcaption>{k.claim_photo ? <img src={k.claim_photo} /> : <div className="empty">No photo</div>}</figure>
        <figure><figcaption>🏭 Returned (warehouse)</figcaption>{k.received_photo ? <img src={k.received_photo} /> : <div className="empty">Not received yet</div>}</figure>
      </div>

      {last && <>
        <div className="row"><Flags flags={last.flags} />
          {last.evidence_score != null && <span className="muted small">Evidence score {Number(last.evidence_score).toFixed(2)}</span>}
          {last.clause_id && <span className="muted small">Clause {last.clause_id}</span>}
          {last.policy_version && <span className="muted small">Policy v{last.policy_version}</span>}
        </div>
        <Trace steps={last.trace} />
      </>}

      <ErrorBox error={error} />
      <div className="actions">
        <div className="row">
          <select value={outcome} onChange={e => setOutcome(e.target.value as Decision)}>
            <option value="APPROVE_REPLACEMENT">Approve replacement</option>
            <option value="APPROVE_REFUND">Approve refund</option>
            <option value="APPROVE_EXCHANGE">Approve exchange</option>
            <option value="REJECT">Reject</option>
          </select>
          <input placeholder="Note (why)" value={note} onChange={e => setNote(e.target.value)} />
          <button className="btn" disabled={busy} onClick={() => act({ action: "human", outcome, note })}>Human decision</button>
        </div>
        <div className="row">
          {last && !last.facts && last.stage === "claim" &&
            <button className="btn" disabled={busy} onClick={() => act({ action: "reassess" })}>{busy ? "Asking the AI again…" : "⟳ Retry AI check"}</button>}
          <button className="btn secondary" disabled={busy} onClick={() => act({ action: "rerun" })}>↻ Re-check with current policy</button>
        </div>
      </div>

      <details><summary>Decision history and audit trail ({d.decisions.length} decisions, {d.audit.length} events)</summary>
        <table className="table">
          <thead><tr><th>Time</th><th>Stage</th><th>Decision</th><th>Policy</th><th>Model</th></tr></thead>
          <tbody>{d.decisions.map((x: any) => <tr key={x.id}><td>{when(x.created_at)}</td><td>{x.stage}</td><td>{x.decision}</td><td>{x.policy_version ? `v${x.policy_version}` : "-"}</td><td>{x.model ?? "-"}</td></tr>)}</tbody>
        </table>
        <table className="table">
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th></tr></thead>
          <tbody>{d.audit.map((x: any) => <tr key={x.id}><td>{when(x.created_at)}</td><td>{x.actor}</td><td>{x.action}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
