/** Fixed border sizes in pixels; everything between them stretches. */
export interface SliceInsets {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** `three` keeps the height (Phaser's three-slice); `three-vertical` keeps the width. */
export type SliceMode = 'nine' | 'three' | 'three-vertical' | 'multi';

/** Phaser's stretchable center rectangle, in frame coordinates. */
export interface Scale9Borders {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Returns why the insets cannot slice an image of this size, or undefined.
 *
 * @evidence docs/spec.md#slice-insets Enforces non-negative integer insets that leave at least one stretch pixel per axis.
 * @evidenceReview docs/spec.md#slice-insets #5f061b0 Checked this code against the section line by line and ran rejectsInsetsWithoutAStretchSpan green with pnpm test.
 */
export function insetsProblem(
  insets: SliceInsets,
  width: number,
  height: number,
): string | undefined {
  for (const [name, value] of Object.entries(insets)) {
    if (!Number.isInteger(value) || value < 0) {
      return `${name} inset must be a non-negative integer, got ${value}.`;
    }
  }
  if (insets.left + insets.right >= width) {
    return `left + right (${insets.left + insets.right}) must be smaller than the width ${width}.`;
  }
  if (insets.top + insets.bottom >= height) {
    return `top + bottom (${insets.top + insets.bottom}) must be smaller than the height ${height}.`;
  }
  return undefined;
}

/**
 * @evidence docs/spec.md#three-slice A layout with zero top and bottom insets is a three-slice.
 * @evidenceReview docs/spec.md#three-slice #08c1617 Checked this code against the section line by line and ran treatsShadedBarsAsThreeSlices green with pnpm test.
 */
export function isThreeSlice(insets: SliceInsets): boolean {
  return insets.top === 0 && insets.bottom === 0;
}

/**
 * @evidence docs/spec.md#phaser-scale9borders Converts insets into Phaser's center rectangle.
 * @evidenceReview docs/spec.md#phaser-scale9borders #4aec64c Checked this code against the section line by line and ran convertsToPhaserBorders green with pnpm test.
 */
export function insetsToScale9Borders(
  insets: SliceInsets,
  width: number,
  height: number,
): Scale9Borders {
  return {
    x: insets.left,
    y: insets.top,
    w: width - insets.left - insets.right,
    h: height - insets.top - insets.bottom,
  };
}

/**
 * @evidence docs/spec.md#phaser-scale9borders Converts Phaser's center rectangle back into insets, as Phaser's NineSlice does.
 * @evidenceReview docs/spec.md#phaser-scale9borders #4aec64c Checked this code against the section line by line and ran convertsToPhaserBorders green with pnpm test.
 */
export function scale9BordersToInsets(
  borders: Scale9Borders,
  width: number,
  height: number,
): SliceInsets {
  return {
    left: borders.x,
    right: width - borders.w - borders.x,
    top: borders.y,
    bottom: height - borders.h - borders.y,
  };
}

/** Parses `left,right,top,bottom`, or `horizontal,vertical`, or one value for all four. */
export function parseInsets(text: string): SliceInsets {
  const values = text.split(',').map((part) => Number(part.trim()));
  if (values.some((value) => !Number.isInteger(value))) {
    throw new Error(`Insets must be integers: ${text}`);
  }
  const [a = 0, b = a, c, d] = values;
  if (values.length === 1 || values.length === 2) {
    return { left: a, right: a, top: b, bottom: b };
  }
  if (values.length === 4) {
    return { left: a, right: b, top: c ?? 0, bottom: d ?? 0 };
  }
  throw new Error(`Insets take 1, 2, or 4 values: ${text}`);
}

/** Parses Phaser-style `x,y,w,h` borders. */
export function parseBorders(text: string): Scale9Borders {
  const values = text.split(',').map((part) => Number(part.trim()));
  const [x, y, w, h] = values;
  if (
    values.length !== 4 ||
    x === undefined ||
    y === undefined ||
    w === undefined ||
    h === undefined ||
    values.some((value) => !Number.isInteger(value))
  ) {
    throw new Error(`Borders take four integers x,y,w,h: ${text}`);
  }
  return { x, y, w, h };
}
