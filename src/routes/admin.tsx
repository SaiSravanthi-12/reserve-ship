import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  fetchAdminReservations,
  fetchAdminStock,
  type AdminReservation,
  type AdminStockRow,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, RefreshCw, Warehouse as WarehouseIcon } from "lucide-react";

type StatusFilter = "all" | "pending" | "confirmed" | "expired" | "released";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Stock & Reservations" },
      { name: "description", content: "Operator view of stock by warehouse and reservation history." },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-lg font-semibold tracking-tight">Admin dashboard</h1>
          </div>
          <Link
            to="/inventory"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Open inventory →
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Tabs defaultValue="stock">
          <TabsList>
            <TabsTrigger value="stock">Stock by warehouse</TabsTrigger>
            <TabsTrigger value="reservations">Reservations</TabsTrigger>
          </TabsList>
          <TabsContent value="stock" className="mt-6">
            <StockPanel />
          </TabsContent>
          <TabsContent value="reservations" className="mt-6">
            <ReservationsPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StockPanel() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "stock"],
    queryFn: fetchAdminStock,
    refetchInterval: 5000,
  });

  // Group by warehouse
  const byWarehouse = useMemo(() => {
    const m = new Map<string, { wh: AdminStockRow["warehouse"]; rows: AdminStockRow[] }>();
    for (const row of data ?? []) {
      const k = row.warehouse.id;
      if (!m.has(k)) m.set(k, { wh: row.warehouse, rows: [] });
      m.get(k)!.rows.push(row);
    }
    return Array.from(m.values()).sort((a, b) => a.wh.code.localeCompare(b.wh.code));
  }, [data]);

  if (isLoading) return <p className="text-muted-foreground text-sm">Loading stock…</p>;
  if (isError) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {byWarehouse.map(({ wh, rows }) => {
          const totalUnits = rows.reduce((s, r) => s + r.total_units, 0);
          const reserved = rows.reduce((s, r) => s + r.reserved_units, 0);
          return (
            <Card key={wh.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <WarehouseIcon className="h-4 w-4 text-muted-foreground" />
                    {wh.name}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">{wh.code}</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {totalUnits - reserved} available · {reserved} held · {totalUnits} total
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Avail</TableHead>
                      <TableHead className="text-right">Held</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.product.id}>
                        <TableCell>
                          <div className="font-medium">{r.product.name}</div>
                          <div className="text-xs font-mono text-muted-foreground">
                            {r.product.sku}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={r.available_units > 0 ? "secondary" : "destructive"}
                            className="font-mono"
                          >
                            {r.available_units}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {r.reserved_units}
                        </TableCell>
                        <TableCell className="text-right font-mono">{r.total_units}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ReservationsPanel() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const status = filter === "all" ? undefined : filter;
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "reservations", filter],
    queryFn: () => fetchAdminReservations(status),
    refetchInterval: 5000,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-base">Reservations</CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border bg-background p-0.5">
              {(["all", "pending", "confirmed", "expired", "released"] as StatusFilter[]).map(
                (s) => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    className={`px-3 py-1 text-xs rounded-sm capitalize transition-colors ${
                      filter === s
                        ? "bg-muted text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ),
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {isError && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && data.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No reservations match this filter.
          </p>
        )}
        {data && data.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <ReservationRow key={r.id} r={r} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReservationRow({ r }: { r: AdminReservation }) {
  return (
    <TableRow>
      <TableCell>
        <StatusBadge status={r.status} />
      </TableCell>
      <TableCell>
        <div className="font-medium">{r.product?.name ?? "—"}</div>
        <div className="text-xs font-mono text-muted-foreground">{r.product?.sku}</div>
      </TableCell>
      <TableCell>
        <div className="text-sm">{r.warehouse?.name ?? "—"}</div>
        <div className="text-xs font-mono text-muted-foreground">{r.warehouse?.code}</div>
      </TableCell>
      <TableCell className="text-right font-mono">{r.quantity}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(r.created_at).toLocaleString()}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(r.expires_at).toLocaleString()}
      </TableCell>
      <TableCell className="text-right">
        <Link
          to="/checkout/$id"
          params={{ id: r.id }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          View →
        </Link>
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; label: string }> = {
    pending: { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30", label: "Pending" },
    confirmed: { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", label: "Confirmed" },
    expired: { cls: "bg-destructive/15 text-destructive border-destructive/30", label: "Expired" },
    released: { cls: "bg-muted text-muted-foreground border-border", label: "Released" },
  };
  const c = cfg[status] ?? cfg.released;
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${c.cls}`}>
      {c.label}
    </span>
  );
}
