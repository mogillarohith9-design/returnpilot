import { db, check, activePolicy } from "./db.js";
import { loadOrder } from "./data.js";
import { assessClaim } from "./assess.js";
import { decide, type Result } from "./policyEngine.js";

// Runs the full claim check: AI reads evidence, the server checks the code, the engine decides.
// `at` is the moment the customer submitted, so a later "retry" judges the code and window as of then.
export async function runClaim(opts: { orderId: string; customerText: string; claimPhoto: string | null; at: Date }) {
  const { order, row, product, customer } = await loadOrder(opts.orderId);
  const policy = await activePolicy();
  let result: Result;
  let facts: any = null, model: string | null = null;
  let extra: { language?: string | null; summary?: string | null; reply_customer?: string | null } = {};
  let aiOk = false;
  try {
    const a = await assessClaim({ product, customerText: opts.customerText, claimPhoto: opts.claimPhoto, dispatchPhoto: row.dispatch_photo ?? null });
    model = a.model;
    // Proof-of-now: the code must have been issued for this order and still been valid when the claim was made.
    a.facts.proofCodeValid = false;
    if (a.codeRead) {
      const iso = opts.at.toISOString();
      const codes = check(await db().from("proof_codes").select("code").eq("order_id", opts.orderId).eq("code", a.codeRead)
        .lte("created_at", iso).gte("expires_at", iso).limit(1), "Check code");
      a.facts.proofCodeValid = !!codes?.length;
    }
    // If the words were unclear but the photo clearly shows damage, the photo decides the reason. Shown in the trace.
    const reasonFromPhoto = a.facts.reason === "OTHER" && a.facts.evidence.photoProvided && a.facts.evidence.defectVisible;
    if (reasonFromPhoto) a.facts.reason = "DAMAGED";
    facts = a.facts;
    extra = { language: a.language, summary: a.summary, reply_customer: a.clarifyingQuestion ?? a.reply };
    result = decide(order, a.facts, policy.rules, customer, opts.at);
    if (reasonFromPhoto) result.trace.splice(1, 0, { step: "Reason from photo", detail: "Message unclear, photo shows damage: treated as DAMAGED", ok: true });
    result.trace.unshift({ step: "Evidence read by AI", detail: `Model ${a.model}; code read from photo: ${a.codeRead ?? "none"}`, ok: true });
    // When the photo does not show the problem, use the AI's specific question instead of a generic one.
    if (result.decision === "ASK_FOR_EVIDENCE" && !result.flags.includes("PROOF_CODE_MISSING") && a.clarifyingQuestion) {
      result.customerMessage = a.clarifyingQuestion;
    } else if (result.decision === "ASK_FOR_EVIDENCE" && !result.flags.includes("PROOF_CODE_MISSING") && !a.facts.evidence.defectVisible) {
      result.customerMessage = "We could not see the problem in the photo. Please take a close photo of the damaged or faulty part.";
    }
    aiOk = true;
  } catch (e) {
    // AI down: never guess. The case goes to a human, and the trace says why.
    const msg = e instanceof Error ? e.message : String(e);
    result = { decision: "HUMAN_REVIEW", flags: [], policyVersion: policy.version,
      customerMessage: "Our team will review your request shortly.",
      trace: [{ step: "AI evidence check", detail: `Unavailable, sent to a human: ${msg.slice(0, 200)}`, ok: false }] };
  }
  return { result, facts, model, extra, aiOk, policyVersion: policy.version, productName: product.name };
}
