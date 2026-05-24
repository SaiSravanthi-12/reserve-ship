-- Make (endpoint, key) the primary key so duplicate inserts race-fail safely.
ALTER TABLE public.idempotency_keys
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'idempotency_keys_pkey'
  ) THEN
    ALTER TABLE public.idempotency_keys
      ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (endpoint, key);
  END IF;
END $$;
