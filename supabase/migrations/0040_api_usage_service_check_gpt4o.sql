-- 0040 — Allow GPT-4o vision service tags on api_usage.service.
--
-- The api_usage_service_check constraint dates to mig 0001 and only
-- listed rembg/meshy. Wave 3 added 'gpt4o_vision_spec', Wave 6 added
-- '_merged', Wave 7 added '_v2' — all in the TypeScript union but
-- none in the DB CHECK. Result: every spec-parser cost write since
-- Wave 3 has been silently rejected (supabase-js doesn't throw on
-- CHECK violations, just returns {data:null,error}, and the call-site
-- didn't inspect error). Confirmed by zero gpt4o_vision_spec* rows
-- existing in api_usage despite product rows clearly carrying V2
-- ai_confidences output.
--
-- Discovered while debugging Jym's "V2 didn't run" report — the
-- product 9149984a-... was correctly auto-published with V2 fields
-- but the api_usage telemetry row never landed, blinding us to the
-- actual GPT-4o call telemetry.

alter table public.api_usage
  drop constraint if exists api_usage_service_check;

alter table public.api_usage
  add constraint api_usage_service_check
  check (service = any (array[
    'replicate_rembg'::text,
    'removebg'::text,
    'meshy'::text,
    'gpt4o_vision_spec'::text,
    'gpt4o_vision_spec_merged'::text,
    'gpt4o_vision_spec_v2'::text
  ]));

notify pgrst, 'reload schema';
