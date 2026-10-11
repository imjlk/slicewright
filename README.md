# slicewright

Prompt, inspect, and preview stretchable game UI art.

Nine-slice (and three-slice) art keeps its corners fixed and stretches its
edges and center. Image models do not hit exact pixel sizes, so slicewright
splits the job: the prompt asks for art that survives stretching, and
inspection finds or checks the exact slice insets afterwards.

- `prompt` turns a UI kind and a style into a structural generation prompt.
- `key` removes a green or magenta background and despills the edge.
- `resize` resizes with premultiplied area averaging, or nearest for pixel art.
- `normalize` crops, resizes to the in-game size, picks insets there, can
  rebuild a smaller texture, and writes a one-frame atlas.
- `inspect` detects the stretch spans, or checks insets you give, and reports
  smearing, repeating edges, seams, noise, alpha holes, margins, and spill. It
  also finds the content padding: where text fits inside the frame.
- `preview` renders the art at several stretched sizes on one PNG.
- `export` writes engine files for Phaser and CSS `border-image`; `targets`
  lists what each can represent.
- `frame` writes a one-frame Phaser JSON Hash atlas with `scale9Borders`.
- `atlas` checks every nine-slice frame of a Phaser JSON Hash or JSON Array
  atlas against its pixels.
- `pack` packs several atlases, such as a matching dialog, button, and bar,
  into one image and atlas, with an optional combined stylesheet.

slicewright does not generate images. Pair it with any image generator; the
agent skill in [`skills/slicewright`](skills/slicewright/SKILL.md) describes
the full loop.

## Use

```bash
pnpm install
pnpm build
node dist/cli.js prompt --kind panel --style "hand-painted fantasy wood"
node dist/cli.js key generated.png --out keyed.png
node dist/cli.js normalize keyed.png --width 480 --out ui/panel.png --name panel --target phaser,css
node dist/cli.js preview ui/panel.png --out panel-sheet.png
node dist/cli.js atlas ui/panel.json
node dist/cli.js pack ui/panel.json ui/button.json --out ui/ui.png --css
```

Run `node dist/cli.js --help` for every option. The package is not on npm yet.

### Agent skill

Link the skill into your agent's skill directory:

```bash
ln -s "$PWD/skills/slicewright" ~/.claude/skills/slicewright
```

```bash
ln -s "$PWD/skills/slicewright" ~/.codex/skills/slicewright
```

### Phaser 4

```ts
this.load.atlas('ui', 'ui.png', 'ui.json');
this.add.nineslice(400, 300, 'ui', 'panel', 320, 200);
```

Phaser reads the frame's `scale9Borders`, so scenes never hard-code insets.
Keep nine-slice frames untrimmed.

## Layouts and targets

Every result is an engine-neutral layout: each axis is a list of fixed,
stretched, and tiled segments.

| Layout | Meaning | How to get it |
| --- | --- | --- |
| Nine-slice | Corners fixed; edges and center stretch | default |
| Three-slice | Ends fixed; stretches horizontally; height fixed | `--mode three`, or rows that never repeat |
| Vertical three-slice | Ends fixed; stretches vertically; width fixed | `--mode three-vertical`, or columns that never repeat |
| Tiled axis | A span repeats instead of stretching | `--tile x/y/xy`, or edges that repeat a pattern |
| Multiple regions | Several stretch spans per axis around fixed detail | `--regions multi` (preview only; no target exports it yet) |

| Target | Nine | Three | Vertical three | Multi | Tiling |
| --- | --- | --- | --- | --- | --- |
| `phaser` | ✓ | ✓ | emulated | ✗ | per axis |
| `css` | ✓ | ✓ | ✓ | ✗ | per axis, nearest tile count |

Emulated means zero insets on the fixed axis; keep that axis at its size.

**Content padding** is separate from the insets: an ornate frame's corners can
reach far past its border, so text may start much closer to the edge than the
stretch spans do. It is detected from the frame's inner edge (or given with
`--padding l,r,t,b`), stored in the Phaser frame as
`customData.slicewright.contentPadding`, and written to CSS as `border-width`
while `border-image-width` keeps the art at its slices.
Anything a target cannot represent is reported instead of exported.

### Engine support

slicewright targets **Phaser 4**, with CSS `border-image` alongside it for DOM
UI; both are rendered in the real engine by `pnpm engine:check`. Other engines
(Godot, Unity, Android nine-patch, Defold, GameMaker, Cocos, Pixi.js, Bevy, and
so on) are **not supported**, and none is planned for now.

**Pull requests are welcome** for new targets, ideally with a way to render the
output in that engine. [`docs/extending.md`](docs/extending.md) explains how
to add a target or a layout feature; a target starts as `experimental` until
the engine check renders it.

## How it decides

The behavior contract is [`docs/spec.md`](docs/spec.md). In short: two
adjacent columns match when their premultiplied pixels differ by at most the
tolerance; the longest run of matching columns is the horizontal stretch span,
and rows work the same way. Generated art is noisy, so each axis measures its
interior noise floor and raises its tolerance to match. Edges that repeat a
pattern tile instead of stretching; edges with non-repeating detail are
reported rather than guessed.

The samples in [`examples/real`](examples/real) are real model output and are
checked in real renderers:

```bash
pnpm engine:check
```

renders every sample as a Phaser 4 NineSlice and as its exported CSS
`border-image` in headless Chrome. It checks the sizes and insets Phaser read,
compares every Phaser and CSS render with slicewright's own renderer, compares
rebuilt textures with their sources, and checks that the tiling the Phaser
usage passes matches what detection finds (a tiled rope sample covers it).

## Development

The toolchain is [ttsc](https://ttsc.dev) on TypeScript 7:

- `pnpm check`: type check, `@ttsc/lint`, formatting, and the
  `@ttsc/evidence` graph in one compile.
- `pnpm test`: `node:test` suites run through `ttsx`.
- `pnpm fix` / `pnpm format`: apply lint and format fixes.
- `pnpm build`: emit `dist` with the typia transform.
- `pnpm engine:check`: render `examples/real` in Phaser 4 and CSS (needs
  Chrome; `SLICEWRIGHT_CHROME_CHANNEL` picks another Playwright channel).
- `.mcp.json` registers the `@ttsc/graph` MCP server for agents.

Every H2 in `docs/spec.md` is a requirement. The build fails until a source
function and a test function cite it with `@evidence` and an
`@evidenceReview` that says what was checked, fingerprinted so it expires when
the section changes. See [AGENTS.md](AGENTS.md).

The CLI is built on [gunshi](https://gunshi.dev).

The core is pure TypeScript over RGBA buffers. PNG input and output use
[fast-png](https://github.com/image-js/fast-png), which has no native code.

## Roadmap

- Approximate-period tiling for hand-drawn patterned edges.
- A first npm release once the detection settles.

## License

MIT
