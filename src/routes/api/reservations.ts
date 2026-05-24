import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  fingerprint,
  json,
  lookupIdempotent,
  saveIdempotent,
} from "@/lib/reservations.server";

const Body = z.object({
  product_id: z.string().uuid(),
  warehouse_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
  ttl_seconds: z.number().int().min(30).max(60 * 60).optional(),
});

const ENDPOINT = "POST /api/reservations";

export const Route = createFileRoute("/api/reservations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const idemKey = request.headers.get("idempotency-key");

        // Parse body once so we can fingerprint it for idempotency.
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }

        const fp = await fingerprint(raw);
        const cached = await lookupIdempotent(ENDPOINT, idemKey, fp);
        if (cached.kind === "conflict") {
          return json(
            {
              error: "idempotency_key_reused",
              message:
                "This Idempotency-Key was already used with a different request body.",
            },
            422,
          );
        }
        if (cached.kind === "replay") {
          return json(cached.response_body, cached.status_code, {
            "idempotent-replay": "true",
          });
        }

        let payload: z.infer<typeof Body>;
        try {
          payload = Body.parse(raw);
        } catch (err) {
          return json({ error: "invalid_body", details: String(err) }, 400);
        }

        const { data, error } = await supabaseAdmin.rpc("try_reserve_stock", {
          p_product_id: payload.product_id,
          p_warehouse_id: payload.warehouse_id,
          p_quantity: payload.quantity,
          p_ttl_seconds: payload.ttl_seconds ?? 600,
        });

        if (error) {
          console.error("[try_reserve_stock]", error);
          return json({ error: error.message }, 500);
        }

        if (!data) {
          const body = { error: "insufficient_stock" };
          const winner = await saveIdempotent(ENDPOINT, idemKey, fp, 409, body);
          if (winner) return json(winner.response_body, winner.status_code);
          return json(body, 409);
        }

        const body = { reservation: data };
        const winner = await saveIdempotent(ENDPOINT, idemKey, fp, 201, body);
        if (winner) return json(winner.response_body, winner.status_code);
        return json(body, 201);
      },
    },
  },
});
