import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json, lookupIdempotent, saveIdempotent } from "@/lib/reservations.server";

export const Route = createFileRoute("/api/reservations/$id/confirm")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const id = params.id;
        const endpoint = `POST /api/reservations/${id}/confirm`;
        const idemKey = request.headers.get("idempotency-key");

        // Confirm has no body — fingerprint is just the reservation id so the
        // same key can't be reused across different reservations.
        const fp = `confirm:${id}`;
        const cached = await lookupIdempotent(endpoint, idemKey, fp);
        if (cached.kind === "conflict") {
          return json({ error: "idempotency_key_reused" }, 422);
        }
        if (cached.kind === "replay") {
          return json(cached.response_body, cached.status_code, {
            "idempotent-replay": "true",
          });
        }

        const { data, error } = await supabaseAdmin.rpc("confirm_reservation", {
          p_id: id,
        });

        if (error) {
          const msg = error.message || "";
          if (msg.includes("expired")) {
            const body = { error: "reservation_expired" };
            const w = await saveIdempotent(endpoint, idemKey, fp, 410, body);
            if (w) return json(w.response_body, w.status_code);
            return json(body, 410);
          }
          if (msg.includes("not_found")) {
            return json({ error: "not_found" }, 404);
          }
          if (msg.includes("invalid_status")) {
            return json({ error: "invalid_status", details: msg }, 409);
          }
          console.error("[confirm_reservation]", error);
          return json({ error: msg }, 500);
        }

        const body = { reservation: data };
        const w = await saveIdempotent(endpoint, idemKey, fp, 200, body);
        if (w) return json(w.response_body, w.status_code);
        return json(body, 200);
      },
    },
  },
});
