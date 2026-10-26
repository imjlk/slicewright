# Layered UI

Use separate pieces when a panel must resize while a crest, ribbon, or other
attached detail keeps its shape. This extends the existing
[body and tail](speech-bubbles.md) and [track and fill](progress-bars.md)
workflows. An ordinary single-piece button or panel can use the main workflow.

## Plan the pieces

| Piece | Resizing | Content |
| --- | --- | --- |
| Body | Nine-slice or three-slice | Runtime text and controls use its content box |
| Ornament | Fixed size, or uniform scaling | No text region unless explicitly specified |
| Text and controls | Runtime layout and wrapping | Actual strings, fonts, and interaction states |

Keep readable text out of generated art. A light patch, blank ribbon, or
transparent hole does not establish a safe text region. If text must sit
inside an ornament, specify its rectangle in that ornament's local coordinates
and check it with the intended font and strings. Record a visually chosen
rectangle as authored, not detected. Otherwise put the text in the body's
content box and use the ornament only as decoration.

Alongside the component code, record enough placement information to reproduce
the composition:

- The body rectangle and which layer each attachment follows.
- The anchor on that rectangle, the attached image's origin, and its offset.
- The rendered size, resize rule, and draw order of each piece.
- Content insets or rectangles, including any margin added for inward-reaching
  corner art or attached decorations.

Use logical pixels after cropping and normalization, before a shared container
transform. Cropping changes the image origin, so choose offsets against the
finished pieces. Keep detected slice insets and padding linked to their CLI
report; identify placement offsets and extra content margins as authored.
Mark a composition verified only for the sizes, strings, and target actually
rendered. This is component design information, not a new slicewright manifest
format or a capability of `SliceLayout`.

## Make and check the pieces

Generate the body with the normal `prompt` workflow, without the attached
ornament. Generate the ornament separately, using the finished body as a style
reference when the generator accepts one. Ask for the same material and line
weight, a transparent background, and no text or text-bearing plaque unless
the brief calls for one. There is no `ornament` prompt kind; describe this
fixed sprite directly to the agent's image generator.

```bash
slicewright normalize art/panel.png --width 480 --name ui-panel --target phaser,css --out ui/panel.png
slicewright resize art/crest.png --crop --width 160 --out ui/crest.png
slicewright pack ui/ui-panel.json ui/crest.png --out ui/ui.png
```

Use the body's findings and stretched preview to check its slices. Inspect the
ornament as a fixed image at its rendered size; it does not need a stretch span.
`pack` accepts its PNG as a plain frame named `crest`. Packing stores the
textures and body borders, not attachment positions or text layout. CSS can
keep using the body's emitted stylesheet and the separate ornament PNG.

## Record the assembly

