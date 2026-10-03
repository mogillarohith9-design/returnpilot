import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorBox, when } from "../ui";

const ACTIONS = ["REPLACEMENT", "REFUND", "EXCHANGE", "HUMAN_INSPECTION"];

export function AdminView() {
  const [rules, setRules] = useState<any>(null);
  const [original, setOriginal] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [sim, setSim] = useState<any>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.policy().then(d => { setRules(structuredClone(d.active.rules)); setOriginal(JSON.stringify(d.active.rules)); setHistory(d.history); })
    .catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const set = (path: string[], value: unknown) => {
    setSim(null); setMsg(null);
    setRules((r: any) => {
      const next = structuredClone(r); let t = next;
      for (const k of path.slice(0, -1)) t = t[k];
      t[path[path.length - 1]] = value; return next;
    });
  };

  async function run(mode: "simulate" | "save") {
    if (mode === "save" && JSON.stringify(rules) === original) { setSim(null); setMsg(null); setError("Nothing changed, so no new version was saved."); return; }
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await api.policyPost(rules, mode, note);
      setSim(r.simulation);
      if (mode === "save") { setMsg(`Saved as policy v${r.saved}`); setNote(""); await load(); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (!rules) return <section><h2>Return policy</h2><ErrorBox error={error} /><p className="muted">Loading…</p></section>;

  return (
    <section className="narrow">
      <h2>Return policy <span className="muted">(active: v{history.find(h => h.is_active)?.version})</span></h2>
      {Object.entries<any>(rules.categories).map(([cat, c]) => (
        <div key={cat} className="card">
          <h3>{cat} <span className="muted small">clause {c.clauseId}</span></h3>
          <div className="form-grid">
            <label>Return window (days)<input type="number" min={0} value={c.windowDays} onChange={e => set(["categories", cat, "windowDays"], Number(e.target.value))} /></label>
            <label>If damaged / defective<select value={c.onDamaged} onChange={e => set(["categories", cat, "onDamaged"], e.target.value)}>{ACTIONS.map(a => <option key={a}>{a}</option>)}</select></label>
            <label>If wrong item / colour / size<select value={c.onWrongItem} onChange={e => set(["categories", cat, "onWrongItem"], e.target.value)}>{ACTIONS.map(a => <option key={a}>{a}</option>)}</select></label>
            <label className="check"><input type="checkbox" checked={c.changeOfMindAllowed} onChange={e => set(["categories", cat, "changeOfMindAllowed"], e.target.checked)} /> Change-of-mind returns allowed</label>
          </div>
        </div>
      ))}
      <div className="card">
        <h3>Safety rules</h3>
        <div className="form-grid">
          <label>Auto-approve if evidence score ≥<input type="number" step="0.05" min={0} max={1} value={rules.autoThreshold} onChange={e => set(["autoThreshold"], Number(e.target.value))} /></label>
          <label>Ask for new photo if score ≥<input type="number" step="0.05" min={0} max={1} value={rules.retakeThreshold} onChange={e => set(["retakeThreshold"], Number(e.target.value))} /></label>
          <label>Human review above (₹)<input type="number" min={0} value={rules.humanReviewAbovePrice} onChange={e => set(["humanReviewAbovePrice"], Number(e.target.value))} /></label>
          <label>Human review if returns in 90 days &gt;<input type="number" min={0} value={rules.maxReturns90d} onChange={e => set(["maxReturns90d"], Number(e.target.value))} /></label>
          <label className="check"><input type="checkbox" checked={!!rules.requireProofCode} onChange={e => set(["requireProofCode"], e.target.checked)} /> Require proof-of-now code in photos</label>
        </div>
      </div>

      <ErrorBox error={error} />
      <div className="row">
        <button className="btn secondary" disabled={busy} onClick={() => run("simulate")}>🔍 Preview impact on past cases</button>
        <input placeholder="Change note" value={note} onChange={e => setNote(e.target.value)} />
        <button className="btn primary" disabled={busy} onClick={() => run("save")}>Save as new version</button>
      </div>
      {msg && <div className="ok-box">✓ {msg}</div>}
      {sim && (
        <div className="card">
          <b>{sim.changed} of {sim.total} past decisions would change</b>
          {sim.changed > 0 && <table className="table"><thead><tr><th>Case</th><th>Before</th><th>After</th></tr></thead>
            <tbody>{sim.changes.map((c: any) => <tr key={c.caseId}><td>{c.caseId}</td><td>{c.before}</td><td><b>{c.after}</b></td></tr>)}</tbody></table>}
        </div>
      )}

      <details><summary>Version history</summary>
        <table className="table"><thead><tr><th>Version</th><th>Note</th><th>Created</th></tr></thead>
          <tbody>{history.map(h => <tr key={h.version}><td>v{h.version}{h.is_active ? " (active)" : ""}</td><td>{h.change_note}</td><td>{when(h.created_at)}</td></tr>)}</tbody></table>
      </details>
    </section>
  );
}
