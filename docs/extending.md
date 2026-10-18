# Extending slicewright

slicewright separates three things so each can grow on its own:

1. **Detection** turns pixels into a layout (`src/detect.ts`, `src/inspect.ts`).
2. **The layout** (`src/layout.ts`) is engine-neutral: each axis is a list of
   `fixed`, `stretch`, and `tile` segments. Nine-slice, three-slice, vertical
   three-slice, tiling, and multiple stretch regions are all just layouts.
3. **Targets** (`src/targets/`) turn a layout into one engine's files.

The preview renderer (`renderLayout`) and every target read only the layout,
so a new detection feature reaches every target, and a new target supports
every layout it declares.

## Add a target

1. Create `src/targets/<id>.ts` with a `SliceTarget`:
   - `capabilities.shapes`: layouts the engine represents natively
     (`nine`, `three`, `three-vertical`, `multi`).
   - `capabilities.emulated`: shapes it can only show with zero insets on the
     fixed axis while the caller keeps that axis at its size.
   - `capabilities.tile`: `per-axis`, `both`, or `none`.
   - `capabilities.tileCount`: `floor` if the engine rounds the tile count
     down like the layout, `round` if it takes the nearest count.
   - `status`: `experimental` until the engine itself renders the output in
     `pnpm engine:check`; then `verified`.
   - `outputs(name)`: every file name the export may write, relative to its
     output directory (for example, `(name) => [`${name}.tres`]`), or `[]`
     when it only returns usage text. Builds use this declaration to reject
     path collisions before writing; keep it in sync with `exportLayout`.
   - `exportLayout`: an exported function returning files and usage text.
     It only receives layouts the capabilities accept; `capabilityFindings`
     reports everything else.
2. Register it in `src/targets/index.ts`.
3. Add an H2 to `docs/spec.md` describing the file format, cite it from the
   export function and from a test that decodes or parses the output.
4. When the engine can run in a browser, add a page under `examples/` and a
   check in `tools/engine-check.ts` that compares it with `renderLayout`.

## Add a layout feature

1. Describe it in `docs/spec.md` first.
2. Produce it as a `SliceLayout` from detection (or from given insets in
   `verifyLayout`), and give it a `LayoutShape` if it is a new shape.
3. Declare it in the capabilities of every target that can represent it; the
   rest report `target.unsupported` without further work.
4. Make sure `renderLayout` and `renderPreviewSheet` render it, then check a
   real generated sample with `pnpm engine:check`.

## Verify against real art

Fixtures prove the rules; generated art proves the defaults. Keep a sample in
`examples/real` for each new feature, with its prompt under `prompts/`, and
run `pnpm engine:check` before and after detection changes.
