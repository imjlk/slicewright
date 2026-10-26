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

## Compose in the target

For example, a body could be 480 by 360 logical pixels, with an ornament whose
bottom center follows the body's top center, offset 24 px down. Content could
use authored insets of 64 px left/right, 80 px top, and 64 px bottom, after
checking the body's padding and ornament clearance. These are example design
values, not inferred values for arbitrary art.

In CSS, use an unbordered, unpadded wrapper as the shared coordinate system.
Put the emitted body, ornament, and content in it as siblings so their stacking
order and attachment origin are explicit:

```html
<div class="panel-group">
  <div class="ui-panel" aria-hidden="true"></div>
  <img class="panel-ornament" src="ui/crest.png" alt="">
  <div class="panel-content">Runtime text and controls</div>
</div>
```

```css
/* Load the emitted ui-panel.css for .ui-panel's borders and content padding. */
.panel-group { position: relative; isolation: isolate; width: 480px; height: 360px; }
.panel-group > .ui-panel { position: absolute; inset: 0; width: 100%; height: 100%; }
.panel-ornament {
  position: absolute; z-index: 1; left: 50%; top: 24px;
  width: 160px; height: auto; transform: translate(-50%, -100%);
  pointer-events: none;
}
.panel-content { position: absolute; z-index: 2; inset: 80px 64px 64px; }
```

Those content insets are relative to the wrapper's body rectangle. They replace
the body's padding as the runtime content's placement rule; do not add the
padding a second time. Reserve room around the component for protruding art,
and keep every body size above the emitted minimum.

In Phaser, load the packed atlas as `ui` using the `pack` report's loader call.
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

Check the assembled result in the chosen target: the smallest supported body,
a wider or taller body, and the longest real content. Confirm fixed ornaments
keep their shape and anchor, text stays in its declared region, protruding art
is not clipped, and decorations do not intercept controls. A passing slice or
atlas report checks the art; it does not verify these composition rules.
