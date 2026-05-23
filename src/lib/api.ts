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

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function createReservation(input: {
  product_id: string;
  warehouse_id: string;
  quantity: number;
}): Promise<Reservation> {
  const res = await fetch("/api/reservations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (res.status === 409) {
    throw new ApiError(409, "insufficient_stock", "Not enough stock available.");
  }
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "error", body.error ?? "Request failed");
  }
  return body.reservation;
}

export async function confirmReservation(id: string): Promise<Reservation> {
  const res = await fetch(`/api/reservations/${id}/confirm`, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
  });
  const body = await res.json();
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
  const body = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "error", body.error ?? "Request failed");
  }
  return body.reservation;
}
