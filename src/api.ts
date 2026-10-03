// Thin client for our server functions. Errors come back as readable messages.
async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!r.ok) throw new Error(data?.error ?? `Server error ${r.status}${text && !data ? `: ${text.slice(0, 120)}` : ""}`);
  return data as T;
}

export type Decision = "APPROVE_REPLACEMENT" | "APPROVE_REFUND" | "APPROVE_EXCHANGE" | "ASK_FOR_EVIDENCE" | "HUMAN_REVIEW" | "REJECT";
export interface TraceStep { step: string; detail: string; ok: boolean }
export interface Result {
  decision: Decision; flags: string[]; clauseId?: string; policyVersion: number;
  evidenceScore?: number; trace: TraceStep[]; customerMessage: string;
}
export interface Product { id: string; name: string; category: string; colour: string | null; price: number }
export interface OrderRow {
  id: string; customerId: string; customerName: string; product: Product; price: number;
  deliveredAt: string; daysSinceDelivery: number; dispatchPhoto: string | null;
}

export const api = {
  health: () => call<any>("/api/health"),
  orders: () => call<{ customers: any[]; orders: OrderRow[] }>("/api/orders"),
  uploadDispatch: (orderId: string, dispatchPhoto: string) => call("/api/orders", { orderId, dispatchPhoto }),
  proofCode: (orderId: string) => call<{ code: string; expiresAt: string; validMinutes: number }>("/api/proof-code", { orderId }),
  createCase: (orderId: string, customerText: string, claimPhoto: string | null) =>
    call<{ caseId: string; result: Result; language?: string; summary?: string; reply_customer?: string }>("/api/cases", { orderId, customerText, claimPhoto }),
  cases: () => call<{ cases: any[] }>("/api/cases"),
  caseDetail: (id: string) => call<{ case: any; decisions: any[]; audit: any[] }>(`/api/cases?id=${encodeURIComponent(id)}`),
  caseAction: (body: Record<string, unknown>) => call<any>("/api/case-action", body),
  policy: () => call<{ active: any; history: any[] }>("/api/policy"),
  policyPost: (rules: unknown, mode: "simulate" | "save", note?: string) => call<any>("/api/policy", { rules, mode, note }),
};
