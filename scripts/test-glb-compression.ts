/**
 * Exit-gate + 2K-texture regression test for the GLB compression pipeline.
 *
 * Exercises the REAL production `compressGlbBytes()` on synthetic GLBs
 * built in-memory — NO Storage, NO DB, NO OpenAI, net-zero. Proves:
 *
 *   ② a normal large model (4K texture) compresses, its textures are
 *      resized to ≤2048, and before → after sizes are reported;
 *   ③ a model whose compressed output still exceeds the 15 MB exit gate
 *      is REJECTED with the data-bearing error (原始/压缩后 sizes + cap);
 *   ④ a small model passes untouched (regression — normal flow intact).
 *
 * Run:
 *   NODE_OPTIONS='--conditions=react-server --max-old-space-size=4096' \
 *     npx tsx --env-file=.env.local scripts/test-glb-compression.ts
 */
import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import sharp from "sharp";

import { compressGlbBytes } from "../src/lib/glb-compression";
import { MAX_COMPRESSED_OUTPUT_MB } from "../src/lib/admin/glb-budget";

// ── deterministic PRNG so "noise" textures are reproducible ──
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** A WxH image. `noise=true` → incompressible random RGB (worst case for
 *  any codec — used to force the compressed output over the exit gate).
 *  `noise=false` → a smooth gradient (very compressible). */
async function makeImage(w: number, h: number, noise: boolean, seed: number): Promise<Uint8Array> {
  const rnd = lcg(seed);
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if (noise) {
        raw[i] = (rnd() * 256) | 0;
        raw[i + 1] = (rnd() * 256) | 0;
        raw[i + 2] = (rnd() * 256) | 0;
      } else {
        raw[i] = (x / w) * 255;
        raw[i + 1] = (y / h) * 255;
        raw[i + 2] = 128;
      }
    }
  }
  // Store as JPEG (keeps the in-memory original modest); the pipeline
  // re-encodes to webp regardless of input format.
  return new Uint8Array(
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer(),
  );
}

/** Build a valid GLB: one triangle primitive per material, each material
 *  carrying one texture. `n` textures of `dim`×`dim`. */
async function buildGlb(n: number, dim: number, noise: boolean): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();

  for (let k = 0; k < n; k++) {
    // Minimal but valid geometry: a single triangle.
    const position = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buffer);
    const uv = doc
      .createAccessor()
      .setType("VEC2")
      .setArray(new Float32Array([0, 0, 1, 0, 0, 1]))
      .setBuffer(buffer);

    const img = await makeImage(dim, dim, noise, 1000 + k);
    const texture = doc.createTexture(`tex${k}`).setImage(img).setMimeType("image/jpeg");
    const material = doc.createMaterial(`mat${k}`).setBaseColorTexture(texture);

    const prim = doc
      .createPrimitive()
      .setAttribute("POSITION", position)
      .setAttribute("TEXCOORD_0", uv)
      .setMaterial(material);
    const mesh = doc.createMesh(`mesh${k}`).addPrimitive(prim);
    const node = doc.createNode(`node${k}`).setMesh(mesh);
    scene.addChild(node);
  }

  return new Uint8Array(await new NodeIO().writeBinary(doc));
}

/** Read back a compressed (Draco) GLB and return the max texture side. */
async function maxTextureDim(bytes: Uint8Array): Promise<number> {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
      "draco3d.encoder": await draco3d.createEncoderModule(),
    });
  const doc = await io.readBinary(bytes);
  let max = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const image = tex.getImage();
    if (!image) continue;
    const meta = await sharp(Buffer.from(image)).metadata();
    max = Math.max(max, meta.width ?? 0, meta.height ?? 0);
  }
  return max;
}

const mb = (kb: number) => (kb / 1024).toFixed(2);
let failures = 0;
function assert(cond: boolean, label: string) {
  console.log(`   ${cond ? "✓" : "✗ FAIL"} ${label}`);
  if (!cond) failures++;
}

(async () => {
  console.log(`\n── exit gate = ${MAX_COMPRESSED_OUTPUT_MB} MB ──\n`);

  // ② normal large model: one 4096² compressible texture → resized to 2K.
  console.log("② 正常大模型(4K 贴图)→ 压缩 + 贴图降至 2K + 前后大小");
  {
    const original = await buildGlb(1, 4096, false);
    const res = await compressGlbBytes(original);
    const maxDim = await maxTextureDim(res.compressedBytes);
    console.log(`   ${mb(res.originalKb)} MB → ${mb(res.compressedKb)} MB · 贴图最大边 ${maxDim}px`);
    assert(res.compressedKb < res.originalKb, "压缩后 < 原始(压缩确有发生)");
    assert(maxDim <= 2048, `贴图降到 ≤2048px(实测 ${maxDim}px)`);
    assert(res.compressedKb <= MAX_COMPRESSED_OUTPUT_MB * 1024, "在 15MB 出口闸内 → 放行");
  }

  // ③ oversize: many 2K noise textures → compressed still > 15 MB → REJECT.
  console.log("\n③ 压缩后仍超 15MB → 拒绝入库 + 报错带数据");
  {
    const original = await buildGlb(10, 2048, true); // 10× incompressible 2K
    let threw = false;
    let msg = "";
    try {
      await compressGlbBytes(original);
    } catch (e) {
      threw = true;
      msg = e instanceof Error ? e.message : String(e);
    }
    console.log(`   error: ${msg}`);
    assert(threw, "抛出拒绝错误(未静默放行)");
    assert(/压缩后仍/.test(msg) && /原始/.test(msg), "报错含 原始/压缩后 数据");
    assert(new RegExp(`${MAX_COMPRESSED_OUTPUT_MB} MB`).test(msg), "报错含 15 MB 上限");
  }

  // ④ small model: regression — normal small flow untouched.
  console.log("\n④ 正常小文件 → 流程回归不受影响");
  {
    const original = await buildGlb(1, 512, false);
    const res = await compressGlbBytes(original);
    console.log(`   ${mb(res.originalKb)} MB → ${mb(res.compressedKb)} MB`);
    assert(res.compressedKb <= MAX_COMPRESSED_OUTPUT_MB * 1024, "小文件正常压缩、放行、无抛错");
  }

  console.log(`\n${failures === 0 ? "✓ ALL PASS" : `✗ ${failures} FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
