// Custom mouse cursors (CSS `cursor` values). SVG data URIs: no image files, crisp at any DPI.

/** LoL-like attack cursor over anything hostile: a red sword pointing up-left, hotspot at the tip. */
const SWORD =
  "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>" +
  "<g stroke='#1a0f08' stroke-width='1.6' stroke-linejoin='round'>" +
  "<path d='M1 1 L9 2.5 L22.5 16 L16 22.5 L2.5 9 Z' fill='#ff5a3c'/>" +
  "<path d='M13.5 25 L25 13.5 L27.5 16 L16 27.5 Z' fill='#e2b65a'/>" +
  "<path d='M21 23.5 L23.5 21 L30 27.5 L27.5 30 Z' fill='#6b3420'/>" +
  '</g>' +
  "<path d='M4 4 L19 19' stroke='#ffd9cf' stroke-width='1.3' stroke-linecap='round'/>" +
  '</svg>';

export const ATTACK_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(SWORD)}") 1 1, crosshair`;
