import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json } from "@/lib/reservations.server";

export const Route = createFileRoute("/api/warehouses")({
  server: {
    handlers: {
      GET: async () => {
        const { data, error } = await supabaseAdmin
          .from("warehouses")
          .select("id, code, name")
          .order("code");
        if (error) return json({ error: error.message }, 500);
        return json({ warehouses: data });
      },
    },
  },
});
