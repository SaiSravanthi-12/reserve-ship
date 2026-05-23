# Allo — Inventory & Reservations

A take-home implementation of the Allo Engineering exercise: a multi-warehouse
inventory system with race-condition-safe checkout reservations.

> **Stack note.** The brief specified Next.js + Prisma + Supabase. This project
> was built inside the Lovable platform, which is locked to **TanStack Start
> (React 19 + Vite, deployed on Cloudflare Workers)** and **Lovable Cloud**
> (managed Supabase / Postgres). The runtime is different but every requirement
> in the brief is implemented: the same Postgres, the same race-safety
> guarantees, the same HTTP API shape, the same UI flow. See "Mapping to the
> brief" below for the swap detail.

---

## Live demo

- Preview: https://time-hold-stock.lovable.app/
- Published: (publish from the Lovable editor to assign a stable URL)

The database is seeded with 3 warehouses (Mumbai / Delhi / Bengaluru) and 6
SKUs at varying stock levels. One SKU (`ALLO-BAG-01`) intentionally has only
1–2 units per warehouse so you can demo the 409 path with two concurrent tabs.

---

## How to run locally

This is a Lovable / Cloudflare project, so the local story is:

1. Clone the repo and install dependencies:
   ```sh
   bun install
   ```
2. Copy `.env.example` to `.env` and fill in the four values from your Lovable
   Cloud / Supabase project:
   ```sh
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=<anon key>
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   ```
3. Apply migrations: the SQL that creates the schema, functions and seed lives
   in `supabase/migrations/`. Run them with `supabase db push` (or paste into
   the SQL editor of your Supabase project).
4. Schedule expiry (production only — see *Expiry mechanism* below).
5. Start the dev server:
   ```sh
   bun run dev
   ```

The seed is part of the first migration, so a fresh database is immediately
interactive.

---

## Data model

```
warehouses (id, code, name)
products   (id, sku, name, description, price_cents)
stock      (product_id, warehouse_id, total_units, reserved_units)
              UNIQUE(product_id, warehouse_id)
              CHECK (reserved_units <= total_units)
reservations (id, product_id, warehouse_id, quantity,
              status enum('pending','confirmed','released','expired'),
              expires_at, idempotency_key, created_at, updated_at)
idempotency_keys (key, endpoint, status_code, response_body, created_at)
```

`stock.available = total_units - reserved_units` is the public availability.
A reservation moves units from "available" into "reserved" without changing
`total_units`. On `confirm` both counters drop by the reserved quantity (the
units physically leave inventory). On `release` / `expire` only
`reserved_units` drops back down.

---

## API

| Method | Path                                  | Behaviour                                                            |
| ------ | ------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/products`                       | All products with per-warehouse `available_units` / `reserved_units` |
| GET    | `/api/warehouses`                     | All warehouses                                                       |
| GET    | `/api/reservations/:id`               | Read a single reservation (with product + warehouse)                 |
| POST   | `/api/reservations`                   | Create a reservation. `409` if insufficient stock                    |
| POST   | `/api/reservations/:id/confirm`       | Confirm a pending reservation. `410` if expired                      |
| POST   | `/api/reservations/:id/release`       | Release early (user cancel / payment failed)                         |
| POST   | `/api/public/expire-reservations`     | Bulk-expire stale pending holds (cron target)                        |

All routes live in `src/routes/api/`. Server-only logic uses `supabaseAdmin`
(service role) — RLS still blocks direct table writes from the browser.

---

## Concurrency model — the core of the exercise

The reservation endpoint must be safe under contention: if two requests race
for the last unit of a SKU, exactly one returns `201` and the other returns
`409`. We guarantee this with a **conditional `UPDATE` inside a SQL function**,
not application-level locking or Redis.

```sql
create function try_reserve_stock(p_product_id uuid, p_warehouse_id uuid,
                                  p_quantity int, p_ttl_seconds int)
returns reservations language plpgsql security definer as $$
declare v_updated int; v_res reservations;
begin
  update stock
     set reserved_units = reserved_units + p_quantity
   where product_id   = p_product_id
     and warehouse_id = p_warehouse_id
     and (total_units - reserved_units) >= p_quantity;  -- <- the guard

  get diagnostics v_updated = row_count;
  if v_updated = 0 then return null; end if;            -- caller returns 409

  insert into reservations (product_id, warehouse_id, quantity,
                            status, expires_at)
  values (p_product_id, p_warehouse_id, p_quantity,
          'pending', now() + make_interval(secs => p_ttl_seconds))
  returning * into v_res;
  return v_res;
