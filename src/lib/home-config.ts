// Homepage fixed visuals — Approach A (frozen in place, no admin UI yet).
//
// These two spots used to auto-follow the newest upload (page.tsx read
// latest-product thumbnails + coversByItemType's newest-per-type). They are
// now FIXED here so uploading a product never changes the homepage.
//
// HOW TO CHANGE AN IMAGE (no deploy needed for the pointed-to file):
//   • Hero images / a category cover → replace the URL string below, OR
//     overwrite the file at that storage path in Supabase (same URL, new bytes).
//   • A new category not listed here falls back to its newest product cover.
//
// Later (admin UI): mirror rooms.cover_url — add item_types.cover_url + a
// site_settings row for the heroes, then read those instead of these consts.

/** "See It In Your Space. Then Buy It." hero background. */
export const HERO_AR_IMAGE = "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/a0d3c3cf-621a-4605-a8c2-9d5ce8f87489/scene-1783687301134.png?v=1783687301490";

/** "Every Model Is a Real Product You Can Buy" hero background. */
export const HERO_BUY_IMAGE = "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/9f9a289b-da82-4214-a5a6-7daba4ce57af/scene-1783687454855.png?v=1783687455638";

/** Fixed "Browse by Product Type" cover per item_type slug. Unlisted slugs
 *  fall back to the dynamic newest-product cover (coversByItemType). */
export const ITEM_TYPE_COVERS: Record<string, string> = {
  toilet: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/2e638c1e-8889-4029-be33-558a46ab8e23/scene-1783849355033.png?v=1783849357023",
  bathroom_equipments: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/6765f0ab-f2ad-4237-a958-624c8bc46bbf/42de2077-245c-401c-9a2c-ff4c91a06656.png?v=1783672997768",
  faucet: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/eead14f7-fa88-4354-a6e6-2ff34fdb01f2/8be78402-3d74-4655-a45d-f96ced009306.jpg?v=1783672378201",
  shower: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/2325d96f-f90e-4362-aba6-8cc5a374fde6/fcf96785-750a-4408-82d2-5c302e4aed15.jpg?v=1783671960566",
  sink: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/0244b653-3813-498b-8320-c79c1252b493/e7ddae92-b03a-4397-8bb7-aee8064d6051.jpg?v=1783671460903",
  range_hood: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/1a5aa9cb-2b3b-425c-8323-c9bb1de67a4f/61e938b9-8537-4814-94dd-f398ce133835.jpg?v=1783671418496",
  bathtub: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/d5850947-177c-4f6e-b997-7b92bf9c999c/387fd0c7-9f99-4a65-9fc8-ba20dc8cded4.png?v=1783671028218",
  basin: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/9dba1ea9-8809-4846-b987-409ed4dda091/87474244-a5b8-4834-9889-381b76bba749.jpg?v=1783670980211",
  bathroom_vanity: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/a4785d4c-719a-48f8-9f08-5e320c691a08/3af5c04e-960f-486e-a95d-144867203f9f.jpg?v=1783601175558",
  bed_frame: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/2bad9d2a-e7ed-4907-ae0c-074e7ba782ad/935fa496-0bcc-440a-b448-d2ed1659314e.jpg?v=1783580410872",
  vanity: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/ba8dc807-ee0b-4007-af95-10f901100f15/666e83d9-339e-41c0-a5b2-4846e1c9bd56.jpg?v=1783580376511",
  sofa: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/a31fc6bb-00be-462e-b147-ba989b7f3682/bdd36420-b551-451f-b187-7fafd017a89c.webp?v=1783569252469",
  dining_table: "https://mooggzqjybwuprrsgnny.supabase.co/storage/v1/object/public/cutouts/dc170d9b-6b70-41c1-9fa3-845bf07164de/91801010-8192-4567-84c3-d3099de21b0d.webp?v=1783568286959",
};
