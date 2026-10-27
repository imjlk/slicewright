# Real content in a sliced panel

A CSS example with three independent layers: an exported nine-slice frame,
a fixed text-free brooch, and runtime text/buttons in an authored content
region. Resize the panel, switch between English and Korean content, enlarge
the text to 200%, and toggle the cyan content guide. No build, CDN, or image
generator is needed to run the committed example.

From the repository root, serve the files with any static HTTP server, for example:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/examples/content-preview/>.

The PNGs were generated with an agent's image tool outside slicewright. The
panel was normalized to 480 px wide; the separate brooch was cropped and
resized to 180 px wide. Their source prompts are in `assets/prompts.md`.
`guild-panel.css` and `.json` are slicewright exports, not hand-tuned slices.
The local `manifest.json` checks these exports and renders the panel in CSS
and Phaser. CI checks it on its own sheet so the growing real-art collection
does not exceed common WebGL canvas size limits.

## What comes from detection, and what we authored

| Value | Source |
| --- | --- |
| Slice insets: left/right 104, top 108, bottom 111 px | Panel detection |
| Content padding: left/right/bottom 45, top 51 px | Panel detection, encoded by exported CSS `border-width` |
| Art minimum: 208 × 219 px | Sum of fixed slice borders; does not guarantee text fits |
| Total content insets: top 108, sides 54, bottom 111 px | Detected padding plus authored clearance of 57 px top, 9 px sides, 66 px bottom, after visual review |
| Brooch: 160 px wide, centered, bottom 40 px below frame top | Author choice in `assembly.js`; no text area inferred |
| Example width range: 280–720 px | Author choice for this content and font size |
| Height | Natural content flow; no fixed-height text clipping |

## Reuse the assembly

[`assembly.js`](assembly.js) holds the body's dimensions, the ornament's
anchor/origin/offset and draw order, the total content insets, and the action
breakpoint. It is trusted application code, not a slicewright manifest or a
new core API. Copy it with the example's HTML/CSS and call `applyAssembly`
after changing the configuration or the available width.

Anchor and origin are fractions of the body and ornament rectangles. Offsets
are logical pixels after cropping and normalization. On each axis the
ornament starts at `bodySize * anchor + offset - ornamentSize * origin`.
The default uses the body's top center and ornament's bottom center, with a
40 px downward offset. Its width is fixed at 160 px; its height preserves the
PNG's aspect ratio. The 420 px action breakpoint uses the rendered body width
after viewport clamping.

The unpadded wrapper contains three sibling layers: the absolutely positioned
frame, the fixed brooch, and content in normal flow. The content layer applies
the total insets once; the emitted frame's `border-width` stays on the art
layer and is not added to text placement again. Content height grows the
wrapper and frame. The brooch ignores pointer input and has empty alt text
because it is purely decorative. Its image has no implied text region.

Change the placement, text, or font and inspect the assembled result again.
The authored content minimum is separate from the art minimum, and neither
guarantees that arbitrary content fits. These settings do not claim automatic
safe-area detection.

## Browser checks

```sh
pnpm install --frozen-lockfile
pnpm engine:check --engine css
pnpm engine:check --manifest examples/content-preview/manifest.json
# Also save full-page content views for visual review:
pnpm engine:check --manifest examples/content-preview/manifest.json --screenshot /tmp/slicewright.png
```

The engine runner serves this example locally and includes the results in
`contentPreview`. Its original cases cover short, long, and unbroken text at
280, 480, and 720 px requested widths, including a 720 px request clamped to a
mobile viewport. Additional cases exercise long Korean and English at narrow
and wide sizes with 200% text. Glyph rectangles and buttons must fit the
content region, long content must increase the panel height, and the ornament
must keep its authored size and anchor. A changed configuration also checks
that body size, attachment placement, content insets, and responsive rules
drive the rendered geometry.

The checks exercise button activation and decoration input pass-through,
image decoding, and rendered art visibility, including the protrusion above
the body. Negative controls deliberately
clip prose, move the brooch onto content, break its PNG, apply frame padding
twice, intercept a button click, hide a decoded art layer, and clip the
protrusion with `overflow: hidden`. Each injected
failure must be detected. These checks complement the bare-art engine pixel
comparison; inspect the saved screenshots for legibility and artistic fit,
then try the real game's content before shipping.

The original long-English views use `.content-{320,768,1024}.png`. Additional
views use `.content-<viewport>-<scenario>-<scale>.png`; 200% cases also save
`.top.png` and `.actions.png` details beside each full-page view.
