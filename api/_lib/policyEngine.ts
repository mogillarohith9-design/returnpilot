// ReturnPilot policy engine.
// The LLM never decides. It only fills `Facts`. This file turns facts + order + live policy
// into a decision, deterministically, with a trace a judge can read.

export type ReasonCode =
  | "DAMAGED" | "DEFECTIVE" | "WRONG_ITEM" | "WRONG_COLOUR" | "WRONG_SIZE" | "CHANGED_MIND" | "OTHER";

export type Decision =
  | "APPROVE_REPLACEMENT" | "APPROVE_REFUND" | "APPROVE_EXCHANGE"
  | "ASK_FOR_EVIDENCE" | "HUMAN_REVIEW" | "REJECT";

export type Action = "REPLACEMENT" | "REFUND" | "EXCHANGE" | "HUMAN_INSPECTION";

export interface Order {
  id: string;
  sku: string;
  category: string;        // e.g. "electronics", "apparel"
  colour?: string;
  price: number;           // INR
  deliveredAt: string;     // ISO date
}

// Filled by the vision model as a checklist. Each item is true/false, never a free-form score.
export interface EvidenceChecklist {
  photoProvided: boolean;
  productVisible: boolean;
  matchesOrderedProduct: boolean; // same product type/model as the order
  defectVisible: boolean;         // damage or fault visible
  imageClear: boolean;            // in focus, well lit
  observedColour?: string;        // colour seen in the photo
}

// Evidence chain: the same order photographed at packing, at claim and on return.
// Each field is filled by a vision comparison; undefined = that photo does not exist yet.
export interface EvidenceChain {
  dispatchPhotoIntact?: boolean;          // seller's packing photo shows the item undamaged
  claimMatchesDispatch?: boolean;         // customer's photo shows the same unit that was packed
  receivedMatchesDispatch?: boolean;      // warehouse photo shows the same unit that was packed (swap / empty box check)
}

export interface Facts {
  reason: ReasonCode;             // from the LLM, constrained to the enum
  evidence: EvidenceChecklist;
  proofCodeValid?: boolean;       // set by the SERVER: code read from the photo == code issued, and not expired
  chain?: EvidenceChain;
}

export interface CategoryRule {
  clauseId: string;               // shown in the trace, e.g. "ELEC-DMG-30"
  windowDays: number;
  onDamaged: Action;
  onWrongItem: Action;
  changeOfMindAllowed: boolean;
  evidenceRequired: boolean;
}

export interface Policy {
  version: number;
  autoThreshold: number;          // >= this: act automatically
  retakeThreshold: number;        // >= this but < auto: ask for a better photo; below: human review
  humanReviewAbovePrice: number;  // high-value orders always need a human
  maxReturns90d: number;          // more than this: human review
  requireProofCode?: boolean;     // claim photo must show the one-time code issued by the app
  categories: Record<string, CategoryRule>;
}

export interface Customer { id: string; returnsLast90d: number; }

export interface TraceStep { step: string; detail: string; ok: boolean; }

export type Flag = "TRANSIT_DAMAGE" | "SWAP_SUSPECTED" | "UNIT_MISMATCH" | "PROOF_CODE_MISSING";

export interface Result {
  decision: Decision;
  flags: Flag[];
  clauseId?: string;
  policyVersion: number;
  evidenceScore?: number;
  trace: TraceStep[];
  customerMessage: string;
}

const DAY = 86_400_000;

