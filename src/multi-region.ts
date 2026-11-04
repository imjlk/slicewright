/**
 * The single-region body that still resizes on the same axes as a multi layout.
 *
 * @evidence docs/spec.md#multiple-stretch-regions Picks a nine-slice when both axes resize, a three-slice when only the width does, and a vertical three-slice when only the height does.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #e448018 Reread the three body cases and checked this function returns those names.
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
 * @evidence docs/spec.md#multiple-stretch-regions Names the separate-sprite body from which axes still resize, and the --mode flag when that body is not a nine-slice.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #e448018 Reread the mode-flag rule. A three-slice body names --mode three, a vertical three-slice names --mode three-vertical, both include normalize, and a nine-slice names no flag.
 */
export function multiRegionRemedy(horizontal: number, vertical: number): string {
  const body = multiRegionBody(horizontal, vertical);
  const mode =
    body === 'three-slice'
      ? 'three'
      : body === 'vertical three-slice'
        ? 'three-vertical'
        : undefined;
  const flag =
    mode === undefined
      ? ''
      : ` Pass --mode ${mode} on later inspect, normalize, preview, and export of that body, or detection reads a nine-slice again.`;
  return `Draw the fixed detail, such as a crest or a tail, as its own sprite on a ${body} body.${flag}`;
}
