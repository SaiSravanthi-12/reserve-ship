// Server-only helpers for the reservation API.
// All write paths go through SECURITY DEFINER SQL functions called via supabaseAdmin
// (service role). RLS still protects direct table writes from the client.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type IdemRecord = { status_code: number; response_body: unknown };

export async function getIdempotent(
  endpoint: string,
  key: string | null,
): Promise<IdemRecord | null> {
  if (!key) return null;
  const { data, error } = await supabaseAdmin
    .from("idempotency_keys")
    .select("status_code,response_body")
    .eq("endpoint", endpoint)
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.error("[idem.read]", error);
    return null;
  }
  return data as IdemRecord | null;
}

export async function saveIdempotent(
  endpoint: string,
  key: string | null,
  statusCode: number,
  body: unknown,
) {
  if (!key) return;
  // Best-effort; ignore duplicate-key races (the cached row wins on next read).
  const { error } = await supabaseAdmin.from("idempotency_keys").insert({
    key,
    endpoint,
    status_code: statusCode,
    response_body: body as never,
  });
  if (error && !`${error.message}`.includes("duplicate")) {
    console.error("[idem.write]", error);
  }
}

export function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}
