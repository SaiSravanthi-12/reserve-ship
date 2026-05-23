// GET a single reservation (used by the checkout page to poll status).
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json } from "@/lib/reservations.server";

export const Route = createFileRoute("/api/reservations/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // Lazy expiry: if this reservation is pending and past its expiry,
        // surface it as expired immediately rather than waiting for the cron.
        await supabaseAdmin.rpc("expire_stale_reservations");

        const { data, error } = await supabaseAdmin
          .from("reservations")
          .select(
            "id, product_id, warehouse_id, quantity, status, expires_at, created_at",
          )
          .eq("id", params.id)
          .maybeSingle();
        if (error) return json({ error: error.message }, 500);
        if (!data) return json({ error: "not_found" }, 404);

        const [{ data: product }, { data: warehouse }] = await Promise.all([
          supabaseAdmin
            .from("products")
            .select("id, sku, name, price_cents")
            .eq("id", data.product_id)
            .maybeSingle(),
          supabaseAdmin
            .from("warehouses")
            .select("id, code, name")
            .eq("id", data.warehouse_id)
            .maybeSingle(),
        ]);

        return json({ reservation: data, product, warehouse });
      },
    },
  },
});
