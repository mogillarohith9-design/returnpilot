// Run: node --experimental-strip-types --test demoCases.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, type Policy, type Order, type Facts } from "../api/_lib/policyEngine.ts";

const now = new Date("2026-10-04T10:00:00Z");

const basePolicy: Policy = {
  version: 1,
  autoThreshold: 0.8,
  retakeThreshold: 0.6,
  humanReviewAbovePrice: 20000,
  maxReturns90d: 3,
  categories: {
    electronics: { clauseId: "ELEC-30", windowDays: 30, onDamaged: "REPLACEMENT", onWrongItem: "EXCHANGE", changeOfMindAllowed: false, evidenceRequired: true },
    apparel: { clauseId: "APP-15", windowDays: 15, onDamaged: "REFUND", onWrongItem: "EXCHANGE", changeOfMindAllowed: true, evidenceRequired: true },
  },
};

const headphones: Order = { id: "ORD-1042", sku: "SONIC-X2", category: "electronics", colour: "Black", price: 4999, deliveredAt: "2026-09-22T10:00:00Z" };
const tshirt: Order = { id: "ORD-2077", sku: "TEE-M-BLK", category: "apparel", colour: "Black", price: 899, deliveredAt: "2026-09-29T10:00:00Z" };
const customer = { id: "C1", returnsLast90d: 0 };

const goodDamagePhoto: Facts = { reason: "DAMAGED", evidence: { photoProvided: true, productVisible: true, matchesOrderedProduct: true, defectVisible: true, imageClear: true } };
const blurryPhoto: Facts = { reason: "DAMAGED", evidence: { photoProvided: true, productVisible: true, matchesOrderedProduct: false, defectVisible: false, imageClear: false } };

test("Case 1: damaged headphones, good photo, day 12 -> replacement", () => {
  const r = decide(headphones, goodDamagePhoto, basePolicy, customer, now);
  assert.equal(r.decision, "APPROVE_REPLACEMENT");
  assert.equal(r.evidenceScore, 1);
  assert.equal(r.clauseId, "ELEC-30");
});

test("Case 2: same claim, blurry photo -> human review", () => {
  const r = decide(headphones, blurryPhoto, basePolicy, customer, now);
  assert.equal(r.decision, "HUMAN_REVIEW");
  assert.equal(r.evidenceScore, 0.25);
});

test("Case 2b: borderline photo -> ask for a clearer one", () => {
  // Defect visible but model cannot confirm it is the ordered product: 0.25 + 0 + 0.3 + 0.2 = 0.75
  const facts: Facts = { reason: "DAMAGED", evidence: { ...goodDamagePhoto.evidence, matchesOrderedProduct: false } };
  const r = decide(headphones, facts, basePolicy, customer, now);
  assert.equal(r.decision, "ASK_FOR_EVIDENCE");
  assert.equal(r.evidenceScore, 0.75);
});

test("Case 3: admin switches damaged electronics to inspection -> same case escalates", () => {
  const v2: Policy = { ...basePolicy, version: 2, categories: { ...basePolicy.categories, electronics: { ...basePolicy.categories.electronics, onDamaged: "HUMAN_INSPECTION" } } };
  const r = decide(headphones, goodDamagePhoto, v2, customer, now);
  assert.equal(r.decision, "HUMAN_REVIEW");
  assert.equal(r.policyVersion, 2);
});

test("Case 4: ordered black tee, photo shows blue -> exchange", () => {
  const facts: Facts = { reason: "WRONG_COLOUR", evidence: { photoProvided: true, productVisible: true, matchesOrderedProduct: true, defectVisible: false, imageClear: true, observedColour: "Blue" } };
  const r = decide(tshirt, facts, basePolicy, customer, now);
  assert.equal(r.decision, "APPROVE_EXCHANGE");
  assert.equal(r.evidenceScore, 1);
});

test("Wrong-colour claim but photo shows the ordered colour -> ask for evidence", () => {
  const facts: Facts = { reason: "WRONG_COLOUR", evidence: { photoProvided: true, productVisible: true, matchesOrderedProduct: true, defectVisible: false, imageClear: true, observedColour: "Black" } };
  const r = decide(tshirt, facts, basePolicy, customer, now);
  assert.equal(r.decision, "ASK_FOR_EVIDENCE"); // 0.6: mismatch not visible
});

test("Outside window -> reject with clause", () => {
  const old = { ...headphones, deliveredAt: "2026-08-01T10:00:00Z" };
  const r = decide(old, goodDamagePhoto, basePolicy, customer, now);
  assert.equal(r.decision, "REJECT");
  assert.match(r.customerMessage, /30-day/);
});

test("Policy window shortened to 7 days -> same case rejected", () => {
  const v3: Policy = { ...basePolicy, version: 3, categories: { ...basePolicy.categories, electronics: { ...basePolicy.categories.electronics, windowDays: 7 } } };
  assert.equal(decide(headphones, goodDamagePhoto, v3, customer, now).decision, "REJECT");
});

test("High-value order never auto-resolves", () => {
  const laptop = { ...headphones, price: 65000 };
  assert.equal(decide(laptop, goodDamagePhoto, basePolicy, customer, now).decision, "HUMAN_REVIEW");
});

test("Repeat returner goes to human review", () => {
  assert.equal(decide(headphones, goodDamagePhoto, basePolicy, { id: "C9", returnsLast90d: 6 }, now).decision, "HUMAN_REVIEW");
});

test("Change of mind: electronics rejected, apparel refunded", () => {
  const f: Facts = { reason: "CHANGED_MIND", evidence: { photoProvided: false, productVisible: false, matchesOrderedProduct: false, defectVisible: false, imageClear: false } };
  assert.equal(decide(headphones, f, basePolicy, customer, now).decision, "REJECT");
  assert.equal(decide(tshirt, f, basePolicy, customer, now).decision, "APPROVE_REFUND");
});

test("Deterministic: same input twice gives identical output", () => {
  assert.deepEqual(decide(headphones, goodDamagePhoto, basePolicy, customer, now), decide(headphones, goodDamagePhoto, basePolicy, customer, now));
});
