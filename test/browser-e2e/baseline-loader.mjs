import { ok } from 'node:assert/strict';

import { loadBrowserBaseline } from 'slicewright/browser';

// Executed in a separate Node process in the freshly installed consumer. The
// public loader must reconstruct the reference without its original snapshot.
const [, , path, environment] = process.argv;
ok(path && environment, 'Supply a baseline path and environment key.');
const snapshot = await loadBrowserBaseline(path, { environment });
process.stdout.write(JSON.stringify({
  measurement: snapshot.measurement,
  ...(snapshot.rendering === undefined ? {} : { rendering: snapshot.rendering }),
  clip: snapshot.clip,
  raster: {
    width: snapshot.raster.width,
    height: snapshot.raster.height,
    rgba: Buffer.from(snapshot.raster.data).toString('base64'),
  },
}));
