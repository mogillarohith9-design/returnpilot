import { route } from "./_lib/http.js";
import { db } from "./_lib/db.js";

// Quick check used by the app banner: are the keys set and is the database reachable?
export default route({
  GET: async () => {
    const env = {
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SECRET_KEY: !!process.env.SUPABASE_SECRET_KEY,
    };
    let database = "not checked";
    let policyVersion: number | null = null;
    if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
      const { data, error } = await db().from("policies").select("version").eq("is_active", true).limit(1);
      database = error ? `error: ${error.message}` : data?.length ? "ok" : "no active policy (run schema_v2.sql)";
      policyVersion = data?.[0]?.version ?? null;
    }
    return { ok: Object.values(env).every(Boolean) && database === "ok", env, database, policyVersion };
  },
});
