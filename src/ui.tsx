import { useState } from "react";
import type { Decision, TraceStep } from "./api";
import { compressImage } from "./image";

const LABEL: Record<string, string> = {
  APPROVE_REPLACEMENT: "Replacement approved", APPROVE_REFUND: "Refund approved", APPROVE_EXCHANGE: "Exchange approved",
  ASK_FOR_EVIDENCE: "Better photo needed", HUMAN_REVIEW: "Sent to human review", REJECT: "Rejected",
};
const TONE = (d: string) => d.startsWith("APPROVE") ? "good" : d === "REJECT" ? "bad" : "warn";

export function DecisionBadge({ decision }: { decision: Decision | string }) {
  return <span className={`badge ${TONE(decision)}`}>{LABEL[decision] ?? decision}</span>;
}

const FLAG_TEXT: Record<string, string> = {
  TRANSIT_DAMAGE: "Damaged in transit", SWAP_SUSPECTED: "Swap / empty box suspected",
  UNIT_MISMATCH: "Not the packed item", PROOF_CODE_MISSING: "Proof code missing",
};
export function Flags({ flags }: { flags?: string[] }) {
  if (!flags?.length) return null;
  return <span className="flags">{flags.map(f => <span key={f} className={`flag ${f === "TRANSIT_DAMAGE" ? "info" : "alert"}`}>{FLAG_TEXT[f] ?? f}</span>)}</span>;
}

export function Trace({ steps }: { steps: TraceStep[] }) {
  return (
    <ol className="trace">
      {steps.map((s, i) => (
        <li key={i} className={s.ok ? "ok" : "no"}>
          <span className="dot">{s.ok ? "✓" : "!"}</span>
          <div><b>{s.step}</b><div className="muted">{s.detail}</div></div>
        </li>
      ))}
    </ol>
  );
}

export function PhotoInput({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="photo-input">
      <label className="btn secondary">
        {busy ? "Processing…" : value ? "Change photo" : label}
        <input type="file" accept="image/*" capture="environment" hidden
          onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            setBusy(true); setErr(null);
            try { onChange(await compressImage(f)); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
          }} />
      </label>
      {value && <img src={value} alt={label} className="preview" />}
      {err && <div className="error">{err}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error-box">⚠️ {error}</div> : null;
}

export const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;
export const when = (s: string) => new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
