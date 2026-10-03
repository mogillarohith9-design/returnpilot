import { route, requireString, optionalImage, HttpError } from "./_lib/http.js";
import { db, check, audit } from "./_lib/db.js";

export default route({
  // All demo customers and orders (with the seller's packing photo, if uploaded).
  GET: async () => {
    const customers = check(await db().from("customers").select("*").order("id"), "Load customers");
    const orders = check(await db().from("orders").select("*, products(*), customers(name)").order("id"), "Load orders");
    return {
      customers,
      orders: (orders ?? []).map((o: any) => ({
        id: o.id, customerId: o.customer_id, customerName: o.customers?.name,
        product: o.products, price: Number(o.price), deliveredAt: o.delivered_at,
        daysSinceDelivery: Math.floor((Date.now() - Date.parse(o.delivered_at)) / 86_400_000),
        dispatchPhoto: o.dispatch_photo,
      })),
    };
  },
  // Seller uploads the packing photo for an order (evidence chain, stage 1).
  POST: async (req) => {
    const orderId = requireString(req.body?.orderId, "orderId", 40);
    const photo = optionalImage(req.body?.dispatchPhoto, "dispatchPhoto");
    if (!photo) throw new HttpError(400, "dispatchPhoto is required");
    check(await db().from("orders").update({ dispatch_photo: photo }).eq("id", orderId), "Save packing photo");
    await audit(null, "warehouse", "dispatch_photo.uploaded", { orderId });
    return { ok: true };
  },
});
