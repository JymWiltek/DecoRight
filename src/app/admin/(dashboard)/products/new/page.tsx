import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { invalidatePublishedCountsCache } from "@/lib/products";

export const dynamic = "force-dynamic";

/**
 * /admin/products/new — used to be a name-only stub form: type a
 * product name → POST → redirect to /edit. That meant the operator
 * saw "Name" first on /new but "Photos" first on /edit (Phase 1 收尾
 * F5 reordered the workbench to put Photos at the top). Two flows,
 * two orderings. Confusing.
 *
 * Phase 1 收尾 P0 #4 fix: there is now exactly ONE form layout (the
 * /edit workbench). Clicking "+ New" creates an "Untitled product"
 * draft inline and redirects straight to /edit, so the operator
 * lands in the same form whether they're starting fresh or
 * reopening a saved row.
 *
 * Trade-off acknowledged: refreshing /new in the browser creates
 * another orphan "Untitled" draft. Phase 1 is a closed-team admin
 * tool with low traffic, drafts are filterable on the list page,
 * and a "delete drafts > N days old with no images + no rooms"
 * cleanup is a separate task if it ever becomes painful.
 *
 * Why this lives in a Server Component (not a Server Action) — we
 * only mutate per *navigation*, not per click. A Server Component
 * runs on every GET, which matches "click + New → land in /edit".
 * Putting this in actions.ts would leak a second URL-addressable
 * mutation (Server Actions are URL endpoints) for no reason.
 */
export default async function NewProductPage() {
  const id = crypto.randomUUID();
  const supabase = createServiceRoleClient();

  // Match Migration 0013's NOT NULL columns and let parsePayload-style
  // defaults take care of the rest. Empty arrays for the multi-select
  // tags so the row is consistent with what /edit's Save would produce
  // for a brand-new product (vs. a NULL hole that'd surprise downstream
  // queries). Status='draft' so the row never accidentally goes public
  // before the operator gets to /edit.
  const { error } = await supabase.from("products").insert({
    id,
    name: "Untitled product",
    status: "draft",
    room_slugs: [],
    styles: [],
    colors: [],
    materials: [],
    store_locations: [],
    ai_filled_fields: [],
  });

  if (error) {
    // Surface the DB rejection on the next /edit visit (the page reads
    // ?err= / ?msg= and renders a banner). Redirecting to a dummy id
    // would 404, so route the operator back to the products list with
    // the error attached.
    redirect(
      `/admin?err=db&msg=${encodeURIComponent(`Failed to start a new draft: ${error.message}`)}`,
    );
  }

  // Next.js 16 forbids cache invalidation during a Server Component
  // render — has to happen *after* the response is committed. `after()`
  // schedules these for post-render so the redirect below isn't
  // blocked. (Both calls also run if redirect throws — that's the
  // documented behaviour of `after`.)
  after(() => {
    revalidatePath("/admin");
    invalidatePublishedCountsCache();
  });

  // ?fresh=1 triggers the post-create toast in /edit (the one with
  // "+ Another" / "View" actions) — same UX as the old name-only flow.
  redirect(`/admin/products/${id}/edit?fresh=1`);
}
