# Review, approve and compare a responsive browser UI

A small cream-and-wood letter panel is implemented in HTML/CSS and Canvas. The
same test checks four viewport/language/text-size combinations and a real click
in Chromium, Firefox and WebKit. Decoration has no text; title, body, action and
status each have explicit measured content regions. Both renderers expose a
named button and a live status region; Canvas maintains those DOM semantics
explicitly alongside its painted content.

Use Node 22+ and Slicewright 0.5+. Copy this directory into your project, then:

```sh
npm install
npx playwright install chromium firefox webkit
npm run preview
```

Review `http://127.0.0.1:4179/` with `renderer=dom|canvas`, `locale=en|ko` and
`scale=1|2` query parameters. Inspect both 360 px and 900 px viewport widths,
including the collected-letter state. The test viewport height is 1200 px.
The test covers the two languages at ordinary and doubled text sizes; this is
an example matrix to adapt, not a claim to cover every language or device.

Stop the preview server before running tests. If the port is occupied, set
`SLICEWRIGHT_EXAMPLE_PORT` to an available port for preview and test commands.
After reviewing the current design, explicitly approve its baseline captures:

```sh
npm run approve
npm test
```

Approval writes manifests and content-addressed PNGs under
`baselines/<platform>/<browser>/`. Commit both file types. Ordinary tests only
read these files; missing baselines fail. `npm test -- --update-snapshots` still
does not approve Slicewright baselines. Keep `npm run approve` out of ordinary CI;
it explicitly accepts the currently rendered version of every selected case.
Use Playwright's `--grep` and `--project` to limit either command when needed.

The environment key includes the exact browser version, platform, viewport,
DPR, language, text scale and an explicit font-environment label. Use matching
browser builds and system images for approval and regression. Replace
`system-fonts-v1` with your own font bundle/image identifier; the library cannot
infer font equivalence. Browser upgrades require review and explicit approval.

To see a real regression without changing your baselines, set
`SLICEWRIGHT_EXAMPLE_FAULT=paint` and run `npm test`. Collecting a letter then
changes the frame color. The matcher fails and attaches actual/reference/diff
images, assertion JSON and an offline HTML report under `test-results/`. Restore
the application or review the intentional design change before approving again.
The repository's consumer check runs this negative control automatically.

Canvas measurements come from the same glyph metrics and layout used to draw
its text. They are supplied by the example application; Slicewright does not
infer text or accessibility from pixels. Each renderer has its own baseline;
DOM and Canvas are not required to rasterize text identically.

Windows Firefox runs use an explicit regional pixel policy for the approved
text rectangles: mean error at most 0.01, p99 0 and maximum 32 for Canvas or 40
for DOM, on the 0–255 channel scale. CI captures exhibited three changed Canvas
glyph-edge pixels (maximum 14) and 57 changed DOM glyph-edge pixels (maximum 37,
regional mean 0.008991), with identical measurements, alpha and outside pixels.
The example requires exact measurements and capture bounds, exact alpha, and
exact pixels outside those approved rectangles. Other platforms and engines
stay pixel-exact. These small budgets can also admit a real change inside a
text region; review them for your fonts rather than copying a whole-image
tolerance. The frame color negative control must still fail outside the allowed
text regions.
