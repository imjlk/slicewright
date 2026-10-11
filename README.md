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
  smearing, repeating edges, seams, noise, alpha holes, margins, and spill.
- `preview` renders the art at several stretched sizes on one PNG.
- `frame` writes a one-frame Phaser JSON Hash atlas with `scale9Borders`.
- `atlas` checks every nine-slice frame of a Phaser JSON Hash or JSON Array
  atlas against its pixels.

slicewright does not generate images. Pair it with any image generator; the
agent skill in [`skills/slicewright`](skills/slicewright/SKILL.md) describes
the full loop.

## Use

```bash
pnpm install
pnpm build
node dist/cli.js prompt --kind panel --style "hand-painted fantasy wood"
node dist/cli.js key generated.png --out keyed.png
node dist/cli.js normalize keyed.png --width 480 --out ui/panel.png --atlas ui/panel.json --name panel
node dist/cli.js preview ui/panel.png --out panel-sheet.png
node dist/cli.js atlas ui/panel.json
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

## How it decides

The behavior contract is [`docs/spec.md`](docs/spec.md). In short: two
adjacent columns match when their premultiplied pixels differ by at most the
tolerance; the longest run of matching columns is the horizontal stretch span,
and rows work the same way. Generated art is noisy, so each axis measures its
interior noise floor and raises its tolerance to match. Edges that repeat a
pattern tile instead of stretching; edges with non-repeating detail are
reported rather than guessed. Art whose rows never repeat (a banded bar)
becomes a three-slice.

The samples in [`examples/real`](examples/real) are real model output and are
checked in Phaser 4 itself:

```bash
pnpm phaser:check
```

renders every sample as a NineSlice in headless Chrome (WebGL through
SwiftShader), checks the rendered sizes and the insets Phaser read, and compares
rebuilt textures with their sources pixel for pixel.

## Development

The toolchain is [ttsc](https://ttsc.dev) on TypeScript 7:

- `pnpm check`: type check, `@ttsc/lint`, formatting, and the
  `@ttsc/evidence` graph in one compile.
- `pnpm test`: `node:test` suites run through `ttsx`.
- `pnpm fix` / `pnpm format`: apply lint and format fixes.
- `pnpm build`: emit `dist` with the typia transform.
- `pnpm phaser:check`: render `examples/real` in Phaser 4 (needs Chrome;
  `SLICEWRIGHT_CHROME_CHANNEL` picks another Playwright channel).
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
- Exports for engines other than Phaser.
- A first npm release once the detection settles.

## License

MIT
