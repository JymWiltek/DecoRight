-- =====================================================================
-- 0009 · harden sync_primary_thumbnail()
--
-- The trigger from 0003 was already scoped correctly (it always
-- updates `products` WHERE id = new.product_id, one row). But it
-- fired on ANY row where `is_primary = true AND cutout_image_url is
-- not null`, regardless of the row's state. Approved flow sets
-- is_primary + state='cutout_approved' in the same UPDATE, so in
-- practice nothing was wrong. But if a future code path ever sets
-- is_primary=true on a row whose state is not 'cutout_approved'
-- (e.g. a rejected image that used to be primary getting its
-- cutout_image_url refreshed by a rerun), the old trigger would
-- happily copy that url into products.thumbnail_url.
--
-- Belt-and-suspenders: require state='cutout_approved' before
-- writing the thumbnail. Also widen the trigger to also watch
-- UPDATE OF state, so the moment an image becomes "approved + primary
-- + has a cutout" we sync — no matter which column was the last to
-- flip.
-- =====================================================================

create or replace function public.sync_primary_thumbnail()
returns trigger language plpgsql as $$
begin
  -- Only approved primary cutouts propagate to products.thumbnail_url.
  if new.is_primary
     and new.state = 'cutout_approved'
     and new.cutout_image_url is not null then
    update public.products
       set thumbnail_url = new.cutout_image_url,
           updated_at    = now()
     where id = new.product_id;
  end if;
  return new;
end $$;

drop trigger if exists product_images_sync_thumb on public.product_images;
create trigger product_images_sync_thumb
after insert or update of is_primary, cutout_image_url, state
on public.product_images
for each row execute function public.sync_primary_thumbnail();

notify pgrst, 'reload schema';
