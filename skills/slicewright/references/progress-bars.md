# Progress bars

A progress or health bar is two pieces made as a matching set: the track
(`--kind bar`) and the fill (`--kind bar-fill`), generated with the same style
words and, when the generator takes references, the track as a reference.

1. Normalize the track with `--mode three` and read its `contentPadding`: the
   fill sits in that box.
2. Normalize the fill to the box's height, `--height <track height - top -
   bottom>`, also with `--mode three`. A fill's soft top-to-bottom shade can
   otherwise pass as a vertical stretch span.
3. Draw progress by resizing the fill. Phaser's NineSlice never gets narrower
   than its two end caps, so below that width keep the caps' width and scale
   the fill down horizontally. The fill follows the track's top-left corner and
   scale, whatever the track's origin. Call it again whenever the track moves,
   resizes, or scales; with both in one Container, moving or scaling the
   Container needs no new call, but changing the track itself still does:

```ts
function setProgress(track, fill, padding, value) {
  const progress = Number.isFinite(value) ? Phaser.Math.Clamp(value, 0, 1) : 0;
  const inner = track.width - padding.left - padding.right;
  const width = Math.round(inner * progress);
  const caps = fill.leftWidth + fill.rightWidth;
  const corner = track.getTopLeft(); // unrotated tracks
  fill.setOrigin(0);
  fill.setPosition(corner.x + padding.left * track.scaleX, corner.y + padding.top * track.scaleY);
  fill.setVisible(width > 0);
  fill.setSize(Math.max(width, caps), fill.height);
  fill.setScale((width >= caps ? 1 : width / caps) * track.scaleX, track.scaleY);
}
const padding = this.textures.getFrame('ui', 'bar').customData.slicewright.contentPadding;
const track = this.add.nineslice(x, y, 'ui', 'bar', 320); // a three-slice keeps its height
const fill = this.add.nineslice(0, 0, 'ui', 'bar-fill');
setProgress(track, fill, padding, 0.4);
```

This keeps the fill exactly inside the track's content box at every width,
checked in Phaser 4.2 at 0 to 100% on two track widths, a centered track, and
a track scaled twice as wide.

In CSS, put the fill element inside the track element: the track's
`border-width` is its content padding, so the fill lands in the content box and
the track's `clientWidth` is the inner width. The fill's `min-width` is its
two end caps, so the same rule applies below it:

```js
function setProgress(track, fill, value) {
  const progress = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  const width = Math.round(track.clientWidth * progress);
  const caps = parseFloat(getComputedStyle(fill).minWidth);
  fill.style.visibility = width > 0 ? 'visible' : 'hidden';
  fill.style.width = `${Math.max(width, caps)}px`;
  fill.style.transformOrigin = 'left';
  fill.style.transform = width >= caps ? '' : `scaleX(${width / caps})`;
}
// <div class="ui-bar"><div class="ui-bar-fill"></div></div>
```

Checked in Chrome on the same widths and values. A fill whose look
changes along its length (a left-to-right gradient, segments) cannot be
resized this way, because resizing stretches it: draw it at full width and
reveal part of it instead, for example with a Phaser mask filter. slicewright
does not check that path.
