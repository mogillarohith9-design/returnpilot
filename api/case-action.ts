import { route, requireString, optionalImage, HttpError } from "./_lib/http.js";
import { db, check, audit, activePolicy } from "./_lib/db.js";
import { loadOrder, statusFor } from "./_lib/data.js";
import { assessReceived } from "./_lib/assess.js";
import { runClaim } from "./_lib/claim.js";
import { decide, type Decision } from "./_lib/policyEngine.js";

export const config = { maxDuration: 60 };

const HUMAN_OUTCOMES: Decision[] = ["APPROVE_REPLACEMENT", "APPROVE_REFUND", "APPROVE_EXCHANGE", "REJECT"];

async function lastFacts(caseId: string) {
  const rows = check(await db().from("decisions").select("facts").eq("case_id", caseId).not("facts", "is", null)
    .order("created_at", { ascending: false }).limit(1), "Load facts");
  return rows?.[0]?.facts ?? null;
}

async function saveDecision(caseId: string, stage: string, r: any, facts: any, model: string | null, status: string) {
  check(await db().from("decisions").insert({
    case_id: caseId, stage, policy_version: r.policyVersion ?? null, facts, decision: r.decision, flags: r.flags ?? [],
    clause_id: r.clauseId ?? null, evidence_score: r.evidenceScore ?? null, trace: r.trace ?? [], customer_message: r.customerMessage ?? null, model,
  }), "Save decision");
  check(await db().from("return_cases").update({ status, updated_at: new Date().toISOString() }).eq("id", caseId), "Update case");
}

export default route({
  POST: async (req) => {
    const caseId = requireString(req.body?.caseId, "caseId", 40);
    const action = requireString(req.body?.action, "action", 20);
    const rows = check(await db().from("return_cases").select("*").eq("id", caseId).limit(1), "Load case");
    const kase = rows?.[0];
    if (!kase) throw new HttpError(404, `Case ${caseId} not found`);
    const { order, row, customer } = await loadOrder(kase.order_id);

    // Support agent overrides or confirms. Always recorded with the agent's note.
    if (action === "human") {
      const outcome = req.body?.outcome as Decision;
      if (!HUMAN_OUTCOMES.includes(outcome)) throw new HttpError(400, "Choose a valid outcome");
      const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : "";
      const r = { decision: outcome, flags: [], trace: [{ step: "Human decision", detail: note || "No note", ok: true }],
        customerMessage: outcome === "REJECT" ? "After review, this return could not be approved." : "After review, your return is approved." };
      await saveDecision(caseId, "human", r, null, null, statusFor(outcome));
      await audit(caseId, "support", "human.decision", { outcome, note });
      return { ok: true, decision: outcome };
    }

    // Retry the whole AI check (e.g. the AI was busy). Judged as of the original submission time.
    if (action === "reassess") {
      const r = await runClaim({ orderId: kase.order_id, customerText: kase.customer_text, claimPhoto: kase.claim_photo, at: new Date(kase.created_at) });
      if (!r.aiOk) throw new HttpError(503, r.result.trace[0]?.detail ?? "AI still unavailable");
      await saveDecision(caseId, "claim", r.result, r.facts, r.model, statusFor(r.result.decision));
      check(await db().from("return_cases").update({ ...r.extra }).eq("id", caseId), "Update case");
      await audit(caseId, "support", "ai.retried", { decision: r.result.decision, model: r.model });
      return { ok: true, result: r.result };
    }

    // Re-check the stored facts against the CURRENT policy (no new AI call): shows the policy is live.
    if (action === "rerun") {
      const facts = await lastFacts(caseId);
      if (!facts) throw new HttpError(400, "This case has no AI facts to re-check (it was decided by a human or the AI was down)");
      const policy = await activePolicy();
      const r = decide(order, facts, policy.rules, customer, new Date(kase.created_at));
      await saveDecision(caseId, "rerun", r, facts, null, statusFor(r.decision));
      await audit(caseId, "support", "policy.rerun", { policyVersion: policy.version, decision: r.decision });
      return { ok: true, result: r };
    }

    // Warehouse photographs what came back; AI compares it with the packing photo (evidence chain, stage 3).
    if (action === "received") {
      const photo = optionalImage(req.body?.receivedPhoto, "receivedPhoto");
      if (!photo) throw new HttpError(400, "receivedPhoto is required");
      if (!row.dispatch_photo) throw new HttpError(400, "No packing photo for this order. Upload it in the Warehouse tab first.");
      const check3 = await assessReceived(row.dispatch_photo, photo);
      const prior = (await lastFacts(caseId)) ?? { reason: "OTHER", evidence: { photoProvided: false, productVisible: false, matchesOrderedProduct: false, defectVisible: false, imageClear: false } };
      const facts = { ...prior, chain: { ...(prior.chain ?? {}), receivedMatchesDispatch: check3.receivedMatchesDispatch } };
      const policy = await activePolicy();
      const r = decide(order, facts, policy.rules, customer, new Date(kase.created_at));
      r.trace.unshift({ step: "Warehouse photo read by AI", detail: `Model ${check3.model}${check3.note ? `: ${check3.note}` : ""}`, ok: check3.receivedMatchesDispatch });
      const status = r.flags.includes("SWAP_SUSPECTED") ? "REFUND_HELD" : r.decision.startsWith("APPROVE") ? "RESOLVED" : statusFor(r.decision);
      check(await db().from("return_cases").update({ received_photo: photo }).eq("id", caseId), "Save received photo");
      await saveDecision(caseId, "received", r, facts, check3.model, status);
      await audit(caseId, "warehouse", "return.received", { matches: check3.receivedMatchesDispatch, note: check3.note });
      return { ok: true, result: r, status, note: check3.note };
    }

    throw new HttpError(400, `Unknown action ${action}`);
  },
});
