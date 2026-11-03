/**
 * What to do with fixed detail that sits between stretch regions.
 * The body is the single-region shape that still resizes on the same axes.
 *
 * @evidence docs/spec.md#multiple-stretch-regions Names the separate-sprite body from which axes still resize: both, width only, or height only.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #fbac3c4 Reread the three body cases. Both axes still resizing names a nine-slice, width only a three-slice, and height only a vertical three-slice.
 */
export function multiRegionRemedy(horizontal: number, vertical: number): string {
  const body =
    horizontal > 0 && vertical > 0
      ? 'a nine-slice body'
      : vertical > 1
        ? 'a vertical three-slice body'
        : 'a three-slice body';
  return `Draw the fixed detail, such as a crest or a tail, as its own sprite on ${body}.`;
}
