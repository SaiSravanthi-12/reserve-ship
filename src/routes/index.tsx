import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, ShieldCheck, Timer, RefreshCw, Boxes } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Allo — Race-Safe Inventory Reservations" },
      {
        name: "description",
        content:
          "Allo holds stock for customers during checkout with atomic reservations, automatic expiry, and idempotent APIs.",
      },
      { property: "og:title", content: "Allo — Race-Safe Inventory Reservations" },
      {
        property: "og:description",
        content:
          "Multi-warehouse inventory with atomic reservations, automatic expiry, and idempotent APIs.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="h-5 w-5" />
            <span className="font-semibold tracking-tight">Allo Inventory</span>
          </div>
          <nav className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link to="/admin" className="hover:text-foreground transition-colors">
              Admin
            </Link>
            <Link to="/inventory" className="hover:text-foreground transition-colors">
              Inventory →
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-4xl px-6 py-24 text-center">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-5">
            Multi-warehouse · D2C · Retail
          </p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
            Race-safe stock holds,<br className="hidden sm:block" /> built for checkout.
          </h1>
          <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            Allo reserves units the moment a customer reaches checkout, releases them
            automatically when payment stalls, and guarantees no two carts ever fight
            for the last unit.
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/inventory">
                Enter inventory
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="https://github.com" target="_blank" rel="noreferrer">
                View README
              </a>
            </Button>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Atomic reservations"
              body="A single conditional UPDATE in Postgres ensures exactly one concurrent request wins when stock is tight — no Redis, no overselling."
            />
            <FeatureCard
              icon={<Timer className="h-5 w-5" />}
              title="Automatic expiry"
              body="Holds release on their own after 10 minutes via pg_cron, with lazy cleanup on read so stock counts are always honest."
            />
            <FeatureCard
              icon={<RefreshCw className="h-5 w-5" />}
              title="Idempotent APIs"
              body="Retries are safe. The same Idempotency-Key replays the original response instead of double-reserving a unit."
            />
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-6 text-xs text-muted-foreground flex items-center justify-between">
          <span>Allo Engineering — Take-home demo</span>
          <Link to="/inventory" className="hover:text-foreground transition-colors">
            Open inventory →
          </Link>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="h-9 w-9 rounded-md border bg-muted/40 flex items-center justify-center text-foreground">
          {icon}
        </div>
        <h3 className="mt-4 font-medium">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
      </CardContent>
    </Card>
  );
}
