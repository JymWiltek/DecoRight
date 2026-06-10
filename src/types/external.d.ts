/**
 * Ambient declarations for npm packages that ship JS without
 * accompanying TypeScript definitions. Wave 9 introduced two:
 *
 *   • draco3dgltf  — Google's Draco encoder/decoder WASM modules
 *     used by @gltf-transform/functions' `draco()` transform. We
 *     only call `createDecoderModule()` + `createEncoderModule()`
 *     and pass the results into gltf-transform's
 *     `io.registerDependencies({...})`. gltf-transform itself
 *     types those slots as `unknown`, so a coarse `any` here is
 *     fine — no precision is lost.
 *
 *   • gltf-validator — Khronos's reference glTF validator. We use
 *     just the `validateBytes(bytes, options?)` Promise API and
 *     coerce the result through our own `ValidatorResult` shape in
 *     lib/glb-validator. Declaring `any` here keeps the call site
 *     compiling without pretending we know the full library API.
 *
 * If upstream ships proper types in a future major version, delete
 * the matching block — TS picks up the package types automatically.
 */

declare module "draco3dgltf";
declare module "gltf-validator";
