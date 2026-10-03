import { HttpError } from "./http.js";

// Tested on the team's key (3 Oct 2026): 3.8 Flash answered; 3.7 and flash-latest returned 503; 2.5 returned 404.
// Order matters: strongest first, lighter "lite" models last. All listed on the team key (3 Oct 2026).
const MODELS = (process.env.GEMINI_MODELS ??
  "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3-flash-preview,gemini-3.5-flash-lite")
  .split(",").map(s => s.trim()).filter(Boolean);
const ATTEMPT_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 48_000; // stays under the 60 s function limit

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export function imagePart(dataUrl: string): Part {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, "Invalid image");
  return { inline_data: { mime_type: m[1], data: m[2] } };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Calls Gemini and returns parsed JSON. Retries once on "busy", then falls back to the next model.
export async function generateJson(parts: Part[]): Promise<{ data: any; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(500, "Server is missing GEMINI_API_KEY");
  const errors: string[] = [];
  const started = Date.now();
  const left = () => TOTAL_BUDGET_MS - (Date.now() - started);

  // Pass 1 tries every model once (busy models are skipped quickly); pass 2 retries them after a pause.
  for (let pass = 1; pass <= 2; pass++) {
    if (pass === 2) await sleep(Math.min(2500, Math.max(0, left() - 5000)));
    for (const model of MODELS) {
      if (left() < 4000) break;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(ATTEMPT_TIMEOUT_MS, left()));
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseMimeType: "application/json" },
          }),
          signal: ctrl.signal,
        });
        const body: any = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg = body?.error?.message ?? `HTTP ${r.status}`;
          errors.push(`${model}: ${msg}`);
          continue; // busy (503/429) or bad model (404): move to the next model
        }
        const text: string | undefined = body?.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === "string")?.text;
        if (!text) { errors.push(`${model}: empty answer`); continue; }
        return { data: parseJson(text), model };
      } catch (e) {
        errors.push(`${model}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
  const busy = errors.some(e => /high demand|overloaded|503|429|quota/i.test(e));
  throw new HttpError(503, busy
    ? "AI models are busy right now (Google high demand). Retry in a minute."
    : `AI service unavailable. ${errors.slice(-2).join(" | ")}`);
}

export function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned); }
  catch { throw new HttpError(502, "AI returned invalid JSON"); }
}
