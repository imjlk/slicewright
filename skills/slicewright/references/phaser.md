# Phaser 4

```ts
this.load.atlas('ui', 'ui/panel.png', 'ui/panel.json');
// Insets come from the frame's scale9Borders; width and height default to the frame.
const panel = this.add.nineslice(400, 300, 'ui', 'panel', 320, 200);
panel.setSize(360, 220); // never below left+right by top+bottom; scale instead.
```

Place text inside the content padding, not the slice insets. The padding ends
exactly where the frame does, so keep a margin of about 8 px for text, and
more where corner ornaments reach inward:

```ts
const padding = this.textures.getFrame('ui', 'panel').customData.slicewright.contentPadding;
const margin = 8; // breathing room between text and the frame
const corner = panel.getTopLeft(); // works for any origin
this.add.text(corner.x + padding.left + margin, corner.y + padding.top + margin, 'Hello', style)
  .setWordWrapWidth(panel.width - padding.left - padding.right - margin * 2);
```

`scale9Borders` is the stretchable center rectangle `{ x, y, w, h }`. A frame
whose `y` is 0 and `h` equals the frame height is a three-slice and its height
cannot change. For a `tile.<axis>.auto` finding, pass `tileX` / `tileY` as the
last NineSlice constructor arguments; `export --target phaser` prints the call. Extrude or pad atlas frames by 1 to 2 px
so linear filtering does not bleed neighbors into the seams.
