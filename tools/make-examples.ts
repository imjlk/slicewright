import { writeFileSync } from 'node:fs';

import { encodePng } from '../src/png.js';
import { panel, shadedBar } from '../test/fixtures.js';

// Regenerates the small sample images the README commands run against.
writeFileSync('examples/panel.png', encodePng(panel(48, 32, 2)));
writeFileSync('examples/bar.png', encodePng(shadedBar(64, 14)));
