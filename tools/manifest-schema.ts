// Writes schema/build-manifest.schema.json from the BuildManifest type.
import { writeFileSync } from 'node:fs';

import { buildManifestSchema } from '../src/manifest-schema.js';

const path = new URL('../schema/build-manifest.schema.json', import.meta.url);
writeFileSync(path, `${JSON.stringify(buildManifestSchema(), null, 2)}\n`);
process.stdout.write(`Wrote ${path.pathname}\n`);
