import { route, requireString, optionalImage } from "./_lib/http.js";
import { db, check, audit } from "./_lib/db.js";
import { statusFor, newCaseId } from "./_lib/data.js";
import { runClaim } from "./_lib/claim.js";

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
    const fraud = new Set<string>();
    for (const d of decisions ?? []) {
      latest.set(d.case_id, d); // ordered ascending, so the last one wins
      if ((d.flags ?? []).some((f: string) => f === "SWAP_SUSPECTED" || f === "UNIT_MISMATCH")) fraud.add(d.case_id);
    }
    return { cases: (cases ?? []).map((c: any) => ({ ...c, latest: latest.get(c.id) ?? null, fraud: fraud.has(c.id) })) };
  },

  // Customer files a return: AI reads message + photos, server checks the code, engine decides.
  POST: async (req) => {
    const orderId = requireString(req.body?.orderId, "orderId", 40);
    const customerText = requireString(req.body?.customerText, "Description", 2000);
    const claimPhoto = optionalImage(req.body?.claimPhoto, "Photo");
    const caseId = newCaseId();
    const now = new Date();
    const { result, facts, model, extra, policyVersion, productName } = await runClaim({ orderId, customerText, claimPhoto, at: now });

    check(await db().from("return_cases").insert({
      id: caseId, order_id: orderId, customer_text: customerText, claim_photo: claimPhoto,
      status: statusFor(result.decision), created_at: now.toISOString(), ...extra,
    }), "Save case");
    check(await db().from("decisions").insert({
      case_id: caseId, stage: "claim", policy_version: policyVersion, facts, decision: result.decision,
      flags: result.flags, clause_id: result.clauseId ?? null, evidence_score: result.evidenceScore ?? null,
      trace: result.trace, customer_message: result.customerMessage, model,
    }), "Save decision");
    await audit(caseId, "customer", "case.created", { orderId });
    await audit(caseId, "agent", "decision.made", { decision: result.decision, flags: result.flags, policyVersion, model });

    return { caseId, result, ...extra, product: productName };
  },
});
