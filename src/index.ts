export { decodePng, encodePng } from './png.js';
export { createRaster, cropRaster } from './raster.js';
export type { Raster, Rect } from './raster.js';

export { defaultChromaOptions, detectChromaKey, removeChroma } from './chroma.js';
export type { ChromaKey, ChromaOptions, ChromaResult } from './chroma.js';

export { resizeRaster, targetSize } from './resize.js';
export type { ResizeFilter } from './resize.js';

export {
  insetsProblem,
  insetsToScale9Borders,
  isThreeSlice,
  parseBorders,
  parseInsets,
  scale9BordersToInsets,
} from './slices.js';
export type { Scale9Borders, SliceInsets, SliceMode } from './slices.js';

export {
  axisFromSpans,
  axisTiles,
  contentLimits,
  flexibleSegments,
  layoutFromInsets,
  layoutInsets,
  layoutShape,
  minimumLayoutSize,
  readLayoutJson,
} from './layout.js';
export type { AxisLayout, LayoutShape, Segment, SegmentKind, SliceLayout } from './layout.js';

export {
  defaultInspectOptions,
  detectLayout,
  inspectRaster,
  verifyGivenLayout,
  verifyLayout,
} from './inspect.js';
export type { Finding, InspectOptions, InspectReport, Severity, TileAxes } from './inspect.js';

export { buildPromptPlan, promptBackgrounds, uiKinds } from './prompt.js';
export type { PromptBackground, PromptPlan, PromptRequest, UiKind } from './prompt.js';
export { correctPromptPlan, promptCorrections, readFindingsReport } from './prompt-corrections.js';
export type { FindingsReport, ReportFinding } from './prompt-corrections.js';

export {
  defaultNormalizeOptions,
  normalizeRaster,
  rebuildLayout,
  rebuildSlices,
} from './normalize.js';
export type { NormalizeOptions, NormalizeResult, NormalizeStep } from './normalize.js';

export {
  defaultPreviewMaxWidth,
  previewCellLabels,
  renderLayout,
  renderPreviewSheet,
  renderSlices,
} from './render.js';
export type {
  PreviewCell,
  PreviewCellLabel,
  PreviewOptions,
  PreviewSheet,
  RenderOptions,
} from './render.js';

export { compareSet, defaultCompareSlack } from './compare.js';
export type {
  CompareKind,
  CompareOptions,
  ComparePiece,
  ComparePieceReport,
  CompareReport,
} from './compare.js';

export { defaultPackOptions, packFrames } from './pack.js';
export type { PackOptions, PackPiece, PackResult, PackedFrame } from './pack.js';
export { PackInputError, buildPack } from './pack-files.js';
export type { PackFilesOptions, PackFilesResult, PackedFile } from './pack-files.js';

export {
  BuildManifestError,
  loadBuildManifest,
  readBuildManifest,
  relativeBuildReport,
  runBuild,
} from './build.js';
export type {
  BuildGroup,
  BuildGroupReport,
  BuildManifest,
  BuildPiece,
  BuildPieceReport,
  BuildReport,
} from './build.js';

export {
  createSingleFrameAtlas,
  frameLayout,
  frameShape,
  inspectAtlas,
  readAtlas,
} from './phaser.js';
export type {
  AtlasFrameReport,
  AtlasReport,
  PhaserAtlas,
  PhaserAtlasFrame,
  PhaserFrameRect,
  SlicewrightFrameData,
} from './phaser.js';

export { inspectAsepriteSlices, isAsepriteSheet } from './aseprite.js';
export type { AsepriteReport, AsepriteSheet, AsepriteSlice } from './aseprite.js';

export { capabilityFindings, exportForTarget, findTarget, sliceTargets } from './targets/index.js';
export type {
  ExportFile,
  ExportInput,
  ExportResult,
  SliceTarget,
  TargetCapabilities,
} from './targets/index.js';
