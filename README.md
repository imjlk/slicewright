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
- `preview` renders the art at several stretched sizes on one PNG; pick
  cells with `--cells` and enlarge small art with `--zoom`.
- `export` writes engine files for Phaser and CSS `border-image`, and
  experimental values for Unity, Defold, and Godot 4; `targets` lists what each
  can represent and whether it is verified.
- `frame` writes a one-frame Phaser JSON Hash atlas with `scale9Borders`.
- `atlas` checks every nine-slice frame of a Phaser JSON Hash or JSON Array
  atlas against its pixels.
- `pack` packs several atlases, such as a matching dialog, button, and bar,
  into one image and atlas, with an optional combined stylesheet.

slicewright does not generate images. Pair it with any image generator; the
agent skill in [`skills/slicewright`](skills/slicewright/SKILL.md) describes
the full loop.

## Use

Node 24 or newer.

```bash
npx slicewright prompt --kind panel --style "hand-painted fantasy wood"
npx slicewright key generated.png --out keyed.png
npx slicewright normalize keyed.png --width 480 --out ui/panel.png --name panel --target phaser,css
npx slicewright preview ui/panel.png --out panel-sheet.png
npx slicewright atlas ui/panel.json
npx slicewright pack ui/panel.json ui/button.json --out ui/ui.png --css
```

Run `npx slicewright --help` for every option. Install it in a project with
`npm install --save-dev slicewright` to pin the version; the same functions are
importable as a library (`import { inspectRaster } from 'slicewright'`).

From a clone, `pnpm install && pnpm build`, then `node dist/cli.js`.

### Agent skill

slicewright ships an [Agent Skills](https://agentskills.io) skill in
[`skills/slicewright`](skills/slicewright/SKILL.md). The skill runs the CLI
through `npx`, so it needs Node 24 or newer but no npm install of its own.

**Any agent**, with the [`skills`](https://github.com/vercel-labs/skills) CLI
(Node 22.20 or newer). It installs into `.agents/skills/`, which Codex, Cursor,
GitHub Copilot, Gemini CLI, OpenCode, Cline, Amp, and other agents read, links
it for Claude Code, and supports [79 agent targets](https://github.com/vercel-labs/skills#supported-agents):

```bash
npx skills add imjlk/slicewright                    # this project, detected agents
npx skills add imjlk/slicewright -g                 # every project (user scope)
npx skills add imjlk/slicewright -a claude-code -a codex -a cursor -y
npx skills add imjlk/slicewright --agent '*' -y     # every supported agent
npx skills update slicewright                       # later, to update
```

`--agent '*'` skips agents whose skill directory does not exist in the project
yet; `--all` is short for `--skill '*' --agent '*' -y`.

**Claude Code plugin**, from this repository's marketplace:

```text
/plugin marketplace add imjlk/slicewright
/plugin install slicewright@slicewright
```

On Claude Code 2.1.275 or newer, one step also works:
`/plugin install slicewright --marketplace imjlk/slicewright`.

**Manual:** copy or link the folder into your agent's skill directory. Create
the directory first; `ln -sfn` replaces an older link instead of nesting one.

```bash
git clone https://github.com/imjlk/slicewright ~/.local/share/slicewright
mkdir -p ~/.claude/skills ~/.agents/skills
ln -sfn ~/.local/share/slicewright/skills/slicewright ~/.claude/skills/slicewright  # Claude Code
ln -sfn ~/.local/share/slicewright/skills/slicewright ~/.agents/skills/slicewright  # Codex, Cursor, …
```

A project that installed the package can link
`"$PWD/node_modules/slicewright/skills/slicewright"` the same way; the link
breaks when `node_modules` is removed.

| Agent | User scope | Project scope |
| --- | --- | --- |
| [Claude Code](https://code.claude.com/docs/en/skills) | `~/.claude/skills/` | `.claude/skills/` |
| [Codex](https://developers.openai.com/codex/skills) | `~/.agents/skills/` | `.agents/skills/` |
| [Cursor](https://cursor.com/docs/context/skills) | `~/.cursor/skills/`, `~/.agents/skills/` | `.cursor/skills/`, `.agents/skills/` |

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
| `unity` (experimental) | ✓ | emulated | emulated | ✗ | both axes, last tile clipped |
| `defold` (experimental) | ✓ | emulated | emulated | ✗ | ✗ |
| `godot` (experimental) | ✓ | emulated | emulated | ✗ | per axis, tile fit |

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
UI; both are rendered in the real engine by `pnpm engine:check`.

**Experimental**: `unity`, `defold`, and `godot` follow each engine's
documented format but are not run in the engine yet, and every export says so
with a `target.experimental` finding.

- `unity` prints `TextureImporter.spriteBorder` in Unity's order
  (`x = left, y = bottom, z = right, w = top`) with an editor-script line. It
  writes no file and never edits `.meta` files.
- `defold` prints `slice9` (left, top, right, bottom) for a sprite or GUI box
  node.
- `godot` writes a Godot 4 `StyleBoxTexture` `.tres` and prints the matching
  `NinePatchRect` properties. Pass `--image-ref res://…` so the texture path
  matches the project.

Other engines (Android nine-patch, GameMaker, Cocos, Pixi.js, Bevy, and so on)
are **not supported**.

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
- Settle the detection toward a 1.0; until then, 0.x releases on
  [npm](https://www.npmjs.com/package/slicewright) may change behavior.

## License

MIT
