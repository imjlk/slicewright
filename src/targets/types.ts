import type { Finding } from '../inspect.js';
import type { LayoutShape, SliceLayout } from '../layout.js';
import type { Raster } from '../raster.js';

/** What a target can represent, declared once so every gap is reported the same way. */
export interface TargetCapabilities {
  /** Shapes the target represents natively. */
  readonly shapes: readonly LayoutShape[];
  /**
   * Shapes it can only emulate: the fixed axis is exported with zero insets,
   * so the engine would stretch it, and the caller must keep that axis at its
   * source size.
   */
  readonly emulated: readonly LayoutShape[];
  /** Tiling per axis, only both axes together, or not at all. */
  readonly tile: 'per-axis' | 'both' | 'none';
}

export interface ExportInput {
  /** Name for the exported asset, used in file names and identifiers. */
  readonly name: string;
  /** The image as the exported files should reference it. */
  readonly imageRef: string;
  readonly raster: Raster;
  readonly layout: SliceLayout;
}

export interface ExportFile {
  /** File name, relative to the output directory. */
  readonly path: string;
  readonly contents: string | Uint8Array;
}

export interface ExportResult {
  readonly target: string;
  readonly files: readonly ExportFile[];
  /** How to use the files in the engine. */
  readonly usage: string;
  readonly findings: readonly Finding[];
}

export interface SliceTarget {
  readonly id: string;
  readonly label: string;
  readonly capabilities: TargetCapabilities;
  /** Writes the target's files; only called for layouts the capabilities accept. */
  readonly exportLayout: (input: ExportInput) => Omit<ExportResult, 'target' | 'findings'>;
}
