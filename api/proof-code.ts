import { randomInt } from "node:crypto";
import { route, requireString } from "./_lib/http.js";
import { db, check } from "./_lib/db.js";
import { loadOrder } from "./_lib/data.js";

const VALID_MINUTES = 10;

// Issues a one-time 4-digit code. The customer writes it on paper next to the item before taking the photo.
export default route({
  POST: async (req) => {
    const orderId = requireString(req.body?.orderId, "orderId", 40);
    await loadOrder(orderId); // 404 if the order does not exist
    const code = String(randomInt(1000, 10000));
    const expiresAt = new Date(Date.now() + VALID_MINUTES * 60_000).toISOString();
    check(await db().from("proof_codes").upsert({ order_id: orderId, code, expires_at: expiresAt }), "Issue code");
    return { code, expiresAt, validMinutes: VALID_MINUTES };
  },
});
