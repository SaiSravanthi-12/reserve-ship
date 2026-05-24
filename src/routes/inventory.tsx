import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, createReservation, fetchProducts, type Product, type StockEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Package, Warehouse as WarehouseIcon } from "lucide-react";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Allo — Inventory & Reservations" },
      {
        name: "description",
        content:
          "Allo's multi-warehouse inventory and checkout-reservation demo. Reserve units, then confirm or release.",
      },
    ],
  }),
  component: ProductsPage,
});

function currency(cents: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function ProductsPage() {
  const { data: products, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
    refetchInterval: 5000,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-right" />
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Allo Inventory</h1>
            <p className="text-sm text-muted-foreground">
              Multi-warehouse stock with race-condition-safe reservations.
            </p>
          </div>
          <div className="text-xs text-muted-foreground">
            Reservations expire in <span className="font-medium">10&nbsp;min</span>.
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {isLoading && <p className="text-muted-foreground">Loading products…</p>}
        {isError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium">Couldn't load products.</p>
            <p className="text-muted-foreground">{(error as Error).message}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {products?.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </main>
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              {product.name}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{product.sku}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">{currency(product.price_cents)}</p>
          </div>
        </div>
        {product.description && (
          <p className="text-sm text-muted-foreground mt-2">{product.description}</p>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {product.stock.map((s) => (
            <WarehouseRow key={s.warehouse.id} productId={product.id} stock={s} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function WarehouseRow({ productId, stock }: { productId: string; stock: StockEntry }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);

  const reserve = useMutation({
    mutationFn: () =>
      createReservation({
        product_id: productId,
        warehouse_id: stock.warehouse.id,
        quantity: qty,
      }),
    onSuccess: (res) => {
      toast.success(`Reserved ${res.quantity} unit(s) at ${stock.warehouse.code}`);
      qc.invalidateQueries({ queryKey: ["products"] });
      navigate({ to: "/checkout/$id", params: { id: res.id } });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Not enough stock available right now.");
        qc.invalidateQueries({ queryKey: ["products"] });
      } else {
        toast.error((err as Error).message);
      }
    },
  });

  const available = stock.available_units;
  const disabled = reserve.isPending || available <= 0 || qty < 1 || qty > available;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-3 min-w-0">
        <WarehouseIcon className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{stock.warehouse.name}</p>
          <p className="text-xs text-muted-foreground">
            <Badge variant={available > 0 ? "secondary" : "destructive"} className="mr-1">
              {available} avail
            </Badge>
            <span className="text-muted-foreground">
              {stock.reserved_units} held · {stock.total_units} total
            </span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          min={1}
          max={Math.max(available, 1)}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          className="w-16 h-9 rounded-md border bg-background px-2 text-sm"
          disabled={available <= 0}
        />
        <Button size="sm" onClick={() => reserve.mutate()} disabled={disabled}>
          {reserve.isPending ? "Reserving…" : "Reserve"}
        </Button>
      </div>
    </div>
  );
}
