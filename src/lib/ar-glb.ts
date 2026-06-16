/**
 * Bake a real-world scale into a GLB so AR shows true product size.
 *
 * Why this exists: <model-viewer>'s runtime `scale` attribute rescales the
 * INLINE WebGL view, but Android scene-viewer and iOS quick-look load the
 * raw GLB at its authored size and IGNORE that attribute. Tripo/Meshy
 * normalize models to a ~1m bounding box, so on a phone a 2.77m sofa is
 * placed at ~1m — "toy sized". The only fix that reaches AR is changing the
 * GLB's intrinsic size.
 *
 * How: pure GLB-container surgery. We parse the glTF JSON chunk, compute
 * the scene bounding box from each POSITION accessor's declared min/max
 * (these are present even when the mesh data is Draco-compressed — KHR_draco
 * keeps accessor min/max), then multiply every root node's TRS (scale AND
 * translation) by `realMax / bboxMax`. The BINARY chunk — Draco buffers and
 * all — is copied through untouched. No mesh decode, no re-encode: fast,
 * stream-cacheable, and it preserves the original compression/size (so the
 * iOS inline-memory budget is unchanged).
 *
 * Scaling translation as well as scale uniformly scales the whole scene
 * about the origin: worldPoint = T + R·S·v, so (f·T) + R·(f·S)·v =
 * f·(T + R·S·v) = f·worldPoint. Correct for multi-part models too.
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

type GltfJson = {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: { attributes?: Record<string, number> }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
};
type GltfNode = {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
};

type Mat4 = number[]; // column-major, length 16

function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function multiply(a: Mat4, b: Mat4): Mat4 {
  // a · b, both column-major
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}
function fromTRS(t?: number[], q?: number[], s?: number[]): Mat4 {
  const [tx, ty, tz] = t ?? [0, 0, 0];
  const [x, y, z, w] = q ?? [0, 0, 0, 1];
  const [sx, sy, sz] = s ?? [1, 1, 1];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function localMatrix(n: GltfNode): Mat4 {
  if (n.matrix && n.matrix.length === 16) return n.matrix.slice();
  return fromTRS(n.translation, n.rotation, n.scale);
}
function transformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function parseGlb(buf: Buffer): { json: GltfJson; jsonRaw: Buffer; bin: Buffer | null; binHeader: Buffer | null } | null {
  if (buf.length < 12 || buf.readUInt32LE(0) !== GLB_MAGIC) return null;
  let off = 12;
  let json: GltfJson | null = null;
  let jsonRaw: Buffer | null = null;
  let bin: Buffer | null = null;
  let binHeader: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) {
      jsonRaw = Buffer.from(data);
      json = JSON.parse(jsonRaw.toString("utf8"));
    } else if (type === CHUNK_BIN) {
      bin = Buffer.from(data);
      binHeader = Buffer.from(buf.subarray(off, off + 8)); // len+type, padding-preserving
    }
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json || !jsonRaw) return null;
  return { json, jsonRaw, bin, binHeader };
}

/** Bounding box of the default scene in the GLB's own units (meters). */
function sceneBboxMax(json: GltfJson): number | null {
  const sceneIdx = json.scene ?? 0;
  const scene = json.scenes?.[sceneIdx];
  if (!scene?.nodes || !json.nodes) return null;
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let found = false;
  const visit = (idx: number, parent: Mat4) => {
    const node = json.nodes![idx];
    if (!node) return;
    const world = multiply(parent, localMatrix(node));
    if (node.mesh != null) {
      const mesh = json.meshes?.[node.mesh];
      for (const prim of mesh?.primitives ?? []) {
        const accIdx = prim.attributes?.POSITION;
        if (accIdx == null) continue;
        const acc = json.accessors?.[accIdx];
        if (!acc?.min || !acc?.max || acc.min.length < 3) continue;
        const [nx, ny, nz] = acc.min;
        const [xx, xy, xz] = acc.max;
        // 8 corners of the local-space AABB, transformed to world.
        for (const corner of [
          [nx, ny, nz], [xx, ny, nz], [nx, xy, nz], [nx, ny, xz],
          [xx, xy, nz], [xx, ny, xz], [nx, xy, xz], [xx, xy, xz],
        ] as [number, number, number][]) {
          const w = transformPoint(world, corner);
          for (let i = 0; i < 3; i++) {
            if (w[i] < min[i]) min[i] = w[i];
            if (w[i] > max[i]) max[i] = w[i];
          }
          found = true;
        }
      }
    }
    for (const c of node.children ?? []) visit(c, world);
  };
  for (const r of scene.nodes) visit(r, identity());
  if (!found) return null;
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const m = Math.max(...size);
  return Number.isFinite(m) && m > 0 ? m : null;
}

function serializeGlb(json: GltfJson, binHeader: Buffer | null, bin: Buffer | null): Buffer {
  let jsonStr = JSON.stringify(json);
  while (jsonStr.length % 4 !== 0) jsonStr += " "; // pad with spaces
  const jsonBuf = Buffer.from(jsonStr, "utf8");
  const jsonChunk = Buffer.alloc(8 + jsonBuf.length);
  jsonChunk.writeUInt32LE(jsonBuf.length, 0);
  jsonChunk.writeUInt32LE(CHUNK_JSON, 4);
  jsonBuf.copy(jsonChunk, 8);
  const parts: Buffer[] = [jsonChunk];
  if (binHeader && bin) {
    parts.push(binHeader, bin);
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

export type ScaleResult = {
  bytes: Buffer;
  factor: number;
  changed: boolean;
  intrinsicMaxM: number | null;
};

/**
 * Return a GLB whose intrinsic longest axis equals `realMaxMm` millimetres.
 * On any problem (not a GLB, no bbox, factor≈1) returns the original bytes
 * with changed=false — callers serve that untouched (AR stays at intrinsic
 * scale, no worse than before).
 */
export function scaleGlbToRealMeters(buf: Buffer, realMaxMm: number): ScaleResult {
  const fail = (intrinsicMaxM: number | null = null): ScaleResult => ({ bytes: buf, factor: 1, changed: false, intrinsicMaxM });
  if (!realMaxMm || realMaxMm <= 0) return fail();
  const parsed = parseGlb(buf);
  if (!parsed) return fail();
  const intrinsicMaxM = sceneBboxMax(parsed.json);
  if (!intrinsicMaxM) return fail();
  const factor = realMaxMm / 1000 / intrinsicMaxM;
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 0.01) {
    return fail(intrinsicMaxM); // already real-size (within 1%)
  }
  const scaleMat: Mat4 = [factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, factor, 0, 0, 0, 0, 1];
  const sceneIdx = parsed.json.scene ?? 0;
  const roots = parsed.json.scenes?.[sceneIdx]?.nodes ?? [];
  for (const idx of roots) {
    const node = parsed.json.nodes?.[idx];
    if (!node) continue;
    if (node.matrix && node.matrix.length === 16) {
      node.matrix = multiply(scaleMat, node.matrix); // scale subtree about origin
    } else {
      node.scale = (node.scale ?? [1, 1, 1]).map((v) => v * factor);
      node.translation = (node.translation ?? [0, 0, 0]).map((v) => v * factor);
    }
  }
  const out = serializeGlb(parsed.json, parsed.binHeader, parsed.bin);
  return { bytes: out, factor, changed: true, intrinsicMaxM };
}
