/**
 * The single-region body that still resizes on the same axes as a multi layout.
 *
 * @evidence docs/spec.md#multiple-stretch-regions Picks a nine-slice when both axes resize, a three-slice when only the width does, and a vertical three-slice when only the height does.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #fbac3c4 Reread the three body cases and checked this function returns those names.
 */
export function multiRegionBody(
  horizontal: number,
  vertical: number,
): 'nine-slice' | 'three-slice' | 'vertical three-slice' {
  if (horizontal > 0 && vertical > 0) {
    return 'nine-slice';
  }
  if (vertical > 1) {
    return 'vertical three-slice';
  }
  return 'three-slice';
}

/**
 * What to do with fixed detail that sits between stretch regions.
 * The body is the single-region shape that still resizes on the same axes.
 *
 * @evidence docs/spec.md#multiple-stretch-regions Names the separate-sprite body from which axes still resize: both, width only, or height only.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #fbac3c4 Reread the three body cases. Both axes still resizing names a nine-slice, width only a three-slice, and height only a vertical three-slice.
 */
export function multiRegionRemedy(horizontal: number, vertical: number): string {
  return `Draw the fixed detail, such as a crest or a tail, as its own sprite on a ${multiRegionBody(horizontal, vertical)} body.`;
}
