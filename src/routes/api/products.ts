import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json } from "@/lib/reservations.server";

export const Route = createFileRoute("/api/products")({
  server: {
    handlers: {
      GET: async () => {
        // Opportunistic lazy expiry — releases any stale holds before we report stock.
        await supabaseAdmin.rpc("expire_stale_reservations");

        const { data: products, error: pErr } = await supabaseAdmin
          .from("products")
          .select("id, sku, name, description, price_cents")
          .order("name");
        if (pErr) return json({ error: pErr.message }, 500);

        const { data: stock, error: sErr } = await supabaseAdmin
          .from("stock")
          .select("product_id, warehouse_id, total_units, reserved_units");
        if (sErr) return json({ error: sErr.message }, 500);

        const { data: warehouses, error: wErr } = await supabaseAdmin
          .from("warehouses")
          .select("id, code, name")
          .order("code");
        if (wErr) return json({ error: wErr.message }, 500);

        const whMap = new Map(warehouses!.map((w) => [w.id, w]));
        const result = products!.map((p) => ({
          ...p,
          stock: stock!
            .filter((s) => s.product_id === p.id)
            .map((s) => ({
              warehouse: whMap.get(s.warehouse_id),
              total_units: s.total_units,
              reserved_units: s.reserved_units,
              available_units: s.total_units - s.reserved_units,
            })),
        }));
        return json({ products: result });
      },
    },
  },
});
