import { generateJson, imagePart, type Part } from "./gemini.js";
import type { Facts, ReasonCode } from "./policyEngine.js";

const REASONS: ReasonCode[] = ["DAMAGED", "DEFECTIVE", "WRONG_ITEM", "WRONG_COLOUR", "WRONG_SIZE", "CHANGED_MIND", "OTHER"];
const bool = (v: unknown) => v === true || v === "true";
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export interface Product { name: string; category: string; colour: string | null }

export interface ClaimAssessment {
  facts: Facts;
  codeRead: string | null;
  language: string | null;
  summary: string | null;
  reply: string | null;
  clarifyingQuestion: string | null;
  model: string;
  raw: unknown;
}

// ONE AI call reads the complaint, the customer's photo and (if present) the seller's packing photo.
// The model only reports facts. The policy engine decides.
export async function assessClaim(opts: {
  product: Product; customerText: string; claimPhoto: string | null; dispatchPhoto: string | null;
}): Promise<ClaimAssessment> {
  const { product, customerText, claimPhoto, dispatchPhoto } = opts;
  const parts: Part[] = [{ text: [
    "You are the evidence-reading component of an e-commerce returns system. You report facts only. You never decide refunds.",
    `Ordered product: "${product.name}", colour "${product.colour ?? "unknown"}", category "${product.category}".`,
    `Customer message (may be English, Hindi, Telugu or mixed): """${customerText.replace(/"""/g, "'")}"""`,
    claimPhoto ? "IMAGE A (first image) is the customer's photo of the problem." : "The customer sent no photo.",
    claimPhoto && dispatchPhoto ? "IMAGE B (second image) is the seller's photo taken while packing this order." : "",
    "Return ONLY a JSON object with these keys:",
    `reason: one of ${REASONS.join(", ")}. DAMAGED = any physical damage: broken, cracked, torn, ripped, hole, cut, stained, dirty, scratched, dented, burnt or faded. DEFECTIVE = does not work or stopped working. WRONG_ITEM, WRONG_COLOUR, WRONG_SIZE = a different product, colour or size than ordered. CHANGED_MIND = nothing is wrong, the customer no longer wants it. Use OTHER only when none of these fit.`,
    "language: the language of the customer message, in English (for example Telugu).",
    "summary: one neutral English sentence for the support team.",
    "reply_in_customer_language: one short polite sentence, in the customer's language, confirming what you understood. Do not promise any outcome.",
    "clarifying_question: null, or one short question if the message is too vague to classify.",
    claimPhoto ? "photo: object with productVisible, matchesOrderedProduct (same kind of product as the ordered product), defectVisible (damage or fault visible), imageClear (in focus and well lit), all true/false; observedColour (one word); codeRead (the handwritten 4-digit number on paper in the photo, digits only, or null)." : "",
    claimPhoto && dispatchPhoto ? "dispatch: object with intactInPacking (IMAGE B shows the item undamaged) and sameProduct (IMAGE A shows the same product as IMAGE B: same model, colour and visible features; lighting and angle may differ), both true/false." : "",
    "Answer true only when it is clearly visible. If unsure, answer false.",
  ].filter(Boolean).join("\n") }];
  if (claimPhoto) parts.push(imagePart(claimPhoto));
  if (claimPhoto && dispatchPhoto) parts.push(imagePart(dispatchPhoto));

  const { data, model } = await generateJson(parts);
  const reason: ReasonCode = REASONS.includes(data?.reason) ? data.reason : "OTHER";
  const p = data?.photo ?? {};
  const d = data?.dispatch;
  const codeRaw = str(p.codeRead);
  const codeRead = codeRaw ? codeRaw.replace(/\D/g, "").slice(0, 4) || null : null;

  const facts: Facts = {
    reason,
    evidence: {
      photoProvided: !!claimPhoto, // set by the server, never by the model
      productVisible: bool(p.productVisible),
      matchesOrderedProduct: bool(p.matchesOrderedProduct),
      defectVisible: bool(p.defectVisible),
      imageClear: bool(p.imageClear),
      observedColour: str(p.observedColour) ?? undefined,
    },
    chain: claimPhoto && dispatchPhoto && d
      ? { dispatchPhotoIntact: bool(d.intactInPacking), claimMatchesDispatch: bool(d.sameProduct) }
      : undefined,
  };

  return {
    facts, codeRead, model, raw: data,
    language: str(data?.language),
    summary: str(data?.summary),
    reply: str(data?.reply_in_customer_language),
    clarifyingQuestion: str(data?.clarifying_question),
  };
}

// Warehouse check: does what came back match what was packed?
export async function assessReceived(dispatchPhoto: string, receivedPhoto: string) {
  const { data, model } = await generateJson([
    { text: [
      "IMAGE A is the seller's photo taken while packing an order. IMAGE B is a photo of what came back in the return parcel.",
      "Return ONLY JSON: sameProduct (IMAGE B shows the same product as IMAGE A: same model, colour and visible features; lighting and angle may differ), emptyOrDifferent (IMAGE B shows an empty box or a clearly different item), note (one short English sentence describing the difference, or null). Booleans true/false. If unsure about sameProduct, answer false.",
    ].join("\n") },
    imagePart(dispatchPhoto),
    imagePart(receivedPhoto),
  ]);
  const same = bool(data?.sameProduct) && !bool(data?.emptyOrDifferent);
  return { receivedMatchesDispatch: same, note: str(data?.note), model, raw: data };
}
