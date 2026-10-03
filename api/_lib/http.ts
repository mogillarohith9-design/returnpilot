// Minimal request/response types so we do not depend on @vercel/node.
export interface Req {
  method?: string;
  body?: any;
  query: Record<string, string | string[] | undefined>;
}
export interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

export class HttpError extends Error {
  constructor(public code: number, message: string) { super(message); }
}

type Handler = (req: Req, res: Res) => Promise<unknown>;

// Wraps a handler: JSON body parsing fallback, consistent errors, no stack traces leaked.
export function route(handlers: Partial<Record<"GET" | "POST", Handler>>) {
  return async (req: Req, res: Res) => {
    res.setHeader("Cache-Control", "no-store");
    const h = handlers[(req.method ?? "GET") as "GET" | "POST"];
    if (!h) return res.status(405).json({ error: "Method not allowed" });
    try {
      if (typeof req.body === "string" && req.body.length) req.body = JSON.parse(req.body);
      const out = await h(req, res);
      if (out !== undefined) res.status(200).json(out);
    } catch (e) {
      const code = e instanceof HttpError ? e.code : 500;
      const message = e instanceof Error ? e.message : String(e);
      console.error("[api]", code, message);
      res.status(code).json({ error: message });
    }
  };
}

export function requireString(v: unknown, name: string, max = 5000): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${name} is required`);
  if (v.length > max) throw new HttpError(400, `${name} is too long`);
  return v.trim();
}

// Accepts a compressed image data URL from the browser. Limit keeps us under Vercel's 4.5 MB body cap.
export function optionalImage(v: unknown, name: string): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(v)) {
    throw new HttpError(400, `${name} must be a JPEG, PNG or WebP image`);
  }
  if (v.length > 1_800_000) throw new HttpError(413, `${name} is too large; please retake it`);
  return v;
}
