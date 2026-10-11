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
that fraction of rows, rounded up, to differ. The longest run of matching
columns inside the content bounds is the horizontal stretch span. Ties prefer
the run that covers the content center, then the run closest to it. Rows are
detected the same way.
A run shorter than 10% of the content (and at least two lines) is not trusted.
When no adjacent pair matches, or the run is too short and no repeating span
(see Repeating edges) is long enough either, the span falls back to the single
center line and a `stretch.<axis>.none` or `stretch.<axis>.short` warning says
that stretching will smear detail.

Generated art is never exactly flat. With noise handling on (the default), a
noise floor is measured for each axis in the units line matching uses: for each
adjacent line pair inside the central half of the content, the 98th percentile
of their pixel differences over the central half of the line, and the median of
those over the pairs. Edges and corners stay out of the sample, so a patterned
border is not taken for noise, and a gradient raises only its own axis. An axis
whose floor is above zero matches with a tolerance of three times the floor,
raised no higher than 24, and an outlier ratio of at least 2%; a
`noise.tolerance` finding records both axes. Floors above 8 on both axes mean
texture or a defect such as a hole in the alpha rather than noise, and add a
`noise.high` warning. Clean art measures zero and keeps exact matching.

## Repeating edges

Ornate edges often carry a pattern, such as a rope or a chain, that cannot
stretch but can tile. When an axis has no trustworthy uniform run, detection
looks for a span whose every line matches the line one period later, for
periods from 2 to a quarter of the content length and at most 64. The longest
such span, trimmed to whole periods and holding at least two, becomes the
stretch span when it reaches 10% of the content; ties prefer the shorter period,
then the span nearest the center. That axis is then tiled, and a
`tile.<axis>.auto` finding names the period and tells the caller to enable
tiling on the engine object, because atlas data cannot carry it.

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

## Interior alpha

Some generators fake transparency and leave a blotchy, partly transparent hole
in the middle of the element. When more than 5% of the pixels in the central
half of the content have an alpha between 1 and 249, an `alpha.interior`
warning reports the share. A fully transparent center, as a picture frame has,
is not counted.

## Tiling seams

An axis may tile instead of stretch. Tiling repeats the stretch span, so the
span must end where its pattern starts again. When every line of the span
matches the line one period later, for one or more periods of at most half the
span, the span must be a whole number of one of those periods; otherwise a
`tile.<axis>.seam` warning names the shortest period and the nearest
whole-period lengths. A span with no such period wraps cleanly when the step
from its last line to its first is no larger than the tolerance or the largest
step between adjacent lines inside it; a larger jump is a `tile.<axis>.seam`
warning.

## Chroma removal

Generators that cannot return alpha paint the element on a green or magenta
key. Key dominance is how far the key channel leads: `g - max(r, b)` for green,
`min(r, b) - g` for magenta. When no key is given, the key is the one that
dominates (by at least 120) half or more of the border pixels; with neither,
keying fails rather than guessing. Pixels at or above the drop threshold
(default 120) become fully transparent, pixels between the keep threshold
(default 40) and the drop threshold fade linearly, and the rest stay as they
are. Pixels within the despill radius (default 2) of a pixel that is not fully
opaque and that still lean toward the key are despilled: green drops to
`max(r, b)`; red and blue drop by their lead over green.

## Resizing

Generated art is resized to its in-game size before slicing. The area filter
averages every source pixel an output pixel covers, weighted by overlap, in
premultiplied alpha so transparent pixels do not darken edges; when enlarging
it samples the covering source pixel. The nearest filter samples the source
pixel under each output pixel center, for pixel art. A target is a width and
height, one side with the aspect ratio kept, or a scale.

## Normalization

Normalization prepares generated art for the engine in a fixed order: crop
margins, resize to the target, then pick or check insets at the final size. The
crop ignores pixels whose alpha is 8 of 255 or less, so a faint shadow does not
hold it open; after resizing, rows and columns that averaged to full
transparency are cropped as well. With a keep length, it rebuilds a smaller
texture that keeps the fixed borders and the first `keep` lines of each stretch
span. It rebuilds only an axis whose span was really found (not tiled, no
`stretch.<axis>.none` or `stretch.<axis>.short` fallback), and never the
vertical axis of a three-slice. Noise tolerance accepts spans that
carry texture or shading, which stretching keeps but cutting would lose, so each
axis is verified: rebuilt alone and rendered back at the original size, its
99th-percentile pixel difference must stay within the exact tolerance, not the
noise-raised one. An axis that fails keeps its full span and a
`rebuild.<axis>.lossy` warning reports the difference. Rebuilt layouts keep the
insets verified on the full image. A keep length below 8 adds a
`rebuild.filtering` note, because linear texture filtering blends the kept
lines into their neighbors over about the stretched span divided by twice the
keep length. When inspection reports an error, it returns the resized image
without rebuilding.

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
corners (the end caps for a bar), edges that are plain bands with no pattern
running along them (a rope or vine edge can neither stretch nor tile cleanly
when a model draws it), a plain center, no text or icons, and the requested
background. Bars are planned as three-slices. The plan lists what to avoid and
the follow-up steps: remove the background, inspect, and preview.
