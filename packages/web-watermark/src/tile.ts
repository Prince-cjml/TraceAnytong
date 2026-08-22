import type { ScreenTileOptions } from "./types";

/** A deterministic non-cryptographic PRNG for preview/fixture tile generation.
 * Production tile issuance is worker-side and uses HMAC-SHA256 profile keys. */
function seededRandom(input: string) {
  let state = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    state ^= input.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createScreenTile(options: ScreenTileOptions): ImageData {
  const size = options.size ?? 256;
  const strength = options.strength ?? 0.12;
  const random = seededRandom(`${options.traceHandle}:${options.profileVersion}:${options.scope}`);
  const tile = new ImageData(size, size);
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    const offset = pixel * 4;
    const field = Math.round(128 + (random() - 0.5) * 80);
    // low-amplitude monochrome field; alpha is deliberately sparse for readable pages
    tile.data[offset] = field;
    tile.data[offset + 1] = field;
    tile.data[offset + 2] = field;
    tile.data[offset + 3] = Math.round(255 * strength);
  }
  return tile;
}

export function tileDataUrl(options: ScreenTileOptions): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  const image = createScreenTile(options);
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}
