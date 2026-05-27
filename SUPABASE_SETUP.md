# Supabase setup

Run `supabase-schema.sql` once in the Supabase SQL editor.

Then set these Vercel environment variables for the serverless routes:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional: `SUPABASE_PROGRAM_TABLE` if you want a different table name
- optional: `SUPABASE_ADMIN_TABLE` if you want a different admin table name
- optional: `SUPABASE_PROGRAM_ROW_ID` if you want a different main row id

Admin access uses Supabase Auth:

1. Create the admin account in Supabase Auth.
2. Insert that user into `public.admin_users` with `active = true`.
3. Sign in on the admin page with that email and password.

The browser reads `public.program_state` directly and subscribes to Realtime changes.
Admin writes go through `/api/state`.
