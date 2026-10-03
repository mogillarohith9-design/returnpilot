// Run: node --experimental-strip-types --test chainAndSim.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, simulatePolicy, type Policy, type Order, type Facts, type SavedCase } from "../api/_lib/policyEngine.ts";

const now = new Date("2026-10-04T10:00:00Z");
const policy: Policy = {
  version: 1, autoThreshold: 0.8, retakeThreshold: 0.6, humanReviewAbovePrice: 20000, maxReturns90d: 3, requireProofCode: true,
  categories: {
    electronics: { clauseId: "ELEC-30", windowDays: 30, onDamaged: "REPLACEMENT", onWrongItem: "EXCHANGE", changeOfMindAllowed: false, evidenceRequired: true },
    apparel: { clauseId: "APP-15", windowDays: 15, onDamaged: "REFUND", onWrongItem: "EXCHANGE", changeOfMindAllowed: true, evidenceRequired: true },
  },
};
const headphones: Order = { id: "ORD-1042", sku: "SONIC-X2", category: "electronics", colour: "Black", price: 4999, deliveredAt: "2026-09-22T10:00:00Z" };
const customer = { id: "C1", returnsLast90d: 0 };
const goodPhoto = { photoProvided: true, productVisible: true, matchesOrderedProduct: true, defectVisible: true, imageClear: true };
const claim: Facts = { reason: "DAMAGED", evidence: goodPhoto, proofCodeValid: true };

test("Proof-of-now: photo without the issued code is sent back for a retake", () => {
  const r = decide(headphones, { ...claim, proofCodeValid: false }, policy, customer, now);
  assert.equal(r.decision, "ASK_FOR_EVIDENCE");
  assert.deepEqual(r.flags, ["PROOF_CODE_MISSING"]);
});

test("Proof-of-now: valid code passes through to the normal decision", () => {
  assert.equal(decide(headphones, claim, policy, customer, now).decision, "APPROVE_REPLACEMENT");
});

test("Chain: packed intact + damaged on arrival -> approved and flagged as transit damage", () => {
  const r = decide(headphones, { ...claim, chain: { dispatchPhotoIntact: true, claimMatchesDispatch: true } }, policy, customer, now);
  assert.equal(r.decision, "APPROVE_REPLACEMENT");
  assert.deepEqual(r.flags, ["TRANSIT_DAMAGE"]);
});

test("Chain: claim photo shows a different unit than was packed -> human review", () => {
  const r = decide(headphones, { ...claim, chain: { dispatchPhotoIntact: true, claimMatchesDispatch: false } }, policy, customer, now);
  assert.equal(r.decision, "HUMAN_REVIEW");
  assert.deepEqual(r.flags, ["UNIT_MISMATCH"]);
});

test("Chain: returned item does not match dispatch (swap / empty box) -> refund held", () => {
  const r = decide(headphones, { ...claim, chain: { dispatchPhotoIntact: true, claimMatchesDispatch: true, receivedMatchesDispatch: false } }, policy, customer, now);
  assert.equal(r.decision, "HUMAN_REVIEW");
  assert.deepEqual(r.flags, ["SWAP_SUSPECTED"]);
});

test("Chain: returned item matches -> resolution goes ahead", () => {
  const r = decide(headphones, { ...claim, chain: { dispatchPhotoIntact: true, claimMatchesDispatch: true, receivedMatchesDispatch: true } }, policy, customer, now);
  assert.equal(r.decision, "APPROVE_REPLACEMENT");
});

test("No chain photos at all -> falls back to the single-photo check", () => {
  assert.equal(decide(headphones, claim, policy, customer, now).decision, "APPROVE_REPLACEMENT");
});

test("What-if simulator: shortening the window to 7 days shows which past cases would flip", () => {
  const cases: SavedCase[] = [
    { caseId: "RET-1", order: headphones, facts: claim, customer, decidedAt: "2026-10-04T10:00:00Z" },               // day 12
    { caseId: "RET-2", order: { ...headphones, id: "ORD-2", deliveredAt: "2026-10-01T10:00:00Z" }, facts: claim, customer, decidedAt: "2026-10-04T10:00:00Z" }, // day 3
    { caseId: "RET-3", order: { ...headphones, id: "ORD-3", deliveredAt: "2026-09-10T10:00:00Z" }, facts: claim, customer, decidedAt: "2026-10-04T10:00:00Z" }, // day 24
  ];
  const draft: Policy = { ...policy, version: 2, categories: { ...policy.categories, electronics: { ...policy.categories.electronics, windowDays: 7 } } };
  const sim = simulatePolicy(cases, policy, draft);
  assert.equal(sim.total, 3);
  assert.equal(sim.changed, 2);
  assert.deepEqual(sim.changes.map(c => c.caseId), ["RET-1", "RET-3"]);
  assert.ok(sim.changes.every(c => c.before === "APPROVE_REPLACEMENT" && c.after === "REJECT"));
});
