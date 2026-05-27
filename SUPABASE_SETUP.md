# Supabase setup

Run `supabase-schema.sql` once in the Supabase SQL editor.

Then set these Vercel environment variables for the serverless routes:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional: `SUPABASE_PROGRAM_TABLE` if you want a different table name
- optional: `SUPABASE_ADMIN_TABLE` if you want a different admin table name
- optional: `SUPABASE_PROGRAM_ROW_ID` if you want a different main row id

The admin page is now a direct editing workspace at `/admin-inlog`.
It writes through `/api/state` and the public frontend reads `public.program_state` directly.
Realtime subscriptions still keep all browsers in sync.

Public frontend is served from `/`.
