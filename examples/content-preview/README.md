# Real content in a sliced panel

A CSS example with three independent layers: an exported nine-slice frame,
a fixed text-free brooch, and runtime text/buttons in an authored content
region. Resize the panel, switch between short, long, and unbroken text,
and toggle the cyan content guide. No build, CDN, or image generator is needed
to run the committed example.

From the repository root, serve the files with any static HTTP server, for example:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000/examples/content-preview/>.

The PNGs were generated with an agent's image tool outside slicewright. The
panel was normalized to 480 px wide; the separate brooch was cropped and
resized to 180 px wide. Their source prompts are in `assets/prompts.md`.
`guild-panel.css` and `.json` are slicewright exports, not hand-tuned slices.
The `examples/real/manifest.json` entry checks these exports and renders the
panel in CSS and Phaser alongside the other real samples.

## What comes from detection, and what we authored

| Value | Source |
| --- | --- |
| Slice insets: left/right 104, top 108, bottom 111 px | Panel detection |
| Content padding: left/right/bottom 45, top 51 px | Panel detection, encoded by exported CSS `border-width` |
| Art minimum: 208 × 219 px | Sum of fixed slice borders; does not guarantee text fits |
| Content margin: 22 px top, 9 px sides, 18 px bottom | Author choice in `style.css` |
| Brooch: 160 px wide, centered, bottom 40 px below frame top | Author choice in `style.css`; no text area inferred |
| Example width range: 280–720 px | Author choice for this content and font size |
| Height | Natural content flow; no fixed-height text clipping |

The brooch is outside the frame in a positioned wrapper. It remains fixed
while the frame stretches, ignores pointer input, and has empty alt text
because it is purely decorative. The content region belongs to the panel,
not to the brooch. Text wraps, actions stack when necessary, and the panel grows
vertically. These choices need revisiting for another font, language, screen
size, or ornament; the example does not claim automatic safe-area detection.

## Browser checks

```sh
pnpm install --frozen-lockfile
pnpm engine:check --engine css
# Also save full-page long-content views at 320, 768, and 1024 px viewports:
pnpm engine:check --engine css --screenshot /tmp/slicewright.png
```

The existing engine runner serves this example locally and uses the same
Chrome session. Its `contentPreview` report checks short, long, and unbroken
text at 280, 480, and 720 px requested panel widths, including a 720 px request
clamped to a mobile viewport; glyph rectangles and buttons must
fit the content region, the ornament must remain separate and fixed-size,
and long content must increase panel height. The brooch must decode with nonzero
natural dimensions, not merely occupy its authored CSS box. Both buttons must update the
live status without overflow. Negative controls deliberately clip body text
move the brooch onto content, and replace its source with an invalid PNG,
verifying that the checks catch all three errors.
Screenshots are `/tmp/slicewright.content-{320,768,1024}.png`.

These layout checks complement the engine runner's pixel comparison for bare
art. They cannot judge legibility or artistic fit; inspect the screenshots and
try the real game's content before shipping.
