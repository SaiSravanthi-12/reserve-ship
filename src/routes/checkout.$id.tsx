import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ApiError,
  confirmReservation,
  createReservation,
  fetchReservation,
  releaseReservation,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, CheckCircle2, XCircle, Clock, AlertTriangle, RotateCw } from "lucide-react";

export const Route = createFileRoute("/checkout/$id")({
  head: ({ params }) => ({
    meta: [{ title: `Reservation ${params.id.slice(0, 8)} — Allo` }],
  }),
  component: CheckoutPage,
});

function currency(cents: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function useCountdown(target: string | undefined) {
  const [remaining, setRemaining] = useState<number>(() =>
    target ? Math.max(0, new Date(target).getTime() - Date.now()) : 0,
  );
  useEffect(() => {
    if (!target) return;
    const tick = () =>
      setRemaining(Math.max(0, new Date(target).getTime() - Date.now()));
    tick();
    const i = setInterval(tick, 250);
    return () => clearInterval(i);
  }, [target]);
  return remaining;
}

function formatMs(ms: number) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60).toString().padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function CheckoutPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["reservation", id],
    queryFn: () => fetchReservation(id),
    refetchInterval: (q) => {
      const status = q.state.data?.reservation.status;
      return status === "pending" ? 3000 : false;
    },
  });

  const res = data?.reservation;
  const remaining = useCountdown(res?.status === "pending" ? res.expires_at : undefined);

  // When countdown reaches 0 client-side, refetch so the server-confirmed expired
  // state is reflected (the GET endpoint runs lazy expiry).
  useEffect(() => {
    if (res?.status === "pending" && remaining === 0) {
      const t = setTimeout(() => refetch(), 200);
      return () => clearTimeout(t);
    }
  }, [remaining, res?.status, refetch]);

  const confirm = useMutation({
    mutationFn: () => confirmReservation(id),
    onSuccess: () => {
      toast.success("Payment confirmed. Order placed.");
      qc.invalidateQueries({ queryKey: ["reservation", id] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 410) {
        toast.error("Reservation expired", {
          description: "The 10-minute hold elapsed before payment was confirmed.",
        });
        qc.invalidateQueries({ queryKey: ["reservation", id] });
      } else if (err instanceof ApiError && err.status === 409) {
        toast.error("Cannot confirm", {
          description: "This reservation isn't in a confirmable state anymore.",
        });
        qc.invalidateQueries({ queryKey: ["reservation", id] });
      } else {
        toast.error("Confirmation failed", { description: (err as Error).message });
      }
    },
  });

  const cancel = useMutation({
    mutationFn: () => releaseReservation(id),
    onSuccess: () => {
      toast("Reservation released.");
      qc.invalidateQueries({ queryKey: ["reservation", id] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err: unknown) => toast.error((err as Error).message),
  });

  const reReserve = useMutation({
    mutationFn: () => {
      if (!data?.product || !data?.warehouse) throw new Error("Missing details");
      return createReservation({
        product_id: data.product.id,
        warehouse_id: data.warehouse.id,
        quantity: res?.quantity ?? 1,
      });
    },
    onSuccess: (r) => {
      toast.success("New reservation created");
      qc.invalidateQueries({ queryKey: ["products"] });
      navigate({ to: "/checkout/$id", params: { id: r.reservation.id } });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Out of stock", {
          description: "Someone else grabbed the last unit. Try a different warehouse.",
        });
      } else {
        toast.error("Could not re-reserve", { description: (err as Error).message });
      }
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-right" />
      <header className="border-b">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to products
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {isLoading && <p className="text-muted-foreground">Loading reservation…</p>}
        {isError && (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        )}

        {data && res && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-xl">Checkout</CardTitle>
                  <p className="text-xs text-muted-foreground font-mono mt-1">
                    {res.id}
                  </p>
                </div>
                <StatusBadge status={res.status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Product</p>
                  <p className="font-medium">{data.product?.name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {data.product?.sku}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Warehouse</p>
                  <p className="font-medium">{data.warehouse?.name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{data.warehouse?.code}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Quantity</p>
                  <p className="font-medium">{res.quantity}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total</p>
                  <p className="font-medium">
                    {data.product ? currency(data.product.price_cents * res.quantity) : "—"}
                  </p>
                </div>
              </div>

              {res.status === "pending" && (
                <div className="rounded-md border bg-muted/40 p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Reservation expires in
                  </div>
                  <p className="mt-1 text-3xl font-mono font-semibold tabular-nums">
                    {formatMs(remaining)}
                  </p>
                </div>
              )}

              {res.status === "pending" && (
                <div className="flex gap-3">
                  <Button
                    className="flex-1"
                    onClick={() => confirm.mutate()}
                    disabled={confirm.isPending || remaining === 0}
                  >
                    {confirm.isPending ? "Confirming…" : "Confirm purchase"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => cancel.mutate()}
                    disabled={cancel.isPending}
                  >
                    {cancel.isPending ? "Cancelling…" : "Cancel"}
                  </Button>
                </div>
              )}

              {res.status !== "pending" && (
                <div className="flex gap-3">
                  <Button onClick={() => navigate({ to: "/" })} className="flex-1">
                    Back to products
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending")
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" /> Pending
      </Badge>
    );
  if (status === "confirmed")
    return (
      <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> Confirmed
      </Badge>
    );
  if (status === "expired")
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> Expired
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <XCircle className="h-3 w-3" /> Released
    </Badge>
  );
}