// Weights are ours and visible in the UI. Defect reasons need a visible defect;
// wrong-item reasons need a visible mismatch instead.
export function evidenceScore(reason: ReasonCode, e: EvidenceChecklist, order: Order): number {
  if (!e.photoProvided) return 0;
  if (reason === "WRONG_ITEM" || reason === "WRONG_COLOUR") {
    const colourMismatch =
      reason === "WRONG_COLOUR" && !!e.observedColour && !!order.colour &&
      e.observedColour.toLowerCase() !== order.colour.toLowerCase();
    const mismatch = reason === "WRONG_ITEM" ? !e.matchesOrderedProduct : colourMismatch;
    return round(0.3 * +e.productVisible + 0.4 * +mismatch + 0.3 * +e.imageClear);
  }
  return round(
    0.25 * +e.productVisible + 0.25 * +e.matchesOrderedProduct + 0.3 * +e.defectVisible + 0.2 * +e.imageClear,
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

const actionToDecision: Record<Exclude<Action, "HUMAN_INSPECTION">, Decision> = {
  REPLACEMENT: "APPROVE_REPLACEMENT",
  REFUND: "APPROVE_REFUND",
  EXCHANGE: "APPROVE_EXCHANGE",
};

export function decide(order: Order, facts: Facts, policy: Policy, customer: Customer, now: Date): Result {
  const trace: TraceStep[] = [];
  const flags: Flag[] = [];
  const done = (decision: Decision, msg: string, extra: Partial<Result> = {}): Result =>
    ({ decision, flags, policyVersion: policy.version, trace, customerMessage: msg, ...extra });

  trace.push({ step: "Request understood", detail: `Reason: ${facts.reason}`, ok: true });

  const rule = policy.categories[order.category];
  if (!rule) {
    trace.push({ step: "Policy lookup", detail: `No rule for category "${order.category}"`, ok: false });
    return done("HUMAN_REVIEW", "A support specialist will review your request.");
  }
  trace.push({ step: "Policy lookup", detail: `Clause ${rule.clauseId} (policy v${policy.version})`, ok: true });

  // Evidence chain, stage 3: the item is back at the warehouse. A mismatch blocks the refund before anything else.
  if (facts.chain?.receivedMatchesDispatch === false) {
    flags.push("SWAP_SUSPECTED");
    trace.push({ step: "Returned item check", detail: "Received item does not match the dispatch photo", ok: false });
    return done("HUMAN_REVIEW", "Your return is being checked by our team before the refund is released.",
      { clauseId: rule.clauseId });
  }
  if (facts.chain?.receivedMatchesDispatch === true) {
    trace.push({ step: "Returned item check", detail: "Received item matches the dispatch photo", ok: true });
  }

  const days = Math.floor((now.getTime() - Date.parse(order.deliveredAt)) / DAY);
  const inWindow = days <= rule.windowDays;
  trace.push({ step: "Return window", detail: `${days} days since delivery, limit ${rule.windowDays}`, ok: inWindow });
  if (!inWindow) {
    return done("REJECT", `This order is outside the ${rule.windowDays}-day return window (clause ${rule.clauseId}).`,
      { clauseId: rule.clauseId });
  }

  if (facts.reason === "CHANGED_MIND") {
    trace.push({ step: "Change of mind", detail: rule.changeOfMindAllowed ? "Allowed" : "Not allowed", ok: rule.changeOfMindAllowed });
    return rule.changeOfMindAllowed
      ? done("APPROVE_REFUND", "Your return is approved. A pickup will be scheduled.", { clauseId: rule.clauseId })
      : done("REJECT", `Change-of-mind returns are not accepted for this category (clause ${rule.clauseId}).`,
          { clauseId: rule.clauseId });
  }

  // Risk gates run before automation so a high-value or repeat case never auto-resolves.
  const highValue = order.price > policy.humanReviewAbovePrice;
  const repeat = customer.returnsLast90d > policy.maxReturns90d;
  trace.push({
    step: "Risk check",
    detail: `Order value Rs ${order.price} (limit ${policy.humanReviewAbovePrice}), returns in 90 days: ${customer.returnsLast90d} (limit ${policy.maxReturns90d})`,
    ok: !highValue && !repeat,
  });

  const needsEvidence = rule.evidenceRequired && facts.reason !== "WRONG_SIZE" && facts.reason !== "OTHER";
  let score: number | undefined;
  if (needsEvidence) {
    // Proof-of-now: the photo must show the one-time code the app issued, so an old or downloaded photo fails.
    if (policy.requireProofCode && facts.evidence.photoProvided) {
      const ok = facts.proofCodeValid === true;
      trace.push({ step: "Proof-of-now code", detail: ok ? "Code in photo matches the code issued" : "Code missing, wrong or expired", ok });
      if (!ok) {
        flags.push("PROOF_CODE_MISSING");
        return done("ASK_FOR_EVIDENCE", "Please take a new photo with the code shown on screen written on a paper next to the item.",
          { clauseId: rule.clauseId });
      }
    }

    // Evidence chain, stages 1 and 2: compare the claim photo with the seller's packing photo.
    if (facts.chain?.claimMatchesDispatch === false) {
      flags.push("UNIT_MISMATCH");
      trace.push({ step: "Dispatch comparison", detail: "Item in the claim photo is not the unit that was packed", ok: false });
      return done("HUMAN_REVIEW", "A specialist will compare your photo with our dispatch records.", { clauseId: rule.clauseId });
    }
    if (facts.chain?.dispatchPhotoIntact === true && facts.evidence.defectVisible &&
        (facts.reason === "DAMAGED" || facts.reason === "DEFECTIVE")) {
      flags.push("TRANSIT_DAMAGE");
      trace.push({ step: "Dispatch comparison", detail: "Packed intact, damaged on arrival: damage happened in transit", ok: true });
    }

    score = evidenceScore(facts.reason, facts.evidence, order);
    const e = facts.evidence;
    trace.push({
      step: "Evidence check",
      detail: `Score ${score} (visible ${+e.productVisible}, matches ${+e.matchesOrderedProduct}, defect ${+e.defectVisible}, clear ${+e.imageClear})`,
      ok: score >= policy.autoThreshold,
    });
    if (score < policy.retakeThreshold) {
      return done("HUMAN_REVIEW", "We could not verify the issue from the photo. A specialist will review it.",
        { clauseId: rule.clauseId, evidenceScore: score });
    }
    if (score < policy.autoThreshold) {
      return done("ASK_FOR_EVIDENCE", "Could you upload a clearer photo showing the issue?",
        { clauseId: rule.clauseId, evidenceScore: score });
    }
  }

  if (highValue || repeat) {
    return done("HUMAN_REVIEW", "Your request needs a quick check by our team.", { clauseId: rule.clauseId, evidenceScore: score });
  }

  const action: Action =
    facts.reason === "WRONG_ITEM" || facts.reason === "WRONG_COLOUR" || facts.reason === "WRONG_SIZE"
      ? rule.onWrongItem
      : facts.reason === "DAMAGED" || facts.reason === "DEFECTIVE"
        ? rule.onDamaged
        : "HUMAN_INSPECTION";

  trace.push({ step: "Resolution", detail: `Policy action: ${action}`, ok: action !== "HUMAN_INSPECTION" });
  if (action === "HUMAN_INSPECTION") {
    return done("HUMAN_REVIEW", "Our team will inspect this request before resolving it.",
      { clauseId: rule.clauseId, evidenceScore: score });
  }
  const decision = actionToDecision[action];
  return done(decision, `Approved: ${action.toLowerCase()} under clause ${rule.clauseId}.`,
    { clauseId: rule.clauseId, evidenceScore: score });
}

// Policy What-If Simulator: replay saved cases under a draft policy BEFORE publishing it.
// Possible only because decide() is deterministic: same facts + same policy = same decision.
export interface SavedCase { caseId: string; order: Order; facts: Facts; customer: Customer; decidedAt: string; }
export interface SimChange { caseId: string; before: Decision; after: Decision; afterClause?: string; }

export function simulatePolicy(cases: SavedCase[], current: Policy, draft: Policy) {
  const changes: SimChange[] = [];
  for (const c of cases) {
    const at = new Date(c.decidedAt); // judge each case as of its original decision date
    const before = decide(c.order, c.facts, current, c.customer, at);
    const after = decide(c.order, c.facts, draft, c.customer, at);
    if (before.decision !== after.decision) {
      changes.push({ caseId: c.caseId, before: before.decision, after: after.decision, afterClause: after.clauseId });
    }
  }
  return { total: cases.length, changed: changes.length, changes };
}
