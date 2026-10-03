import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.js";

let client: SupabaseClient | null = null;

// Server-only client. Uses the secret key, which never reaches the browser.
export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new HttpError(500, "Server is missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export function check<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new HttpError(500, `${what}: ${r.error.message}`);
  return r.data;
}

export async function audit(caseId: string | null, actor: string, action: string, payload: unknown) {
  // Audit failures must never break the main flow, but they are logged.
  const { error } = await db().from("audit_log").insert({ case_id: caseId, actor, action, payload });
  if (error) console.error("[audit]", error.message);
}

export async function activePolicy() {
  const rows = check(await db().from("policies").select("*").eq("is_active", true).limit(1), "Load policy");
  if (!rows?.length) throw new HttpError(500, "No active policy. Run schema_v2.sql in Supabase.");
  return rows[0] as { version: number; rules: any; change_note: string | null; created_at: string };
}
