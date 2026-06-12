-- 0045 — Wave 11b: allow texture + zip MIME types in the models bucket.
--
-- The models bucket previously allowed only model/gltf-binary and
-- application/octet-stream (glb + fbx). Wave 11b adds:
--   • FBX texture maps   → image/jpeg, image/png, image/webp
--   • the FBX zip bundle  → application/zip
-- Without these, the texture dropzone's signed-URL PUT and the
-- packager's zip upload both 415 (invalid_mime_type).
--
-- Strictly widens the allowlist — existing glb/fbx uploads keep
-- working. Idempotent: sets the full array so re-running is safe.

update storage.buckets
   set allowed_mime_types = array[
     'model/gltf-binary',
     'application/octet-stream',
     'image/jpeg',
     'image/png',
     'image/webp',
     'application/zip'
   ]
 where id = 'models';
