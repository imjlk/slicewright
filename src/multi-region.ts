/**
 * What to do with fixed detail that sits between stretch regions.
 * The `regions.multi` finding and a multi layout's export error both end with this.
 *
 * @evidence docs/spec.md#multiple-stretch-regions States the separate-sprite remedy for fixed detail a multi-region layout cannot export.
 * @evidenceReview docs/spec.md#multiple-stretch-regions #30d2f92 Reread the remedy sentence and checked this function returns that separate-sprite wording unchanged.
 */
export function multiRegionRemedy(): string {
  return 'Draw the fixed detail, such as a crest or a tail, as its own sprite on a nine-slice or three-slice body.';
}
