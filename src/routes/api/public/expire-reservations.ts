// Public cron endpoint. Configured pg_cron job hits this every minute and
// releases reservations whose expires_at has passed. Also safe to call manually.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json } from "@/lib/reservations.server";

export const Route = createFileRoute("/api/public/expire-reservations")({
  server: {
    handlers: {
      POST: async () => {
        const { data, error } = await supabaseAdmin.rpc("expire_stale_reservations");
        if (error) {
          console.error("[expire cron]", error);
          return json({ error: error.message }, 500);
        }
        return json({ expired: data ?? 0 });
      },
      GET: async () => {
        const { data, error } = await supabaseAdmin.rpc("expire_stale_reservations");
        if (error) return json({ error: error.message }, 500);
        return json({ expired: data ?? 0 });
      },
    },
  },
});
