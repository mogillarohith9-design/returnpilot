import { db, check } from "./db.js";
import { HttpError } from "./http.js";
import type { Customer, Decision, Order } from "./policyEngine.js";

export interface OrderBundle {
  order: Order;
  row: any;
  product: { id: string; name: string; category: string; colour: string | null; price: number };
  customer: Customer & { name: string };
}

export async function loadOrder(orderId: string): Promise<OrderBundle> {
  const rows = check(await db().from("orders").select("*, products(*), customers(*)").eq("id", orderId).limit(1), "Load order");
  const row = rows?.[0];
  if (!row) throw new HttpError(404, `Order ${orderId} not found`);
  return bundle(row);
}

export function bundle(row: any): OrderBundle {
  const p = row.products, c = row.customers;
  return {
    row,
    product: { id: p.id, name: p.name, category: p.category, colour: p.colour, price: Number(p.price) },
    customer: { id: c.id, name: c.name, returnsLast90d: Number(c.returns_last_90d ?? 0) },
    order: {
      id: row.id, sku: p.id, category: p.category, colour: p.colour ?? undefined,
      price: Number(row.price), deliveredAt: row.delivered_at,
    },
  };
}

export function statusFor(decision: Decision): string {
  if (decision.startsWith("APPROVE")) return "APPROVED";
  if (decision === "REJECT") return "REJECTED";
  if (decision === "ASK_FOR_EVIDENCE") return "NEEDS_INFO";
  return "AWAITING_HUMAN";
}

export function newCaseId(): string {
  return `RET-${Date.now().toString(36).slice(-4).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`;
}
