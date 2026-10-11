# slicewright specification

This document is the contract the source and tests answer for. Every H2 section
is a requirement: `@ttsc/evidence` fails the build until at least one source
function and one test function cite it.

## PNG input

slicewright reads PNG files and works on straight-alpha RGBA, 8 bits per channel.
Truecolor, grayscale, and indexed PNGs at 8 or 16 bits are converted on load;
16-bit channels keep their high byte. Indexed PNGs at 1, 2, 4, or 8 bits expand
through their palette. Grayscale below 8 bits and animated PNGs are refused with
an error that names the reason.

## Slice insets

A slice layout is four insets in pixels: `left`, `right`, `top`, and `bottom`.
Corners keep their size, the top and bottom edges stretch horizontally, the left
and right edges stretch vertically, and the center stretches both ways. The
stretchable span on each axis must be at least one pixel wide, so `left + right`
must be smaller than the width and `top + bottom` smaller than the height.

## Stretch detection

Insets are detected from the image when the caller gives none. Two adjacent
columns match when, on every row, their premultiplied RGBA values differ by no
more than the tolerance (default 4 of 255); an outlier ratio (default 0) allows
that fraction of rows to differ. The longest run of matching columns inside the
content bounds is the horizontal stretch span. Ties prefer the run that covers
the content center, then the run closest to it. Rows are detected the same way.
When no adjacent pair matches, the span falls back to the single center pixel
and a `stretch.<axis>.none` warning says that stretching will smear detail.

## Three-slice

A layout whose `top` and `bottom` are both zero is a three-slice: it stretches
horizontally and its height stays fixed to the image. In automatic mode an image
with no vertical stretch span becomes a three-slice and an informational
`three-slice.auto` finding records the choice. Forcing three-slice mode sets
`top` and `bottom` to zero.

## Stretch uniformity

When the caller supplies insets, every column inside the horizontal stretch span
must match its neighbor, and every row inside the vertical span must match its
neighbor. A mismatch is an error that names the first offending pair, because
stretching that span changes the art. An axis in tiling mode is exempt and is
checked for seams instead.

## Transparent margins

Fully transparent rows and columns on the image border are margins. They become
part of the corners, which raises the minimum display size and wastes atlas
space, so a margin produces a `margin.transparent` warning with the content
bounds. A fully transparent image is an error.

## Chroma spill

Images generated on a chroma-key background often keep a tinted fringe after the
key is removed. A pixel is spill when it is visible, sits on the alpha edge
(partly transparent, or opaque beside a transparent pixel), and is dominated by
green or magenta by more than 64 of 255. When spill exceeds 1% of the edge
pixels, a `alpha.chroma-spill` warning reports the count and the dominant key.

## Tiling seams

An axis may tile instead of stretch. Tiling repeats the stretch span, so the
span must end where its pattern starts again. When every line of the span
matches the line one period later, for some period of at most half the span,
the span must be a whole number of periods; otherwise a `tile.<axis>.seam`
warning names the period and the nearest whole-period lengths. A span with no
such period wraps cleanly when the step from its last line to its first is no
larger than the tolerance or the largest step between adjacent lines inside it;
a larger jump is a `tile.<axis>.seam` warning.

## Preview sheet

A preview sheet renders the slice layout at several sizes on one PNG over a
checkerboard: the source with stretch spans tinted, the source size, the minimum
size, wide, tall (skipped for a three-slice), and doubled. Rendering samples the
nearest source pixel, keeps corners unscaled, and repeats spans in tiling mode the
way Phaser does: a whole number of tiles, each scaled to fill the span.

## Phaser scale9Borders

Phaser 4 reads a frame's `scale9Borders` as the stretchable center rectangle:
`x = left`, `y = top`, `w = width - left - right`, `h = height - top - bottom`.
Phaser treats a frame as a three-slice when `y` is zero and `h` equals the frame
height. slicewright converts both ways and writes a single-frame JSON Hash atlas,
untrimmed and unrotated, that `this.load.atlas` accepts.

## Atlas frames

An atlas check reads a Phaser JSON Hash or JSON Array atlas and validates every
frame that has `scale9Borders`, or only the named frame. A trimmed frame is an
error because Phaser's NineSlice does not support trimming. A rotated frame is a
warning. Borders outside the frame are an error. Each frame's pixels are then
inspected with its borders as explicit insets.

## Generation prompts

A prompt plan turns a UI kind (button, panel, dialog, bar, tooltip, frame), a
style, and a background choice into a generation prompt. The prompt asks for a
flat, front-facing element that fills the canvas, decoration only in the
corners (the end caps for a bar), edges that stay uniform along their stretch
direction, a plain center, no text or icons, and the requested background. Bars
are planned as three-slices. The plan lists what to avoid and the follow-up steps: remove the
background, inspect, and preview.
