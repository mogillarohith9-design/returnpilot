import { route, requireString, optionalImage } from "./_lib/http.js";
import { db, check, audit, activePolicy } from "./_lib/db.js";
import { loadOrder, statusFor, newCaseId } from "./_lib/data.js";
import { assessClaim } from "./_lib/assess.js";
import { decide, type Result } from "./_lib/policyEngine.js";

export const config = { maxDuration: 60 };

export default route({
  // List (no photos, to stay light) or one case in full with ?id=
  GET: async (req) => {
    const id = typeof req.query.id === "string" ? req.query.id : null;
    if (id) {
      const rows = check(await db().from("return_cases").select("*, orders(*, products(*), customers(*))").eq("id", id).limit(1), "Load case");
      if (!rows?.length) return { case: null };
      const decisions = check(await db().from("decisions").select("*").eq("case_id", id).order("created_at"), "Load decisions");
      const audit = check(await db().from("audit_log").select("*").eq("case_id", id).order("created_at"), "Load audit");
      return { case: rows[0], decisions, audit };
    }
    const cases = check(await db().from("return_cases")
      .select("id, order_id, customer_text, language, summary, status, created_at, updated_at, orders(id, price, products(name, category), customers(name))")
      .order("created_at", { ascending: false }).limit(100), "Load cases");
    const ids = (cases ?? []).map((c: any) => c.id);
    const decisions = ids.length
      ? check(await db().from("decisions").select("case_id, decision, flags, clause_id, evidence_score, stage, created_at").in("case_id", ids).order("created_at"), "Load decisions")
      : [];
    const latest = new Map<string, any>();
    for (const d of decisions ?? []) latest.set(d.case_id, d); // ordered ascending, so the last one wins
    return { cases: (cases ?? []).map((c: any) => ({ ...c, latest: latest.get(c.id) ?? null })) };
  },

  // Customer files a return: AI reads message + photos, server checks the code, engine decides.
  POST: async (req) => {
    const orderId = requireString(req.body?.orderId, "orderId", 40);
    const customerText = requireString(req.body?.customerText, "Description", 2000);
    const claimPhoto = optionalImage(req.body?.claimPhoto, "Photo");
    const { order, row, product, customer } = await loadOrder(orderId);
    const policy = await activePolicy();
    const now = new Date();
    const caseId = newCaseId();

    let result: Result;
    let facts: any = null, model: string | null = null, extra: any = {};
    try {
      const a = await assessClaim({ product, customerText, claimPhoto, dispatchPhoto: row.dispatch_photo ?? null });
      model = a.model;
      // Proof-of-now: the server, not the AI, compares the code read from the photo with the code issued.
      if (a.codeRead) {
        const codes = check(await db().from("proof_codes").select("code").eq("order_id", orderId).eq("code", a.codeRead).gt("expires_at", now.toISOString()).limit(1), "Check code");
        a.facts.proofCodeValid = !!codes?.length;
      } else {
        a.facts.proofCodeValid = false;
      }
      facts = a.facts;
      extra = { language: a.language, summary: a.summary, reply_customer: a.clarifyingQuestion ?? a.reply };
      result = decide(order, a.facts, policy.rules, customer, now);
      result.trace.unshift({ step: "Evidence read by AI", detail: `Model ${a.model}; code read from photo: ${a.codeRead ?? "none"}`, ok: true });
    } catch (e) {
      // AI down: never guess. The case goes to a human, and the trace says why.
      const msg = e instanceof Error ? e.message : String(e);
      result = { decision: "HUMAN_REVIEW", flags: [], policyVersion: policy.version, customerMessage: "Our team will review your request shortly.",
        trace: [{ step: "AI evidence check", detail: `Unavailable, sent to a human: ${msg.slice(0, 200)}`, ok: false }] };
    }

    check(await db().from("return_cases").insert({
      id: caseId, order_id: orderId, customer_text: customerText, claim_photo: claimPhoto,
      status: statusFor(result.decision), ...extra,
    }), "Save case");
    check(await db().from("decisions").insert({
      case_id: caseId, stage: "claim", policy_version: policy.version, facts, decision: result.decision,
      flags: result.flags, clause_id: result.clauseId ?? null, evidence_score: result.evidenceScore ?? null,
      trace: result.trace, customer_message: result.customerMessage, model,
    }), "Save decision");
    await audit(caseId, "customer", "case.created", { orderId });
    await audit(caseId, "agent", "decision.made", { decision: result.decision, flags: result.flags, policyVersion: policy.version, model });

    return { caseId, result, ...extra, product: product.name };
  },
});
