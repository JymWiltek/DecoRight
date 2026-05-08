/**
 * Minimal typings for the `draco3dgltf` package — Khronos's slimmed
 * Draco WASM bundle for glTF use.
 *
 * The upstream package ships no `.d.ts` and there's no `@types/`
 * counterpart on DefinitelyTyped. We only need the two factory
 * functions used by gltf-transform's draco() transform, so this
 * declaration is intentionally narrow — the encoder/decoder modules
 * themselves are passed straight to gltf-transform, which has its
 * own internal contract for what to call on them.
 */
declare module "draco3dgltf" {
  export function createEncoderModule(): Promise<unknown>;
  export function createDecoderModule(): Promise<unknown>;
  const draco3dgltf: {
    createEncoderModule: typeof createEncoderModule;
    createDecoderModule: typeof createDecoderModule;
  };
  export default draco3dgltf;
}
