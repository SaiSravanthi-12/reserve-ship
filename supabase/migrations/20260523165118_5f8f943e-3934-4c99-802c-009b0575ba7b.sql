
-- Extensions
create extension if not exists pgcrypto;

-- =========================
-- TABLES
-- =========================
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  description text,
  price_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.stock (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  total_units integer not null default 0,
  reserved_units integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (product_id, warehouse_id),
  constraint stock_non_negative check (total_units >= 0 and reserved_units >= 0 and reserved_units <= total_units)
);

create type public.reservation_status as enum ('pending','confirmed','released','expired');

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  quantity integer not null check (quantity > 0),
  status public.reservation_status not null default 'pending',
  expires_at timestamptz not null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reservations_status_expires_idx on public.reservations(status, expires_at);

create table public.idempotency_keys (
  key text not null,
  endpoint text not null,
  status_code integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, endpoint)
);

-- =========================
-- RLS: public read, writes only via service role / SQL functions
-- =========================
alter table public.warehouses enable row level security;
alter table public.products enable row level security;
alter table public.stock enable row level security;
alter table public.reservations enable row level security;
alter table public.idempotency_keys enable row level security;

create policy "public read warehouses" on public.warehouses for select using (true);
create policy "public read products" on public.products for select using (true);
create policy "public read stock" on public.stock for select using (true);
create policy "public read reservations" on public.reservations for select using (true);
-- idempotency_keys: no policies => only service role can access.

-- =========================
-- FUNCTIONS
-- =========================

-- Atomic reservation. Returns reservation row if successful, NULL otherwise.
-- Race-safety: the WHERE clause includes the availability check, so the conditional
-- UPDATE either succeeds for ONE concurrent caller or returns 0 rows for the loser.
create or replace function public.try_reserve_stock(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_quantity integer,
  p_ttl_seconds integer default 600
) returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
  v_res public.reservations;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be > 0';
  end if;

  update public.stock
     set reserved_units = reserved_units + p_quantity,
         updated_at = now()
   where product_id = p_product_id
     and warehouse_id = p_warehouse_id
     and (total_units - reserved_units) >= p_quantity;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return null;  -- insufficient stock; caller should return 409
  end if;

  insert into public.reservations (product_id, warehouse_id, quantity, status, expires_at)
  values (p_product_id, p_warehouse_id, p_quantity, 'pending', now() + make_interval(secs => p_ttl_seconds))
  returning * into v_res;

  return v_res;
end;
$$;

-- Confirm: only if still pending AND not expired. Decrement total & reserved by quantity
-- (i.e. units physically leave inventory).
create or replace function public.confirm_reservation(p_id uuid)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations;
begin
  -- lock the row
  select * into v_res from public.reservations where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;

  if v_res.status = 'confirmed' then
    return v_res; -- idempotent at the domain level
  end if;

  if v_res.status <> 'pending' then
    raise exception 'invalid_status:%', v_res.status;
  end if;

  if v_res.expires_at <= now() then
    -- auto-release on confirm of an expired hold
    update public.stock
       set reserved_units = greatest(reserved_units - v_res.quantity, 0),
           updated_at = now()
     where product_id = v_res.product_id and warehouse_id = v_res.warehouse_id;
    update public.reservations set status='expired', updated_at=now() where id = p_id
    returning * into v_res;
    raise exception 'expired';
  end if;

  update public.stock
     set total_units    = total_units    - v_res.quantity,
         reserved_units = reserved_units - v_res.quantity,
         updated_at = now()
   where product_id = v_res.product_id and warehouse_id = v_res.warehouse_id;

  update public.reservations
     set status='confirmed', updated_at=now()
   where id = p_id
  returning * into v_res;

  return v_res;
end;
$$;

create or replace function public.release_reservation(p_id uuid)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations;
begin
  select * into v_res from public.reservations where id = p_id for update;
  if not found then raise exception 'not_found'; end if;

  if v_res.status in ('released','expired') then
    return v_res; -- idempotent
  end if;
  if v_res.status = 'confirmed' then
    raise exception 'already_confirmed';
  end if;

  update public.stock
     set reserved_units = greatest(reserved_units - v_res.quantity, 0),
         updated_at = now()
   where product_id = v_res.product_id and warehouse_id = v_res.warehouse_id;

  update public.reservations set status='released', updated_at=now() where id = p_id
  returning * into v_res;
  return v_res;
end;
$$;

-- Bulk expire stale pending reservations. Returns the number expired.
create or replace function public.expire_stale_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select id, product_id, warehouse_id, quantity
      from public.reservations
     where status = 'pending' and expires_at <= now()
     for update skip locked
  loop
    update public.stock
       set reserved_units = greatest(reserved_units - r.quantity, 0),
           updated_at = now()
     where product_id = r.product_id and warehouse_id = r.warehouse_id;

    update public.reservations
       set status='expired', updated_at=now()
     where id = r.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- =========================
-- SEED
-- =========================
with w as (
  insert into public.warehouses (code, name) values
    ('MUM','Mumbai DC'),
    ('DEL','Delhi DC'),
    ('BLR','Bengaluru DC')
  returning id, code
),
p as (
  insert into public.products (sku, name, description, price_cents) values
    ('ALLO-TEE-01',  'Allo Cotton Tee',       'Heavyweight 240gsm tee.',                    149900),
    ('ALLO-HOOD-01', 'Allo Fleece Hoodie',    'Brushed-back fleece, kangaroo pocket.',      349900),
    ('ALLO-CAP-01',  'Allo 6-Panel Cap',      'Structured 6-panel cap, embroidered logo.',   99900),
    ('ALLO-SCK-01',  'Allo Crew Socks',       'Combed cotton crew socks (3-pack).',          59900),
    ('ALLO-BAG-01',  'Allo Canvas Tote',      '14oz cotton canvas tote, gusseted base.',    129900),
    ('ALLO-MUG-01',  'Allo Enamel Mug',       '350ml enamel camping mug.',                   49900)
  returning id, sku
)
insert into public.stock (product_id, warehouse_id, total_units, reserved_units)
select p.id, w.id,
  case
    when p.sku = 'ALLO-TEE-01'  then case w.code when 'MUM' then 12 when 'DEL' then 8  else 3 end
    when p.sku = 'ALLO-HOOD-01' then case w.code when 'MUM' then 5  when 'DEL' then 4  else 2 end
    when p.sku = 'ALLO-CAP-01'  then case w.code when 'MUM' then 20 when 'DEL' then 0  else 15 end
    when p.sku = 'ALLO-SCK-01'  then case w.code when 'MUM' then 30 when 'DEL' then 25 else 30 end
    when p.sku = 'ALLO-BAG-01'  then case w.code when 'MUM' then 1  when 'DEL' then 2  else 1 end
    when p.sku = 'ALLO-MUG-01'  then case w.code when 'MUM' then 7  when 'DEL' then 6  else 9 end
  end,
  0
from p cross join w;
