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

Insets are four sizes in pixels, `left`, `right`, `top`, and `bottom`, that
describe the layouts with at most one flexible span per axis (see Slice
layouts): they are how callers give a nine-slice and how engines such as Phaser
store one. Corners keep their size, the top and bottom edges stretch
horizontally, the left and right edges stretch vertically, and the center
stretches both ways. The stretchable span on each axis must be at least one
pixel wide, so `left + right` must be smaller than the width and `top + bottom`
smaller than the height. When the fixed segments take more than half of an
axis that resizes, an `insets.large` warning says how little stretches and how
far the art can shrink, and points at `--mode three` when the height is mostly
fixed (a pill's ends are rounded across the whole height) or `--mode
three-vertical` when the width is.

## Slice layouts

Every slicing scheme is one engine-neutral layout: each axis is a list of
segments that cover it in order, and each segment is `fixed` (keeps its size),
`stretch`, or `tile`. A nine-slice has one flexible segment per axis between
fixed ones; a three-slice has a fully fixed vertical axis; a vertical
three-slice has a fully fixed horizontal axis; a multi-region layout has more
than one flexible segment on an axis; a layout with nothing flexible is
`fixed`. Segment bounds are whole pixels. Insets convert to a layout and back
whenever each axis has at most one
flexible segment, and a fixed axis converts to zero insets on both sides. The
minimum size of a layout is the sum of its fixed segments on each axis.

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
such span, trimmed to whole periods (with the leftover lines placed so the span's
midpoint sits nearest the center) and holding at least two, becomes the
stretch span when it reaches 10% of the content; ties prefer the shorter period,
then the span nearest the center. That axis is then tiled, and a
`tile.<axis>.auto` finding names the period and tells the caller to enable
tiling on the engine object, because engines read tiling from the object rather
than from atlas data.

## Three-slice

A layout whose `top` and `bottom` are both zero is a three-slice: it stretches
horizontally and its height stays fixed to the image. In automatic mode an image
with no vertical stretch span becomes a three-slice and an informational
`three-slice.auto` finding records the choice. Forcing three-slice mode sets
`top` and `bottom` to zero.

## Vertical three-slice

A vertical three-slice keeps its width and stretches only vertically, like a
scroll bar track. In automatic mode, when no two adjacent columns match but rows
do, the layout becomes a vertical three-slice and a `three-slice.vertical.auto`
finding records it. Forcing the mode sets `left` and `right` to zero and skips
the column checks.

## Multiple stretch regions

Some art has fixed detail in the middle of an edge, such as a crest on a title
plate, with stretchable lengths on both sides. With multiple regions requested,
every uniform run on an axis that reaches 10% of the content becomes its own
stretch segment, with fixed segments between them. This refines whichever
single layout detection found, including a three-slice or vertical three-slice.
An axis with only one such run keeps the single-region result, a tiled axis and
an axis the layout keeps fixed are never split, and a
`regions.multi` finding records the counts. The reported insets are the
outermost flexible lines. Multiple regions are only detected, so asking for them
together with given insets is refused. No current target can export a
multi-region layout;
it renders in previews and reports `target.unsupported` on export.

## Stretch uniformity

Insets that leave no stretch span are an `insets.invalid` error reported on a
layout that resizes nothing. When the caller supplies valid insets, every column
inside the horizontal stretch span
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
key is removed. A pixel is dominated by a key when green, or red and blue
together, exceed the other channels by more than 64 of 255. Edge pixels are
visible pixels within 2 px of a fully transparent pixel or of the image border
(the outermost three rows and columns);
the rest of the visible pixels, translucent fills included, are the art itself.
A key's color is spill when it dominates more than 1% of the edge pixels and its
share on the edge is more than three times its share in the art, each key
judged on its own, so pink or purple art is not mistaken for a magenta fringe;
when both keys qualify, the one with the larger edge share is reported. Art so
thin that every visible pixel is on the edge gives nothing to compare, so it is
not judged.
Art drawn mostly in a key's own color hides a fringe of that color, and a
deliberate glow or outline in a key's color looks like spill; the warning says
so. Spill raises an `alpha.chroma-spill` warning that reports the count and the
key.

## Interior alpha

Some generators fake transparency and leave a blotchy, partly transparent hole
in the middle of the element. When more than 5% of the pixels in the central
half of the content have an alpha between 1 and 223, an `alpha.interior`
warning reports the share. Generators often draw solid faces at an alpha of 240
to 254, which is not counted. A fully transparent center, as a picture frame has,
is not counted.

## Tiling seams

An axis may tile instead of stretch; only an axis with a single tiled span is
checked. Tiling repeats the stretch span, so the
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
`max(r, b)`; red and blue drop by their lead over green. The radius must be a
whole number from 0 to 64.

## Resizing

Generated art is resized to its in-game size before slicing. The area filter
averages every source pixel an output pixel covers, weighted by overlap, in
premultiplied alpha so transparent pixels do not darken edges; when enlarging
it samples the covering source pixel. The nearest filter samples the source
pixel under each output pixel center, for pixel art. A target is a width and
height in whole pixels, one side with the aspect ratio kept, or a positive scale,
never a scale together with a size; anything else is refused rather than
clamped.

A piece drawn on its own, such as a speech-bubble tail, can instead be scaled
so its outline matches another image's. The outline thickness of an image is
measured along five sample lines from each edge. Each walk starts at the first
visible pixel (up to half the line, since a piece such as a tail does not reach
the canvas edge on every line) and passes the anti-aliased ramp (alpha below
224); the first opaque pixel within a quarter of the length gives the stroke
color, the line's center gives the inside color, and the two must differ by
more than 48. Through the stroke's middle, its horizontal run h and vertical
run v count pixels by coverage: each pixel's premultiplied color is projected
onto the line from the nearer background (the inside, or transparency on the
outer side) to the stroke color, a pixel at least half stroke counts whole, and
the pixel where the stroke ends counts by its share. Noise below half the
contrast therefore never cuts a stroke short, and anti-aliased edges count in
part. The perpendicular thickness is `1 / sqrt(1 / h² + 1 / v²)`, so a slanted
side measures like a straight one. The median over the strokes found is the
thickness; fewer than three strokes is no measurement, which is an error. The
scale is the reference thickness divided by the piece's. Resizing can first
crop transparent margins (alpha of 8 or less), and then crops rows and columns
that averaged to full transparency, as normalization does; cropping an image
with nothing visible is an error.

## Normalization

Normalization prepares generated art for the engine in a fixed order: crop
margins, resize to the target, then pick or check insets at the final size. The
crop ignores pixels whose alpha is 8 of 255 or less, so a faint shadow does not
hold it open; after resizing, rows and columns that averaged to full
transparency are cropped as well. With a keep length, it rebuilds a smaller
texture that keeps the fixed borders and the first `keep` lines of each stretch
span. It rebuilds only an axis whose span was really found (not tiled, no
`stretch.<axis>.none` or `stretch.<axis>.short` fallback), never an axis that
keeps its size (the height of a three-slice, the width of a vertical
three-slice), and never a multi-region layout. Noise tolerance accepts spans that
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

Before resizing down, normalization looks for drawn lines the resize will
lose. Area averaging leaves a line about its width divided by the factor of
its contrast, so a line narrower than half the factor fades; nearest sampling
can drop a line narrower than the factor. That width is the limit for each
axis. Along up to five distinct sample lines at 40% to 60% of the cropped image
it walks in from each edge, past the transparent margin and the anti-aliased
ramp (alpha below 224), and no further than a quarter of the length, splitting
the line into segments whose neighbors differ by at most 40 (premultiplied,
alpha included). A segment that reaches the end of the search is the fill,
whether opaque, translucent, or empty. A segment at least as wide as the limit
is a rim, which keeps marking the border, so nothing is reported. Narrower
segments are passed over, so a double stroke still reaches the fill; the first
of them that differs from both neighbors by more than 48 (from the
transparency outside by its alpha) is the line. When at least three of a
side's sample lines reach the fill past such a line, a `resize.thin-lines`
warning names the sides, widths, and factors and asks for lines at least as
thick as the limit or a larger size.

## Content padding

Content padding is where content such as text sits inside the frame: four sizes
in pixels measured from each edge, separate from the slice insets. An ornate
frame's corners can reach far past its border, so the insets can be much larger
than the room content needs. Unless the caller gives it, padding is detected:
five sample lines at 40% to 60% of the content walk outward from its center,
each stopping at the first step between neighboring pixels larger than 16 or
twice the axis's matching tolerance, and each side takes the median stop. A
smooth fill or gradient never stops a walk; the frame's inner edge does. A walk
that reaches the image edge gives zero padding on that side.

Padding is part of the layout, so it travels with it through every transform
and target. On an axis that resizes it stays within the fixed segments at each
edge, so it never changes with size: detected padding that would reach into a
stretch span is clamped to the fixed edge with a `padding.clamped` note, and
given padding past the fixed edge is a `padding.invalid` error, as is padding
that is not whole and non-negative or leaves no content area at least one pixel
wide. Rejected padding is reported but kept out of the layout. A target refuses a layout whose padding does not fit the image or reaches
past the fixed segments at an edge.

The Phaser target records it in the frame as `"slicewright": { "contentPadding":
… }`, which Phaser keeps in `frame.customData`, and its usage names that path.
The CSS target sets `border-width` to the padding, which sizes the content box,
and `border-image-width` to the insets, so the art still draws at its slices;
the minimum size on every resizable axis holds both. The atlas check refuses padding that does not fit
the frame or reaches past the fixed segments its `scale9Borders` leave
(`atlas.padding-invalid`). The preview outlines the content box on the
guides cell.

## Set comparison

A comparison takes two or more images and checks that they agree. States of one
element (normal, hover, pressed, disabled) swap in place in one NineSlice or
element, so they must have the same size (`compare.size`) and the same slice
mode (`compare.mode`) and tile the same axes (`compare.tile`), because Phaser
takes tiling only when the NineSlice is created; all three are errors. Each state is inspected on its own; detected
insets or content padding that differ between states by more than the slack
(1 px by default, a whole number of pixels) are a `compare.insets` or
`compare.padding` warning, because the corners would jump or the text would
move when the states swap. When the states agree on size, mode, and tiling, every state
is inspected again with the shared insets, the largest inset on each side, keeping
the tiling it detected, and a
state that then has an error finding is a `compare.shared-insets` error: no one
set of insets fits every state. States are compared by detected insets and padding, never given ones, and
compare single-region layouts only, since
shared insets cannot describe several stretch regions per axis. A matching set (a dialog, a button, and a bar)
has pieces of different sizes and slices, so only their line weight is compared.
For both kinds, outlines are measured as for resizing, and when the thickest
exceeds the thinnest by more than 1 px and by more than a quarter, that is a
`compare.outline` warning; pieces without a measurable outline, even all of
them, are named in a `compare.outline-missing` note. The comparison fails when any of its own
findings or any piece's inspection is an error.

## Preview sheet

A preview sheet renders the layout at several sizes on one PNG over a
checkerboard: the source with flexible segments tinted, the source size, the
minimum size, wide and tall (each only when that axis can resize), and doubled
on the axes that can resize, then a diagnostics cell when findings mark a place
(see Preview diagnostics). Cells sit in rows that wrap before a cell would
cross the maximum width (2048 px by default); a cell wider than that sits alone
in its row. The caller can choose cells, which keep this order, and zoom every
cell by a whole number from 1 to 8, repeating each pixel, so small art stays
inspectable in an image viewer. Asking for a cell the layout cannot show (wide
when the width never resizes, tall when the height never does) is an error, and
so is a sheet over 16384 px on a side or 64 megapixels, which is refused before
anything renders. Rendering samples the nearest source pixel. Fixed
segments keep their size and the flexible segments share the rest in proportion
to their source size. A tiled segment repeats a whole number of tiles, the
segment length divided by the source length rounded down and at least one, each
scaled to fill the segment, as Phaser does; the renderer can round to the
nearest count instead, to compare with CSS `round`. A size below the fixed segments is
raised to them; a requested size must be a whole, non-negative number of pixels.

## Preview diagnostics

A preview sheet given a report's findings adds a diagnostics cell at the
source size, after the other cells, when any finding marks a place: the source
dimmed halfway toward gray (alpha at least 96 so empty areas show), with the
first differing pair of columns or rows of a `stretch.<axis>.nonuniform`
finding and the first and last line of the tiled span of a `tile.<axis>.seam`
finding drawn in red, and the partly transparent pixels (alpha above 0 and
below 224) inside the interior region of an `alpha.interior` finding, which
the finding reports, in yellow, each marker drawn over the ones before it. Without such a finding the cell does not
exist, so asking for it is an error. The preview command passes its
inspection findings and lists each marker's code, kind, and count.

## Phaser scale9Borders

Phaser 4 reads a frame's `scale9Borders` as the stretchable center rectangle:
`x = left`, `y = top`, `w = width - left - right`, `h = height - top - bottom`.
Phaser treats a frame as a three-slice when `y` is zero and `h` equals the frame
height. slicewright converts both ways and writes a single-frame JSON Hash atlas,
untrimmed and unrotated, that `this.load.atlas` accepts. The Phaser target adds
the `this.load.atlas` and `nineslice` calls, passing `tileX` and `tileY` for
tiled axes, because Phaser reads tiling only from the constructor. Phaser resolves the image and
atlas URLs in `this.load.atlas` against its loader path rather than the atlas
file, so the call uses paths from where the game is served (the working
directory, from the CLI) while the atlas keeps the image path relative to
itself. Phaser has no vertical three-slice, so it is emulated.

The emulated vertical three-slice records its shape in the frame as
`"slicewright": { "shape": "three-vertical" }`, which Phaser keeps in
`frame.customData`. A frame with a tiled axis records it as `"slicewright": {
"tile": { "x": …, "y": … } }`; Phaser ignores it, but the atlas check inspects
those axes as tiled and packing carries the flags into its usage.

Because Phaser reads borders spanning the full height as its own three-slice, a
layout whose height stretches as one full-height span (zero top and bottom
insets on a resizable axis) cannot be encoded and is a `target.unsupported`
error for the Phaser target. The usage keeps guidance such as a fixed size in a
JavaScript comment.

## Targets

A target turns a layout into an engine's files. Each target declares the shapes
it represents natively, the shapes it can only emulate, and whether it tiles
per axis, both axes together, or not at all. Emulation exports the fixed axis
with zero insets, so the engine would stretch it, and a `target.emulated`
finding tells the caller to keep that axis at its source size. A shape the
target can neither represent nor emulate is a `target.unsupported` error and
writes no files, and so is a layout that never resizes (`target.fixed`), since
every target would stretch zero-inset art. Tiling the target cannot express is
a `target.tile` warning, and so is a target whose tile count differs from the
layout's rule of rounding down (CSS `round` takes the nearest whole number). Each target also
has a status: `verified` targets are rendered in the real engine by the engine
check, and an `experimental` target follows the documented format without being
run, which a `target.experimental` finding states on every export. The verified
targets are `phaser` and `css`; `unity`, `defold`, and `godot` are experimental.
Each target also declares the file names an export may write for its name, so a
build can check them for collisions before writing anything.

The layout and the image must have the same size; a target refuses a layout
built for another size, as the renderer does.

## CSS border-image

The CSS target writes a class with `border-image-slice` set to the insets plus
`fill`, matching `border-width` in pixels, and `border-image-repeat` of
`stretch` or, for a tiled axis, `round` (whole tiles scaled to fit). The usage
links the stylesheet from the same served path the Phaser usage loads from.
URLs the targets emit percent-encode each path component, so a name such as
`button#blue.png` stays one file; the atlas keeps the plain file path. `round`
takes the nearest whole number of tiles rather than rounding down, so a tiled
CSS export carries a `target.tile` warning. A
three-slice fixes the height and a vertical three-slice fixes the width; any
other layout sets the minimum width and height. CSS cannot express more than
one region per axis.

## Experimental targets

Three targets follow their engine's documented format but are not rendered by
the engine check, so each is `experimental`. Each represents a nine-slice
natively and emulates both three-slices with zero insets on the fixed axis;
none exports multiple regions. Their usage text names the asset and repeats
the content padding when there is one.

Unity takes the border as a `Vector4` in its own order, `x = left`,
`y = bottom`, `z = right`, `w = top`, for `TextureImporter.spriteBorder` or the
Sprite Editor. The Unity target writes no file and never touches a `.meta`
file: its usage prints the vector and editor-script lines that set it and
reimport the texture, and the Sliced or, for a tiled axis, Tiled draw mode. Unity tiles both axes
together and clips the last tile instead of fitting whole tiles, so a tiled
export also carries a `target.tile` warning.

Defold takes `slice9` as left, top, right, bottom on a sprite component (Size
Mode Manual, trimming off) or a GUI box node (Size Mode Manual), and cannot
tile. The Defold target writes no file: its usage prints `slice9` in the
component file format, a `go.set` call on the sprite's `slice` property, and GUI
calls that set the node's size mode to manual and its `slice9`.

Godot 4 takes texture margins for `StyleBoxTexture` and patch margins for
`NinePatchRect`, with an axis stretch mode per axis: 0 stretches and 2 (tile
fit) tiles whole tiles scaled to fit, which may pick another count than the
layout's rounding down, so a tiled export carries a `target.tile` warning. The
Godot target writes `<name>.tres`, a `StyleBoxTexture` resource whose texture is
the image reference when it starts with `res://`, and otherwise `res://` plus
the image's path from where the command runs, taken as the project root, with content margins from the content padding; its usage prints the
same values as `NinePatchRect` properties.

## Atlas frames

An atlas check reads a Phaser JSON Hash or JSON Array atlas and validates every
frame that has `scale9Borders`, or only the named frame. A trimmed frame is an
error because Phaser's NineSlice does not support trimming. A rotated frame is a
warning. A frame rectangle that is not whole pixels or lies outside the image
is an `atlas.frame-outside-image` error. Borders outside the frame are an error. Each frame's pixels are then
inspected with its borders as explicit insets: borders spanning the full height
inspect as a three-slice. Borders spanning the full width are an ordinary
nine-slice whose columns must match, unless the frame carries
`"slicewright": { "shape": "three-vertical" }`, which the Phaser target writes
for its emulated vertical three-slice. A frame carrying that marker without
full-width borders is an `atlas.marker-mismatch` error, because Phaser would
still render it as a nine-slice.

## Aseprite slices

An Aseprite sheet, the JSON that `aseprite --sheet --data --list-slices`
writes, is told apart from a Phaser atlas by a `meta.app` that names Aseprite
or a `meta.slices` list. Its slices are checked instead of `scale9Borders`:
every slice that has a nine-slice `center` in any key, or only the named slice.
A key holds from its frame until the next key's frame, so each frame it covers
is checked on its own; a key starting past the last frame is an
`aseprite.frame-missing` error, and a key with zero width or height hides the
slice, so the frames it covers are skipped. A key's `bounds` lie on the sprite canvas and
map into the sheet through the frame's position, any inner padding (the
frame's border around its `spriteSourceSize`, which must be even), and, for a
trimmed frame, its `spriteSourceSize`, which a trimmed frame must have
(`aseprite.bounds-outside-frame` otherwise, as is an uneven or negative inner
padding, or a `spriteSourceSize` that leaves the sprite canvas); every slice
needs at least one key; a frame or `spriteSourceSize` that is not a whole-pixel
rectangle with a positive size, a frame that reaches past the image, or bounds
that map outside the image, is
an `atlas.frame-outside-image` error. Bounds that are not a whole-pixel rectangle with a positive
size are `aseprite.bounds-invalid`, bounds past the kept frame are
`aseprite.bounds-outside-frame`, a rotated frame is `aseprite.rotated`, and a
center that does not lie inside its bounds with a positive size is
`aseprite.center-invalid`, all errors. A whole-pixel coordinate or size is an
integer of magnitude at most 2147483647, so rectangle sums stay exact. The center, relative to the bounds,
becomes the insets, which are reported with the bounds and the pivot. The
slice's pixels are inspected with them as explicit insets: a center spanning
the full height inspects as a three-slice, as in Phaser, and one spanning the
full width as a vertical three-slice. A slice without a
center in any key has only its bounds checked, noted as `aseprite.no-center`.

## Atlas packing

Packing combines frames from several atlases, usually the one-frame atlases
that `normalize` and `export` write, into one image and one JSON Hash atlas so
a game loads a matching set with a single `this.load.atlas` call. An input may
also be a plain PNG, packed as one frame without borders named after the file,
such as a speech-bubble tail. Every frame
keeps its pixels exactly, untrimmed and unrotated, with its `scale9Borders` and
slicewright data; frames without borders pack as plain sprites, which the
usage adds with `this.add.image`. Frames go on
shelves, tallest first, in a sheet about as wide as it is tall. Each frame is
surrounded by its own outermost pixels repeated outward (`extrude`, 1 px by
default), so linear filtering at the frame edge never samples a neighbor, and
then by transparent spacing (2 px by default); both are whole numbers from 0 to
64. Frame names must be unique across the inputs, and a trimmed, rotated, or
fractional input frame is refused, because its pixels cannot be copied as they
render.
The packed atlas gets the same check as any other atlas, and an error in it
fails the command. Its usage loads the atlas once and creates each frame's NineSlice with its tiling
flags. Because CSS `border-image` cannot address part of an image, the packed
CSS is one stylesheet with a class per frame that still points at each frame's
own image, and a frame that is only part of its image has no CSS class; with no
class at all, no stylesheet is written. Packing refuses to write over an input
atlas, its image, or the stylesheet beside it, comparing existing files by their
real path, and refuses an image path that is also its own atlas or, with a
stylesheet, its stylesheet, even when they differ only in letter case.

## Build manifest

A build manifest lists the pieces of a set in one JSON file so the whole set
is rebuilt with one command: every piece is normalized, written with its
one-frame atlas and any exports it asks for, and then all pieces are packed.
The manifest's shape is validated before anything is read or written, with
unknown keys refused so a misspelled setting is not ignored, and so is what the
shape cannot say: piece names, which default to the input's file
name, and the pack name must be plain file names, piece names must be unique
ignoring letter case, a piece gives a scale or a size but not both and not
insets with multiple regions, insets and
padding use the command-line syntax, every target exists, and no path or name
holds a NUL character. A bad manifest
is a usage error. Paths in the manifest are relative to it; the pieces go to a
`pieces` directory beside the packed PNG unless the manifest names another. A
piece takes the same normalization settings as the normalize command. A build
refuses to write over any piece's input or the manifest, and refuses two
outputs at one path (a piece named like the pack in the pack's directory),
counting its own stylesheets when it writes them and every file a piece's
targets declare, such as a Godot `.tres`, or an output that is also a directory another output
goes into or an existing directory, comparing real paths without letter case (a new file by its directory's real
path), before it writes anything it can
name ahead. The packed atlas is checked with the most lenient matching any
piece used, since each piece already passed its own settings and packing
copies its pixels exactly, and its stylesheet findings are reported. When a
piece fails its inspection or export, nothing is packed and the build fails;
otherwise the build fails exactly when the pack fails. Watching builds once,
then again whenever the manifest or a piece's input changes, reading the
manifest anew each time, and keeps watching after a failed build. A piece in a
directory that does not exist yet is watched through its nearest existing
ancestor until the directory appears, and an event that names no file rebuilds
only when a watched file's modification time changed. A watched file that
changed while a build ran starts another build. When the watch is interrupted,
its exit status is that of the last build: a failed build exits 1, and a bad
manifest or a build error exits 2. A symlinked input is
watched both where the link is and where it points.

## Command-line arguments

A number option takes a negative value written either as `--tolerance=-1` or
as `--tolerance -1`. The argument parser would read a separate `-1` as a short
option and leave the flag without a value, so a negative number that follows
a flag taking a number is joined to that flag first; the command then
validates the value like any other. A number flag with nothing after it, or
followed by another option, is refused with a message naming the flag. Other
flags and everything after `--` are passed through unchanged.

## Generation prompts

A prompt plan turns a UI kind (button, panel, dialog, bar, bar fill, tooltip,
bubble, bubble tail, frame), a style, and a background choice into a
generation prompt. The prompt asks for a
flat, front-facing element that fills the canvas, decoration only in the
corners (the end caps for a bar), edges that are plain bands with no pattern,
grain, or texture running along them (a rope or vine edge can neither stretch nor tile cleanly
when a model draws it), a plain center, no text or icons, and the requested
background. Bars are planned as three-slices. A bar fill is the part of a
progress bar drawn inside the track: a three-slice strip with no frame of its
own and short, simple ends, because it is drawn at any length down to its two
ends, sized afterwards to the track's content height. A speech bubble is planned
as a nine-slice body with an even outline and no tail, and its tail as a
separate sprite (a plan mode of `sprite`, never stretched) outlined on its sides
with a straight, unoutlined cut across its top, so it can overlap the body's
bottom outline; its follow-up steps match its outline to the body's instead of
inspecting it. The plan lists what to avoid and
the follow-up steps: remove the background, inspect, and preview.
