// Asset & render pipeline: see docs/ART.md. One entry point for a match's graphics.
export { preloadMatch, LOAD_LIMITS, type PreloadOptions, type PreloadResult, type LateKind } from './preloader';
export { buildManifest, validateManifest, checkManifestOnce, idsOf, type AssetEntry, type AssetIssue } from './manifest';
export { placeholderAtlas, paintChecker } from './placeholder';
export { MAX_CANVAS_AREA, layoutAtlas } from './layout';
