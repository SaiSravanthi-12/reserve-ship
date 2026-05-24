/**
 * Race-condition test for atomic stock reservation.
 *
 * Spins up two real Postgres connections, seeds 1 unit of stock, and fires
 * try_reserve_stock concurrently from both. Asserts exactly one wins (returns
 * a reservation row) and the other gets back NULL (which the HTTP layer maps
 * to a 409).
 *
 * Run with: bun run test
 */
import { afterAll, beforeAll, expect, test } from "vitest";
import { Client } from "pg";

const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  throw new Error("SUPABASE_DB_URL must be set to run race tests");
}

const SSL = { rejectUnauthorized: false };
const newClient = () => new Client({ connectionString: DB_URL, ssl: SSL });

let productId: string;
let warehouseId: string;

async function exec<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = newClient();
  await c.connect();
  try {
    const r = await c.query(sql, params);
    return r.rows as T[];
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [{ id: pid }] = await exec<{ id: string }>(
    `insert into public.products (sku, name, price_cents)
     values ($1, $2, 1000) returning id`,
    [`TEST-SKU-${suffix}`, `Race Test Product ${suffix}`],
  );
  const [{ id: wid }] = await exec<{ id: string }>(
    `insert into public.warehouses (code, name)
     values ($1, $2) returning id`,
    [`TW-${suffix}`, `Test Warehouse ${suffix}`],
  );
  await exec(
    `insert into public.stock (product_id, warehouse_id, total_units, reserved_units)
     values ($1, $2, 1, 0)`,
    [pid, wid],
  );
  productId = pid;
  warehouseId = wid;
});

afterAll(async () => {
  if (!productId) return;
  // Best-effort cleanup — some roles can't DELETE from reservations directly;
  // those rows are harmless test data and won't affect anything.
  const safe = async (sql: string, params: unknown[]) => {
    try { await exec(sql, params); } catch (e) { console.warn("[cleanup]", (e as Error).message); }
  };
  await safe(`delete from public.reservations where product_id = $1`, [productId]);
  await safe(`delete from public.stock where product_id = $1`, [productId]);
  await safe(`delete from public.products where id = $1`, [productId]);
  await safe(`delete from public.warehouses where id = $1`, [warehouseId]);
});

test("two concurrent reservations for the last unit → exactly one succeeds", async () => {
  // Two independent connections = genuine concurrency at the DB layer.
  const c1 = newClient();
  const c2 = newClient();
  await Promise.all([c1.connect(), c2.connect()]);

  try {
    const call = (c: Client) =>
      c.query(
        `select * from public.try_reserve_stock($1::uuid, $2::uuid, 1, 600) as r`,
        [productId, warehouseId],
      );

    const [r1, r2] = await Promise.all([call(c1), call(c2)]);

    // try_reserve_stock returns a composite row when it wins, or NULL when it loses.
    // pg surfaces NULL as a row whose `.id` is null.
    const winners = [r1, r2].filter((r) => r.rows[0]?.id != null);
    const losers = [r1, r2].filter((r) => r.rows[0]?.id == null);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    // The winning reservation actually exists in the table.
    const winnerId = winners[0].rows[0].id as string;
    const found = await exec<{ id: string; status: string; quantity: number }>(
      `select id, status, quantity from public.reservations where id = $1`,
      [winnerId],
    );
    expect(found).toHaveLength(1);
    expect(found[0].status).toBe("pending");
    expect(found[0].quantity).toBe(1);

    // Stock is fully reserved — no more units available.
    const stock = await exec<{ total_units: number; reserved_units: number }>(
      `select total_units, reserved_units from public.stock
       where product_id = $1 and warehouse_id = $2`,
      [productId, warehouseId],
    );
    expect(stock[0].total_units - stock[0].reserved_units).toBe(0);
  } finally {
    await Promise.all([c1.end(), c2.end()]);
  }
});
