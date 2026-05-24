## Add a cover/landing page

Currently `/` renders the inventory (products) page directly. We'll introduce a dedicated cover page as the new entry point and move the inventory to its own route.

### Routing changes
- Move current `src/routes/index.tsx` content → `src/routes/inventory.tsx` (URL: `/inventory`).
- Replace `src/routes/index.tsx` with a new landing/cover page (URL: `/`).

### Cover page content
- Hero section with:
  - Project title: "Allo Inventory"
  - Tagline: "Race-safe reservations for multi-warehouse retail."
  - Short 2–3 line description of what the system does (reserve stock during checkout, auto-expiry, idempotent APIs).
- Primary CTA button → `/inventory` ("Browse Products" / "Enter Inventory").
- Secondary section with 3 feature cards highlighting the core ideas: Atomic reservations, Auto-expiry, Idempotent APIs.
- Footer note linking to the README concepts (concurrency, expiry, idempotency).
- Per-route `head()` meta (title, description, og tags) distinct from the inventory page.

### Visual style
- Reuse existing design tokens from `src/styles.css` (no new colors).
- Clean, minimal, centered hero with generous whitespace — consistent with the existing inventory UI.

### Out of scope
- No backend, API, or schema changes.
- No auth gating.
- Checkout flow (`/checkout/$id`) and all `/api/*` routes remain untouched.
