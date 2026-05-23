import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { json } from "@/lib/reservations.server";

export const Route = createFileRoute("/api/reservations/$id/release")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const { data, error } = await supabaseAdmin.rpc("release_reservation", {
          p_id: params.id,
        });
        if (error) {
          const msg = error.message || "";
          if (msg.includes("not_found")) return json({ error: "not_found" }, 404);
          if (msg.includes("already_confirmed"))
            return json({ error: "already_confirmed" }, 409);
          console.error("[release_reservation]", error);
          return json({ error: msg }, 500);
        }
        return json({ reservation: data });
      },
    },
  },
});
