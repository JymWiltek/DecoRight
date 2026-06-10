"use client";

import { useEffect, useRef } from "react";

type ModelViewerElement = HTMLElement & {
  model?: {
    materials: Array<{
      pbrMetallicRoughness: {
        setBaseColorFactor: (rgba: [number, number, number, number]) => void;
      };
    }>;
  };
  /** Wave 9 — model-viewer 4.x exposes the loaded model's bbox via
   *  this method. Returns a Vector3 in METERS (the gltf default unit
   *  is meters). Used to compute the real-world scale factor against
   *  the operator-entered dimensions_mm. */
  getDimensions?: () => { x: number; y: number; z: number } | null;
};

type Props = {
  src: string;
  alt: string;
  iosSrc?: string | null;
  poster?: string | null;
  overrideColorHex?: string | null;
  /** Wave 9 — real product dimensions in mm. When provided AND the
   *  model exposes an intrinsic bbox post-load, we apply a uniform
   *  `scale` attribute so AR placement matches true size. NULL =
   *  render at the GLB's intrinsic scale (correct fallback for
   *  legacy products that never had real dimensions entered).
   *
   *  Uniform scale (not per-axis) is the POC Round 4 evidence-based
   *  choice: AI-generated models preserve product proportions, so
   *  matching the longest axis gets all three within 1-2% of real
   *  without risking misaligned axes if the model exporter used a
   *  different up/forward convention than we expect. Future
   *  improvement: per-axis scale once we trust the orientation
   *  convention across all our model sources. */
  realDimensionsMm?: {
    length?: number;
    width?: number;
    height?: number;
  } | null;
};

function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b, 1];
}

export default function ModelViewer({
  src,
  alt,
  iosSrc,
  poster,
  overrideColorHex,
  realDimensionsMm,
}: Props) {
  const ref = useRef<ModelViewerElement | null>(null);
  const loadedRef = useRef(false);

  // Serialize realDimensionsMm so the useEffect dep array can
  // statically compare its identity. Avoids the
  // react-hooks/exhaustive-deps "complex expression in deps" warning
  // while still skipping re-runs when the underlying numbers don't
  // change. Same shape on every render (server-component object).
  const dimsKey = realDimensionsMm ? JSON.stringify(realDimensionsMm) : null;

  useEffect(() => {
    let cancelled = false;
    import("@google/model-viewer").catch((e) => {
      console.error("Failed to load <model-viewer>:", e);
    });
    const el = ref.current;
    if (!el) return;
    const onLoad = () => {
      if (cancelled) return;
      loadedRef.current = true;
      applyRealScale();
      applyColor();
    };
    /**
     * Wave 9 — uniform real-world rescale. We read the model's
     * intrinsic bbox via the `getDimensions()` API exposed on
     * <model-viewer>, find the longest axis on both the model and
     * the operator-entered real dimensions, and apply a uniform
     * scale factor so the longest axes match. Other axes inherit
     * the same factor; since AI-generated models preserve product
     * proportions, this lands within 1-2% of real on every axis.
     *
     * If anything is missing (no realDimensionsMm, no getDimensions
     * API on the element, zero-length axes), the function is a
     * no-op and the model renders at its intrinsic scale — correct
     * fallback for legacy products without dimensions entered.
     */
    const applyRealScale = () => {
      if (!realDimensionsMm) return;
      const realMaxMm = Math.max(
        realDimensionsMm.length ?? 0,
        realDimensionsMm.width ?? 0,
        realDimensionsMm.height ?? 0,
      );
      if (realMaxMm <= 0) return;
      const dims = el.getDimensions?.();
      if (!dims) return;
      const bboxMaxM = Math.max(dims.x, dims.y, dims.z);
      if (!Number.isFinite(bboxMaxM) || bboxMaxM <= 0) return;
      const scale = realMaxMm / 1000 / bboxMaxM;
      if (!Number.isFinite(scale) || scale <= 0) return;
      el.setAttribute("scale", `${scale} ${scale} ${scale}`);
    };
    const applyColor = () => {
      if (!overrideColorHex) return;
      const mats = el.model?.materials;
      if (!mats || mats.length === 0) return;
      try {
        mats[0].pbrMetallicRoughness.setBaseColorFactor(hexToRgba(overrideColorHex));
      } catch (e) {
        console.warn("setBaseColorFactor failed:", e);
      }
    };
    el.addEventListener("load", onLoad);
    if (loadedRef.current) {
      applyRealScale();
      applyColor();
    }
    return () => {
      cancelled = true;
      el.removeEventListener("load", onLoad);
    };
    // The serialized form of realDimensionsMm is the dep — extracting
    // to `dimsKey` outside the array satisfies
    // react-hooks/exhaustive-deps "no complex expression" rule. The
    // server-component prop is a stable object literal, but
    // ProductDetail re-renders re-run this effect without dimsKey
    // gating; the serialized check skips re-runs that don't change
    // the value. realDimensionsMm itself is read inside applyRealScale
    // via closure — the lint exception is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideColorHex, src, dimsKey]);

  const Tag = "model-viewer" as unknown as "div";
  const extra: Record<string, unknown> = {
    src,
    alt,
    ar: true,
    "ar-modes": "scene-viewer webxr quick-look",
    "camera-controls": true,
    "touch-action": "pan-y",
    "shadow-intensity": "1",
    "environment-image": "neutral",
    "auto-rotate": true,
    loading: "eager",
    reveal: "auto",
  };
  if (iosSrc) extra["ios-src"] = iosSrc;
  if (poster) extra["poster"] = poster;

  return (
    <Tag
      ref={ref as unknown as React.RefObject<HTMLDivElement>}
      style={{ width: "100%", height: "100%", backgroundColor: "#f5f5f5" }}
      {...extra}
    />
  );
}
