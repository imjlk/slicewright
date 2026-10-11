# slicewright

Prompt, inspect, and preview stretchable game UI art.

Nine-slice (and three-slice) art keeps its corners fixed and stretches its
edges and center. Image models do not hit exact pixel sizes, so slicewright
splits the job: the prompt asks for art that survives stretching, and
inspection finds or checks the exact slice insets afterwards.

- `prompt` turns a UI kind and a style into a structural generation prompt.
- `inspect` detects the stretch spans, or checks insets you give, and reports
  smearing, seams, transparent margins, and chroma spill.
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
node dist/cli.js inspect examples/panel.png
node dist/cli.js preview examples/bar.png --out bar-sheet.png
node dist/cli.js frame examples/panel.png --name panel --out panel.json
node dist/cli.js atlas panel.json
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
tolerance on every row; the longest run of matching columns is the horizontal
stretch span, and rows work the same way. Art whose rows never repeat (a
vertical gradient bar) becomes a three-slice.

## Development

The toolchain is [ttsc](https://ttsc.dev) on TypeScript 7:

- `pnpm check`: type check, `@ttsc/lint`, formatting, and the
  `@ttsc/evidence` graph in one compile.
- `pnpm test`: `node:test` suites run through `ttsx`.
- `pnpm fix` / `pnpm format`: apply lint and format fixes.
- `pnpm build`: emit `dist` with the typia transform.
- `.mcp.json` registers the `@ttsc/graph` MCP server for agents.

Every H2 in `docs/spec.md` is a requirement. The build fails until a source
function and a test function cite it with `@evidence` and an
`@evidenceReview` that says what was checked. See [AGENTS.md](AGENTS.md).

The core is pure TypeScript over RGBA buffers. PNG input and output use
[fast-png](https://github.com/image-js/fast-png), which has no native code.

## Roadmap

- `normalize`: crop margins, resize to a target size, and rebuild a minimal
  nine-slice texture.
- Chroma removal and despill.
- Pattern-period detection for tiled edges.
- Exports for engines other than Phaser.

## License

MIT