Keep the placement choices in trusted application code, beside the component.
For example, the repository's
[content preview](https://github.com/imjlk/slicewright/tree/main/examples/content-preview)
uses a configuration like this:

```js
const assembly = {
  body: { width: 480, minWidth: 280, maxWidth: 720, minHeight: 219, z: 0 },
  ornament: {
    width: 160,
    anchor: { x: 0.5, y: 0 },
    origin: { x: 0.5, y: 1 },
    offset: { x: 0, y: 40 },
    z: 1,
  },
  content: { insets: { top: 108, right: 54, bottom: 111, left: 54 }, z: 2 },
  breakpoints: [{ maxBodyWidth: 420, actions: 'stack' }],
};
```

These values belong to that art and content. `anchor` is a fraction of the body
rectangle, `origin` is a fraction of the ornament's own rectangle, and `offset`
is in logical pixels. Thus the ornament's top-left position is
`bodySize * anchor + offset - ornamentSize * origin` on each axis. Draw order
is explicit through `z`. Preserve the ornament's aspect ratio when setting its
width. Resolve breakpoints against the rendered body width after viewport
clamping, not the requested width.

The example's total content insets include the detected padding plus extra
clearance chosen after reviewing the corner art. The 280 px content minimum
is separate from the body's detected art minimum of 208 by 219 px.
Text, controls, and these total insets determine the body height, with
`minHeight` as its floor. This configuration is not a
slicewright input format or a public API. Change it for the actual game and
recheck the assembled result.

## Compose in the target

In CSS, use an unbordered, unpadded wrapper as the shared coordinate system.
Put the emitted body, ornament, and content in it as siblings so their stacking
order and attachment origin are explicit:

```html
<div class="panel-group">
  <div class="ui-panel" aria-hidden="true"></div>
  <img class="panel-ornament" src="ui/crest.png" alt="">
  <div class="content-layer">
    <div class="panel-content">Runtime text and controls</div>
  </div>
</div>
```

```css
/* Load emitted ui-panel.css; its border padding stays on the art layer. */
.panel-group { position: relative; isolation: isolate; width: min(480px, 100%); min-width: 280px; }
.panel-group > .ui-panel { position: absolute; inset: 0; width: 100%; height: 100%; }
.panel-ornament {
  position: absolute; z-index: 1; left: 50%; top: 40px;
  width: 160px; height: auto; transform: translate(-50%, -100%);
  pointer-events: none;
}
.content-layer {
  box-sizing: border-box; position: relative; z-index: 2;
  display: flex; flex-direction: column;
  min-height: 219px; padding: 108px 54px 111px;
}
.panel-content { flex: 1; display: flow-root; overflow-wrap: anywhere; }
```

This CSS shows the configuration's default placement. In component code, apply
the configuration to these styles and repeat width/breakpoint resolution on
resize. A stacked action layout uses a column or one full-width button per row;
wrapping must also allow long labels and enlarged text to fit.

The content layer participates in normal flow, making the wrapper and art grow
with it. Its padding is the total inset from the body rectangle. It replaces
the body's exported padding as the runtime content placement rule; do not add
that padding a second time. Reserve space for protruding art, and keep every
body size above the emitted minimum. If the available width is below the
component's content minimum, choose another layout instead of silently clipping.

The following Phaser snippet is a different, fixed-height design: a 480 by
360 px body, ornament offset 24 px down, and total content insets of 80 px top
and 64 px on the other sides. Choose those values for the actual art rather
than copying them from this example. Load the packed atlas as `ui` using the
`pack` report's loader call.
Keep the body, ornament, and content unrotated and unscaled inside one
Container. The body uses a top-left origin; the normalized ornament keeps its
own size and uses a bottom-center origin:

```ts
const group = this.add.container(x, y);
const body = this.add.nineslice(0, 0, 'ui', 'ui-panel', 480, 360).setOrigin(0);
const ornament = this.add.image(240, 24, 'ui', 'crest').setOrigin(0.5, 1);
const label = this.add.text(64, 80, text, style).setWordWrapWidth(352);
group.add([body, ornament, label]); // body, then ornament, then runtime content

function resizePanel(width, height) {
  body.setSize(width, height);
  ornament.setPosition(width / 2, 24);
  label.setWordWrapWidth(width - 128);
}
```

Clamp or reject sizes below the body's minimum before calling `resizePanel`.
Wrapping does not ensure the label fits vertically: compare its rendered
height with `height - 80 - 64`. Apply shared movement or scaling to the
Container. If child transforms differ, convert the attachment coordinates
instead of reusing these local-coordinate formulas.

## Check the assembly

Render the smallest supported body and a wider body with the longest real
content, including the game's languages and 200% text. Confirm that glyphs and
controls stay inside the declared region, the content-driven height grows,
fixed ornaments keep their shape and anchor, and protruding art is visible.
Exercise both sides of each responsive breakpoint and change an anchor,
offset, and content inset to check that the configuration actually drives the
component. Compare content edges with the total insets to catch padding applied
twice even when all text still fits.

Use actual pointer input to confirm that decoration cannot intercept controls.
In a browser check, temporarily overlap the ornament and a button to exercise
pass-through, then restore the composition. Keep a screenshot or rendered-pixel
check too: a decoded image and correct bounding box do not prove the art was
painted. Inspect the screenshots for legibility and artistic fit. A passing
slice or atlas report checks the art; it does not verify these composition rules.
