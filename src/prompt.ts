import type { SliceMode } from './slices.js';

export type UiKind = 'button' | 'panel' | 'dialog' | 'bar' | 'tooltip' | 'frame';
export type PromptBackground = 'transparent' | 'chroma-green' | 'chroma-magenta';

export const uiKinds: readonly UiKind[] = ['button', 'panel', 'dialog', 'bar', 'tooltip', 'frame'];
export const promptBackgrounds: readonly PromptBackground[] = [
  'transparent',
  'chroma-green',
  'chroma-magenta',
];

export interface PromptRequest {
  readonly kind: UiKind;
  /** Art direction in the user's words, for example "hand-painted fantasy wood". */
  readonly style: string;
  readonly background: PromptBackground;
  readonly pixelArt: boolean;
}

export interface PromptPlan {
  readonly kind: UiKind;
  readonly mode: SliceMode;
  readonly aspect: string;
  readonly prompt: string;
  readonly avoid: readonly string[];
  readonly afterGeneration: readonly string[];
}

interface KindPreset {
  readonly subject: string;
  readonly mode: SliceMode;
  readonly aspect: string;
  readonly structure: string;
}

const presets: Readonly<Record<UiKind, KindPreset>> = {
  button: {
    subject: 'a single game UI button background',
    mode: 'nine',
    aspect: '2:1',
    structure: 'a rounded rectangle with a clear bevel or rim; the face is one flat color or a very soft top-to-bottom shade',
  },
  panel: {
    subject: 'a single game UI panel background',
    mode: 'nine',
    aspect: '1:1',
    structure: 'a framed rectangle with an ornamented border; the inner area is one flat fill',
  },
  dialog: {
    subject: 'a single game UI dialog window background without a title bar',
    mode: 'nine',
    aspect: '4:3',
    structure: 'a thick decorated frame with corner ornaments; the content area is calm and flat so text stays readable',
  },
  bar: {
    subject: 'a single horizontal game UI bar, such as a progress or health bar track',
    mode: 'three',
    aspect: '4:1',
    structure: 'rounded or capped left and right ends; the middle is one continuous horizontal strip that may shade from top to bottom',
  },
  tooltip: {
    subject: 'a single small game UI tooltip box background',
    mode: 'nine',
    aspect: '3:2',
    structure: 'a thin outline with small rounded corners; the fill is one flat color',
  },
  frame: {
    subject: 'a single game UI picture frame border',
    mode: 'nine',
    aspect: '1:1',
    structure: 'an ornamented border whose center is empty and fully transparent',
  },
};

const backgroundLines: Readonly<Record<PromptBackground, string>> = {
  transparent: 'Transparent background; nothing outside the element.',
  'chroma-green':
    'Solid pure green (#00FF00) background filling everything outside the element; no green anywhere on the element itself.',
  'chroma-magenta':
    'Solid pure magenta (#FF00FF) background filling everything outside the element; no magenta anywhere on the element itself.',
};

/**
 * Plans a generation prompt that asks for art which survives stretching.
 * Image models do not hit exact pixel sizes, so the prompt asks for
 * structure and the inset numbers come from inspection afterwards.
 *
 * @evidence docs/spec.md#generation-prompts Builds the structural prompt, the avoid list, three-slice bars, and the follow-up steps.
 * @evidenceReview docs/spec.md#generation-prompts #e17218a Checked this code against the section line by line and ran plansGenerationPrompts green with pnpm test.
 */
export function buildPromptPlan(request: PromptRequest): PromptPlan {
  const preset = presets[request.kind];
  const stretch =
    preset.mode === 'three'
      ? 'It will be stretched horizontally only: the middle strip must look identical at every horizontal position.'
      : 'It will be stretched horizontally and vertically: the top and bottom edges must look identical at every horizontal position, the left and right edges identical at every vertical position.';
  const lines = [
    `${capitalize(preset.subject)}, ${request.style.trim()}.`,
    `Shape: ${preset.structure}.`,
    'Flat front view, no perspective, centered and filling the canvas edge to edge with only a few pixels of margin.',
    preset.mode === 'three'
      ? 'Put all decoration in the two end caps. The middle is plain along its length: no wood grain or texture running along the bar, and no repeated motifs.'
      : 'Put all decoration in the four corners. Between the corners the edges are plain smooth bands with no pattern along them: no wood grain or texture running along the edge, no rope, chain, beads, vines, rivets, or repeated motifs.',
    stretch,
    'No text, letters, icons, symbols, or characters on it.',
    request.pixelArt
      ? 'Crisp pixel art on a consistent pixel grid, hard edges, no anti-aliasing, no blur.'
      : 'Clean edges, no blur, no noise or grain.',
    backgroundLines[request.background],
  ];
  const afterGeneration = [
    request.background === 'transparent'
      ? 'Confirm the PNG really has an alpha channel; regenerate if the background is baked in.'
      : 'Remove the chroma background and despill the edge before inspecting.',
    'Crop transparent margins.',
    'Downscale to the target UI size before slicing; pick insets at the final size.',
    'Run `slicewright inspect` and fix every error.',
    'Run `slicewright preview` and look at the stretched sizes.',
    'Pack it untrimmed, then run `slicewright atlas` on the atlas.',
  ];
  return {
    kind: request.kind,
    mode: preset.mode,
    aspect: preset.aspect,
    prompt: lines.join('\n'),
    avoid: [
      'text or icons on the element',
      'drop shadows or glows outside the element',
      'perspective, tilt, or 3D camera angles',
      'gradients or patterns along a stretch direction',
      'decoration in the middle of an edge',
      'rope, chain, bead, or vine patterns running along the edges',
      'multiple elements or variants in one image',
      'background scenery',
    ],
    afterGeneration,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
