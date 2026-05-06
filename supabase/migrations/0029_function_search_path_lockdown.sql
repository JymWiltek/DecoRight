-- 0029 — Pin search_path = '' on every public schema function.
--
-- Why: Supabase Security Advisor flagged 6 functions with "Function Search
--      Path Mutable" (lint 0011). Without an explicit search_path, the
--      function inherits the caller's, which means a malicious caller could
--      precede `public` with a hostile schema and shadow built-in references
--      — turning a trigger into a vector for privilege escalation when the
--      function runs as SECURITY DEFINER, or for unexpected behaviour when
--      it runs as INVOKER inside an admin's session.
--
-- Choice — `''` (empty) over `public`:
--   I read every function body. All six are schema-qualified already
--   (public.products, public.api_usage, public.app_config,
--    public.item_subtypes) or only call pg_catalog built-ins (now(),
--    array_length, hashtext, pg_advisory_xact_lock, type casts). pg_catalog
--   is implicitly searched even with an empty search_path, so the strictest
--   setting works without altering function bodies. This is the
--   Supabase-recommended pattern.
--
-- Functions covered (alphabetic):
--   1. products_check_rooms_required()           — trigger
--   2. products_check_subtype_consistency()       — trigger
--   3. reserve_api_slot(text, uuid, uuid, text)   — RPC, SECURITY DEFINER
--   4. set_updated_at()                           — trigger
--   5. sync_primary_thumbnail()                   — trigger
--   6. validate_product_subtype()                 — trigger
--
-- The other three Advisor WARN entries (extension_in_public/pg_net and the
-- two SECURITY DEFINER-executable lints on reserve_api_slot) are different
-- lint codes and are out of scope for this commit per the audit plan.

alter function public.products_check_rooms_required()           set search_path = '';
alter function public.products_check_subtype_consistency()       set search_path = '';
alter function public.reserve_api_slot(text, uuid, uuid, text)   set search_path = '';
alter function public.set_updated_at()                           set search_path = '';
alter function public.sync_primary_thumbnail()                   set search_path = '';
alter function public.validate_product_subtype()                 set search_path = '';
