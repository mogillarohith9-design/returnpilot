import { route, HttpError } from "./_lib/http.js";
import { db, check, audit, activePolicy } from "./_lib/db.js";
import { bundle } from "./_lib/data.js";
import { simulatePolicy, type Policy, type SavedCase, type Action } from "./_lib/policyEngine.js";

const ACTIONS: Action[] = ["REPLACEMENT", "REFUND", "EXCHANGE", "HUMAN_INSPECTION"];

// Never trust the browser: rebuild the policy from known fields with range checks.
function validate(input: any, version: number): Policy {
  if (!input || typeof input !== "object") throw new HttpError(400, "rules missing");
  const num = (v: any, name: string, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}`);
    return n;
  };
  const categories: Policy["categories"] = {};
  for (const [key, c] of Object.entries<any>(input.categories ?? {})) {
    if (!ACTIONS.includes(c?.onDamaged) || !ACTIONS.includes(c?.onWrongItem)) throw new HttpError(400, `Invalid action for ${key}`);
    categories[key] = {
      clauseId: String(c.clauseId ?? key).slice(0, 20),
      windowDays: num(c.windowDays, `${key} return window`, 0, 365),
      onDamaged: c.onDamaged, onWrongItem: c.onWrongItem,
      changeOfMindAllowed: !!c.changeOfMindAllowed, evidenceRequired: c.evidenceRequired !== false,
    };
  }
  if (!Object.keys(categories).length) throw new HttpError(400, "At least one category is required");
  const autoThreshold = num(input.autoThreshold, "Auto threshold", 0, 1);
  const retakeThreshold = num(input.retakeThreshold, "Retake threshold", 0, 1);
  if (retakeThreshold > autoThreshold) throw new HttpError(400, "Retake threshold must be below the auto threshold");
  return {
    version, autoThreshold, retakeThreshold,
    humanReviewAbovePrice: num(input.humanReviewAbovePrice, "High-value limit", 0, 10_000_000),
    maxReturns90d: num(input.maxReturns90d, "Max returns in 90 days", 0, 100),
    requireProofCode: !!input.requireProofCode,
    categories,
  };
}

// Every past case that has AI facts, ready to replay through the engine.
async function savedCases(): Promise<SavedCase[]> {
  const cases = check(await db().from("return_cases").select("id, created_at, orders(*, products(*), customers(*))"), "Load cases");
  const decisions = check(await db().from("decisions").select("case_id, facts, created_at").not("facts", "is", null).order("created_at"), "Load facts");
  const facts = new Map<string, any>();
  for (const d of decisions ?? []) facts.set(d.case_id, d.facts);
  const out: SavedCase[] = [];
  for (const c of cases ?? []) {
    const f = facts.get((c as any).id);
    if (!f || !(c as any).orders) continue;
    const b = bundle((c as any).orders);
    out.push({ caseId: (c as any).id, order: b.order, facts: f, customer: b.customer, decidedAt: (c as any).created_at });
  }
  return out;
}

export default route({
  GET: async () => {
    const active = await activePolicy();
    const history = check(await db().from("policies").select("version, change_note, created_at, is_active").order("version", { ascending: false }), "Load history");
    return { active, history };
  },
  // mode "simulate": preview which past decisions would change. mode "save": publish as a new version.
  POST: async (req) => {
    const mode = req.body?.mode === "save" ? "save" : "simulate";
    const current = await activePolicy();
    const draft = validate(req.body?.rules, current.version + 1);
    const simulation = simulatePolicy(await savedCases(), current.rules, draft);
    if (mode === "simulate") return { simulation };

    const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 200) : "Policy updated";
    check(await db().from("policies").update({ is_active: false }).eq("version", current.version), "Retire old policy");
    const ins = await db().from("policies").insert({ version: draft.version, rules: draft, is_active: true, change_note: note });
    if (ins.error) {
      await db().from("policies").update({ is_active: true }).eq("version", current.version); // roll back
      throw new HttpError(500, `Save policy: ${ins.error.message}`);
    }
    await audit(null, "admin", "policy.updated", { from: current.version, to: draft.version, note, changed: simulation.changed });
    return { saved: draft.version, simulation };
  },
});
