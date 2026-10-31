# Build manifests

`slicewright build ui.build.json` normalizes every piece, compares state
groups, exports each piece's targets, and packs everything into one atlas.
Paths are relative to the manifest. Add `--watch` to rebuild when the manifest
or a piece changes. A refused manifest lists every problem with its path and,
for a misspelled key or value, the closest allowed one; fix them all before
rerunning.

```json
{
  "out": "ui/ui.png",
  "css": true,
  "pieces": [
    { "input": "art/dialog.png", "name": "dialog", "width": 320 },
    { "input": "art/bar.png", "name": "bar", "width": 200, "mode": "three" },
    { "input": "ui/btn-normal.png", "name": "btn-normal" },
    { "input": "ui/btn-hover.png", "name": "btn-hover" },
    { "input": "ui/btn-pressed.png", "name": "btn-pressed" }
  ],
  "groups": [
    { "name": "button", "sharedInsets": true, "pieces": ["btn-normal", "btn-hover", "btn-pressed"] }
  ]
}
```

## Top level

| Field | Meaning |
| --- | --- |
| `$schema` | Optional; points editors at the published JSON Schema (`./node_modules/slicewright/schema/build-manifest.schema.json`). The build ignores it. |
| `out` | Packed PNG (required); its atlas JSON goes next to it. |
| `name` | Texture key and file name of the atlas and stylesheet; defaults to the PNG name. |
| `piecesDir` | Where normalized pieces go; defaults to `pieces` beside `out`. |
| `css` | Also write one stylesheet with a class per piece. |
| `spacing`, `extrude` | As `pack --spacing` / `--extrude` (0 to 64). |
| `pieces` | At least one piece (below). |
| `groups` | State groups (below). |

## Pieces

Each piece takes `input` (required) and the `normalize` options in camel case:
`name` (frame name, defaults to the file name), `width`, `height`, `scale`,
`filter` (`area` or `nearest`), `crop` (true by default), `keep`, `insets` and
`padding` (as `l,r,t,b`, `h,v`, or `n`), `mode`, `regions`, `tile`
(`x`, `y`, `xy`), `tolerance`, `outlierRatio`, `noise`, and `targets` (a list,
such as `["phaser", "css"]`). Repeat `"mode": "three"` for a bar here as on
the command line.

## Groups

A group lists the states of one element that swap in place (normal, hover,
pressed). `pieces` is a list of piece **names**, at least two, and each piece
belongs to at most one group. `slack` is the allowed inset or padding
difference in pixels (1 by default).

- Grouped pieces give no `insets`, `padding`, or `"regions": "multi"`: states
  are compared by their detected single-region geometry.
- After normalizing, the states are compared like `compare`; a mismatch
  (`compare.*`, `build.group-layout`) fails the build and nothing is packed.
- With `"sharedInsets": true`, every state is normalized again with the
  largest inset on each side, and that is what gets packed. Members of such a
  group give no `width`, `height`, or `scale` (a usage error otherwise),
  because the shared insets are measured on pixels a resize would shift.
  Normalize each state to its final size first (`slicewright normalize
  art/btn-normal.png --width 160 --out ui/btn-normal.png`, the same width for
  every state) and point the pieces at those PNGs. A state that then has an
  error adds `build.group-shared-insets`; states that end up different sizes
  add `build.group-size`.

The report lists each group's pieces, shared insets, whether they were
applied, and findings. Save the printed JSON (`slicewright build ui.build.json > build-report.json`) and feed a failing piece back into the generator with
`slicewright prompt --kind button --style "<style>" --from build-report.json
--piece btn-hover`.