end $$;
```

Why this is race-safe:

- `UPDATE ... WHERE available >= qty` is a single statement. Postgres takes a
  row-level lock on the matching `stock` row. The second concurrent
  transaction blocks until the first commits, then re-evaluates its `WHERE`
  clause against the *new* row, sees the depleted availability, matches 0 rows,
  and the function returns `null` → the route returns `409`.
- No application-level lock, no Redis SETNX, no advisory lock, no
  serializable transactions needed. The check and the decrement happen
  atomically in one statement because the predicate is part of the `UPDATE`.

`confirm_reservation` and `release_reservation` follow the same pattern but
use `SELECT ... FOR UPDATE` to lock the reservation row first, then validate
its current status and expiry before mutating. This makes concurrent
`confirm + release` on the same reservation deterministic — the first one
wins, the second sees a non-`pending` status and is rejected.

### Why no Redis

Postgres already provides the atomicity primitives we need. Adding Redis
would only make sense if we wanted to (a) push reservation throughput beyond
what a single Postgres instance can handle, or (b) move idempotency caching
out of the hot path. Neither applies at this scale, and using Redis here
would mean operating two consistency models for the same business invariant
(units of stock) — a recipe for split-brain bugs.

---

## Reservation expiry

Three layers of defence so a forgotten reservation never permanently holds
stock:

1. **Lazy cleanup on read.** `GET /api/products` and `GET /api/reservations/:id`
   both call `expire_stale_reservations()` before responding. This means
   anyone *looking at* stock implicitly cleans up expired holds — the most
   relevant case in practice, because stock visibility is what matters.
2. **Cron job (production).** A `pg_cron` job runs every minute and calls
   `POST /api/public/expire-reservations`:
   ```sql
   select cron.schedule(
     'allo-expire-reservations',
     '* * * * *',
     $$ select net.http_post(
          url := 'https://project--<id>.lovable.app/api/public/expire-reservations',
          headers := '{"Content-Type":"application/json","apikey":"<anon-key>"}'::jsonb,
          body := '{}'::jsonb
     ); $$
   );
   ```
   This is already scheduled in this project's database. The endpoint just
   invokes `expire_stale_reservations()` and returns the count of expired
   holds. The `/api/public/*` prefix bypasses Lovable's edge auth.
3. **Confirm-time safeguard.** `confirm_reservation()` re-checks `expires_at`
   under a row lock and refuses (with `expired`) if the TTL has elapsed —
   even if the cron hasn't run yet. The HTTP layer maps that to `410 Gone`.

If I had more time I'd move to a `LISTEN/NOTIFY`-driven worker with a
heap-ordered priority queue keyed on `expires_at`, so cleanup latency is
proportional to the TTL of the soonest-expiring hold rather than 1 minute.

---

## Idempotency (bonus)

Implemented for both `POST /api/reservations` and
`POST /api/reservations/:id/confirm`. The client sends an `Idempotency-Key`
header (the browser does this automatically with `crypto.randomUUID()`).

On the server:

1. Look up `(endpoint, key)` in `idempotency_keys`.
2. If a row exists, replay its cached `status_code` and `response_body`
   verbatim (plus an `Idempotent-Replay: true` header) — **no side effect.**
3. Otherwise execute the action, then `INSERT` the response into
   `idempotency_keys` keyed on `(endpoint, key)`.

The key is scoped by endpoint so the same UUID couldn't accidentally satisfy
both a reserve and a confirm. Duplicate-key INSERT failures (a true race on
the same key) are swallowed — the next read of the cached row wins.

A `(key, endpoint)` `PRIMARY KEY` guarantees uniqueness at the database
layer, and the table has RLS enabled with no policy so only the server
(service role) can read or write it.

---

## Frontend

- **`/`** — product grid; per-warehouse availability with a quantity stepper
  and Reserve button. Auto-refreshes every 5s with TanStack Query so other
  users' reservations show up without a manual refresh.
- **`/checkout/$id`** — reservation details, live `mm:ss` countdown,
  *Confirm purchase* and *Cancel* buttons. Polls every 3s while pending so a
  cron-driven expiry surfaces in-flight.

Errors are surfaced via `sonner` toasts. The two important ones are:

- `409` → *"Not enough stock available right now"* and the product list is
  re-fetched immediately so the user sees the updated availability.
- `410` → *"Reservation expired before payment could be confirmed"* and the
  reservation card re-renders with an *Expired* badge.

---

## Mapping to the brief

| Brief                     | This repo                                                       |
| ------------------------- | --------------------------------------------------------------- |
| Next.js App Router        | TanStack Start file routes (`src/routes/api/*` for HTTP)        |
| Prisma                    | Generated typed Supabase client (`src/integrations/supabase/`)  |
| Hosted Postgres           | Lovable Cloud (managed Supabase)                                |
| Redis for locking         | Postgres conditional `UPDATE` — see *Concurrency model*         |
| Zod                       | Used for request validation in the reservation route            |
| Tailwind + shadcn/ui      | Same — already in the template                                  |

The HTTP shape, the data model, the SQL, the UX flow, and the operational
expiry strategy are all directly portable to a Next.js + Prisma codebase: the
SQL functions go into a Prisma migration unchanged, the route handlers become
`app/api/*/route.ts` files, and the React code is identical.

---

## Trade-offs and what I'd do with more time

- **No auth.** Anyone can create / confirm / release any reservation. The
  brief doesn't require auth, so I scoped it out. In production I'd attach
  reservations to `user_id` and tie confirm/release to the owner via RLS.
- **No payment integration.** *Confirm purchase* is a button that finalises
  the reservation. In production it would gate on a Stripe / Razorpay webhook
  rather than a user click.
- **Per-warehouse only.** A real fulfillment system would let you reserve N
  units across the cheapest combination of warehouses. I kept it single-warehouse
  to match the brief's API shape.
- **Lazy cleanup runs unconditionally on every list read.** Cheap at this
  scale, but I'd move it behind an in-process throttle (e.g. once per second)
  if `/api/products` started getting hammered.
- **Idempotency keys never expire.** I'd add a `created_at`-based TTL (24h is
  industry standard, e.g. Stripe) and a periodic cleanup so the table
  doesn't grow unbounded.
- **Concurrency is tested by eye, not in code.** I'd add a `k6` or `vitest`
  load test that fires N concurrent reserve requests at a 1-unit SKU and
  asserts exactly 1 succeeds.
- **No observability.** I'd wire `pg_stat_statements`, structured request
  logging, and per-endpoint error rates before shipping this for real.
