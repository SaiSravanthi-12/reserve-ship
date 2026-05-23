import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getIdempotent, json, saveIdempotent } from "@/lib/reservations.server";

export const Route = createFileRoute("/api/reservations/$id/confirm")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const id = params.id;
        const endpoint = `POST /api/reservations/${id}/confirm`;
        const idemKey = request.headers.get("idempotency-key");

        const cached = await getIdempotent(endpoint, idemKey);
        if (cached) {
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
            await saveIdempotent(endpoint, idemKey, 410, body);
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
        await saveIdempotent(endpoint, idemKey, 200, body);
        return json(body, 200);
      },
    },
  },
});
