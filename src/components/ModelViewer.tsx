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
};

type Props = {
  src: string;
  alt: string;
  iosSrc?: string | null;
  poster?: string | null;
  overrideColorHex?: string | null;
};

function hexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return [r, g, b, 1];
}

export default function ModelViewer({ src, alt, iosSrc, poster, overrideColorHex }: Props) {
  const ref = useRef<ModelViewerElement | null>(null);
  const loadedRef = useRef(false);

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
      applyColor();
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
    if (loadedRef.current) applyColor();
    return () => {
      cancelled = true;
      el.removeEventListener("load", onLoad);
    };
  }, [overrideColorHex, src]);

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
