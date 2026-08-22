"use client";

import type { CSSProperties } from "react";
import type { ForensicWatermarkLayerProps } from "./types";

/**
 * A visual carrier only. It is inert by construction and remains unchanged after
 * initial render so it cannot affect interaction, scrolling, or battery usage.
 */
export function ForensicWatermarkLayer({
  tileUrl,
  routeScope,
  opacity = 0.16,
  className,
}: ForensicWatermarkLayerProps) {
  const style: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483000,
    pointerEvents: "none",
    userSelect: "none",
    backgroundImage: `url("${tileUrl}")`,
    backgroundRepeat: "repeat",
    backgroundSize: "256px 256px",
    mixBlendMode: "soft-light",
    opacity,
  };
  return <div aria-hidden="true" className={className} data-route-scope={routeScope} style={style} />;
}
