import { mkdirSync, writeFileSync } from 'node:fs';

import { encodePng } from '../src/png.js';
import { panel, ropePanel, shadedBar } from '../test/fixtures.js';

// Regenerates the small sample images the README commands run against.
mkdirSync('examples/tiled', { recursive: true });
writeFileSync('examples/panel.png', encodePng(panel(48, 32, 2)));
writeFileSync('examples/bar.png', encodePng(shadedBar(64, 14)));
// An exactly periodic edge, so the engine check exercises tiled exports.
writeFileSync('examples/tiled/rope.png', encodePng(ropePanel(120, 48)));
