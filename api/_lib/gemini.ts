import { HttpError } from "./http.js";

// Tested on the team's key (3 Oct 2026): 3.8 Flash answered; 3.7 and flash-latest returned 503; 2.5 returned 404.
const MODELS = (process.env.GEMINI_MODELS ?? "gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash")
  .split(",").map(s => s.trim()).filter(Boolean);
const TIMEOUT_MS = 25_000;

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

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
          if (r.status === 503 || r.status === 429 || r.status >= 500) { await sleep(1500); continue; } // busy: retry
          break; // 4xx (bad model, bad key): try next model
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
  throw new HttpError(503, `AI service unavailable. ${errors.slice(-3).join(" | ")}`);
}

export function parseJson(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(cleaned); }
  catch { throw new HttpError(502, "AI returned invalid JSON"); }
}
