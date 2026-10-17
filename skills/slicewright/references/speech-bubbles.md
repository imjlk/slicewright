# Speech bubbles

A tail on the bubble's edge cannot stretch, so make the body and the tail as
two pieces of a matching set: `--kind bubble` (a nine-slice body with an even
outline and no tail) and `--kind bubble-tail` (the tail alone, outlined on its
sides, with a straight cut and no outline across its top). Generate the tail
with the body as a reference image when the generator accepts one.

1. Normalize the body as usual and read its `contentPadding`: its bottom is
   how far the tail must overlap to cover the body's bottom outline.
2. Generators draw the tail at their own scale, so match its outline to the
   body's: `slicewright resize tail.png --crop --match-outline ui/bubble.png
   --out ui/bubble-tail.png`. It measures both outlines perpendicular to the
   stroke and scales the tail by the ratio.
3. Pack both (`slicewright pack ui/bubble.json ui/bubble-tail.png --out
   ui/ui.png`); a PNG input packs as a plain frame named after the file.
4. Draw the tail after the body, its top at the body's bottom minus the
   padding, anywhere between the corners:

```ts
function attachTail(body, tail, padding, along = 0.5) {
  const corner = body.getTopLeft();
  const min = body.leftWidth + tail.width / 2;
  const max = body.width - body.rightWidth - tail.width / 2;
  // A tail wider than the straight edge between the corners stays centered.
  const at = min > max ? body.width / 2 : Phaser.Math.Clamp(body.width * along, min, max);
  const x = corner.x + at;
  tail.setOrigin(0.5, 0).setPosition(x, corner.y + body.height - padding.bottom);
}
const padding = this.textures.getFrame('ui', 'bubble').customData.slicewright.contentPadding;
const body = this.add.nineslice(x, y, 'ui', 'bubble', 320, 160).setOrigin(0);
attachTail(body, this.add.image(0, 0, 'ui', 'bubble-tail'), padding, 0.3);
```

In CSS the body's `border-width` is its content padding, so a tail hung from
the padding box overlaps the outline by exactly that much:

```css
.ui-bubble { position: relative; }
.ui-bubble::after {
  content: ""; position: absolute; top: 100%; left: var(--tail-at, 50%);
  width: 114px; height: 93px; /* the tail PNG's size */
  transform: translateX(-50%);
  background: url("ui/bubble-tail.png") no-repeat;
}
```

Keep `--tail-at` between the corners in CSS yourself; nothing clamps it there.
Both were checked in Phaser 4.2 and Chrome with a generated pair, at three
body sizes and three tail positions.
