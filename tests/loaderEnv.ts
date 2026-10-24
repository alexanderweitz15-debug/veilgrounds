// Test helper: the sprite renderer (src/render/champions) builds Path2D objects while its module graph loads, which
// node does not have. Stub just enough that the pure parts (kits, frame counts, atlas layout) can be imported.
// Import this file BEFORE anything from src/render/champions.
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.Path2D === 'undefined') {
  g.Path2D = class {
    rect(): void {}
    addPath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    closePath(): void {}
    arc(): void {}
    ellipse(): void {}
  };
}
if (typeof g.DOMMatrix === 'undefined') {
  g.DOMMatrix = class {
    translate(): this {
      return this;
    }
  };
}
export {};
