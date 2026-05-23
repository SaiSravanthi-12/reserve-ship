import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getIdempotent, json, saveIdempotent } from "@/lib/reservations.server";

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

        const cached = await getIdempotent(ENDPOINT, idemKey);
        if (cached) {
          return json(cached.response_body, cached.status_code, {
            "idempotent-replay": "true",
          });
        }

        let payload: z.infer<typeof Body>;
        try {
          payload = Body.parse(await request.json());
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
          await saveIdempotent(ENDPOINT, idemKey, 409, body);
          return json(body, 409);
        }

        const body = { reservation: data };
        await saveIdempotent(ENDPOINT, idemKey, 201, body);
        return json(body, 201);
      },
    },
  },
});
