import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base } from '@playwright/test';
import { domTarget, regionTarget } from 'slicewright/browser';

const directory = dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

export const test = base.extend({
  fixtureUrl: [async ({}, use) => {
    const server = createServer((request, response) => {
      void (async () => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const file = resolve(directory, `.${decodeURIComponent(pathname)}`);
        if (!file.startsWith(directory + sep)) {
          response.writeHead(404).end();
          return;
        }
        try {
          response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
          response.end(await readFile(file));
        } catch {
          response.end();
        }
      })().catch((error) => response.destroy(error));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Fixture server did not bind a port.');
      }
      await use(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise((done) => server.close(done));
    }
  }, { scope: 'worker' }],
});

export async function delayedTarget(page, fixtureUrl, renderer = 'dom', delay = 650) {
  await page.goto(`${fixtureUrl}/delayed.html?renderer=${renderer}&delay=${delay}`);
  if (renderer === 'dom') {
    return domTarget(page, {
      root: page.locator('#target'),
      contentBox: page.locator('#label'),
      content: { label: page.locator('#label') },
    });
  }
  return regionTarget(page, { measure: () => page.evaluate(() => window.delayedFixture.measure()) });
}

export async function exampleTargets(page, fixtureUrl, renderer) {
  await page.goto(`${fixtureUrl}/fixture/index.html?renderer=${renderer}`);
  await page.evaluate(async () => { await window.browserE2EFixture.ready; });
  if (renderer === 'dom') {
    return {
      panel: domTarget(page, {
        root: page.locator('#panel'),
        contentBox: page.locator('#content'),
        content: Object.fromEntries(['title', 'body', 'action', 'status'].map(
          (name) => [name, page.locator(`#${name}`)],
        )),
      }),
      action: domTarget(page, { root: page.locator('#action') }),
    };
  }
  const target = (id) => regionTarget(page, {
    prepare: () => page.locator('#panel').scrollIntoViewIfNeeded(),
    measure: () => page.evaluate((name) => window.browserE2EFixture.measure(name), id),
  });
  return { panel: target('panel'), action: target('action') };
}

export function observed(target) {
  const state = { captures: 0, actions: 0 };
  return {
    state,
    target: {
      ...target,
      async capture() { state.captures++; return target.capture(); },
      async click() { state.actions++; await target.click(); },
      async hover() { state.actions++; await target.hover(); },
      async press() { state.actions++; await target.press(); },
      async release() { state.actions++; await target.release(); },
    },
  };
}

export async function probe(testInfo, value) {
  await testInfo.attach('consumer-probe', {
    body: JSON.stringify(value), contentType: 'application/json',
  });
}
