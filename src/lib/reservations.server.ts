// Server-only helpers for the reservation API.
// All write paths go through SECURITY DEFINER SQL functions called via supabaseAdmin
// (service role). RLS still protects direct table writes from the client.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type IdemRecord = {
  status_code: number;
  response_body: unknown;
  request_fingerprint: string | null;
};

export type IdemLookup =
  | { kind: "miss" }
  | { kind: "replay"; status_code: number; response_body: unknown }
  | { kind: "conflict" }; // same key, different body

/**
 * Canonical fingerprint of a request body. Keys are sorted so semantically
 * equivalent payloads hash the same.
 */
export async function fingerprint(body: unknown): Promise<string> {
  const canonical = JSON.stringify(body, Object.keys(body ?? {}).sort());
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function lookupIdempotent(
  endpoint: string,
  key: string | null,
  fp: string | null,
): Promise<IdemLookup> {
  if (!key) return { kind: "miss" };
  const { data, error } = await supabaseAdmin
    .from("idempotency_keys")
    .select("status_code,response_body,request_fingerprint")
    .eq("endpoint", endpoint)
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.error("[idem.read]", error);
    return { kind: "miss" };
  }
  if (!data) return { kind: "miss" };
  const rec = data as IdemRecord;
  if (fp && rec.request_fingerprint && rec.request_fingerprint !== fp) {
    return { kind: "conflict" };
  }
  return {
    kind: "replay",
    status_code: rec.status_code,
    response_body: rec.response_body,
  };
}

/**
 * Persist the response for this key. On a race (duplicate-key conflict), re-read
 * the stored row so the loser of the race still replays the winning response.
 */
export async function saveIdempotent(
  endpoint: string,
  key: string | null,
  fp: string | null,
  statusCode: number,
  body: unknown,
): Promise<{ status_code: number; response_body: unknown } | null> {
  if (!key) return null;
  const { error } = await supabaseAdmin.from("idempotency_keys").insert({
    key,
    endpoint,
    status_code: statusCode,
    response_body: body as never,
    request_fingerprint: fp,
  });
  if (!error) return { status_code: statusCode, response_body: body };

  // Duplicate key — another concurrent request stored a response first.
  if (`${error.message}`.toLowerCase().includes("duplicate")) {
    const winner = await supabaseAdmin
      .from("idempotency_keys")
      .select("status_code,response_body")
      .eq("endpoint", endpoint)
      .eq("key", key)
      .maybeSingle();
    if (winner.data) {
      return {
        status_code: winner.data.status_code as number,
        response_body: winner.data.response_body,
      };
    }
  }
  console.error("[idem.write]", error);
  return null;
}

export function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}
