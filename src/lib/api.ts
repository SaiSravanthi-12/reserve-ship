// API client helpers (browser-side fetch wrappers).
export type Warehouse = { id: string; code: string; name: string };
export type StockEntry = {
  warehouse: Warehouse;
  total_units: number;
  reserved_units: number;
  available_units: number;
};
export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price_cents: number;
  stock: StockEntry[];
};
export type Reservation = {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  status: "pending" | "confirmed" | "released" | "expired";
  expires_at: string;
  created_at: string;
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function fetchProducts(): Promise<Product[]> {
  const res = await fetch("/api/products");
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Failed to load products");
  return body.products;
}

export async function fetchReservation(id: string): Promise<{
  reservation: Reservation;
  product: { id: string; sku: string; name: string; price_cents: number } | null;
  warehouse: Warehouse | null;
}> {
  const res = await fetch(`/api/reservations/${id}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Failed to load reservation");
  return body;
}

export type ReserveInput = {
  product_id: string;
  warehouse_id: string;
  quantity: number;
};

/**
 * Stable idempotency key per (product, warehouse, qty) intent. The same key is
 * reused across retries within ~5 minutes so a network blip can't accidentally
 * create two reservations for the same click.
 */
function reserveKey(input: ReserveInput): string {
  const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
  return `reserve:${input.product_id}:${input.warehouse_id}:${input.quantity}:${bucket}`;
}

export async function createReservation(
  input: ReserveInput,
  opts: { idempotencyKey?: string } = {},
): Promise<Reservation> {
  const res = await fetch("/api/reservations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": opts.idempotencyKey ?? reserveKey(input),
    },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409) {
    throw new ApiError(409, "insufficient_stock", "Not enough stock available right now.");
  }
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "error", body.error ?? "Request failed");
  }
  return body.reservation;
}

export async function confirmReservation(id: string): Promise<Reservation> {
  // Idempotency key derived from the reservation id — confirming the same
  // reservation twice always returns the same outcome.
  const res = await fetch(`/api/reservations/${id}/confirm`, {
    method: "POST",
    headers: { "idempotency-key": `confirm:${id}` },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 410) {
    throw new ApiError(410, "reservation_expired", "This reservation has expired.");
  }
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "error", body.error ?? "Request failed");
  }
  return body.reservation;
}

export async function releaseReservation(id: string): Promise<Reservation> {
  const res = await fetch(`/api/reservations/${id}/release`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "error", body.error ?? "Request failed");
  }
  return body.reservation;
}

// --- Admin reads (uses Supabase JS directly, public-read RLS allows it) ---
import { supabase } from "@/integrations/supabase/client";

export type AdminStockRow = {
  warehouse: Warehouse;
  product: { id: string; sku: string; name: string };
  total_units: number;
  reserved_units: number;
  available_units: number;
};

export async function fetchAdminStock(): Promise<AdminStockRow[]> {
  const { data, error } = await supabase
    .from("stock")
    .select("total_units,reserved_units,product:products(id,sku,name),warehouse:warehouses(id,code,name)");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    warehouse: r.warehouse,
    product: r.product,
    total_units: r.total_units,
    reserved_units: r.reserved_units,
    available_units: r.total_units - r.reserved_units,
  }));
}

export type AdminReservation = Reservation & {
  product: { id: string; sku: string; name: string } | null;
  warehouse: Warehouse | null;
};

export async function fetchAdminReservations(
  status?: "pending" | "confirmed" | "expired" | "released",
): Promise<AdminReservation[]> {
  let q = supabase
    .from("reservations")
    .select(
      "id,product_id,warehouse_id,quantity,status,expires_at,created_at,product:products(id,sku,name),warehouse:warehouses(id,code,name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AdminReservation[];
}
