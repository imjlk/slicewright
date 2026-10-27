# Generic browser fixture

This small quest panel implements the same real interaction in HTML/CSS and Canvas.
Serve this directory over HTTP, then open `?renderer=dom` or `?renderer=canvas`.
The panel uses the generated guild frame from `examples/content-preview`; text lives
in an explicitly authored content region, separate from the frame's ornamentation.

Hover, press, and release the action to accept the quest. Clicking again increments
the visible count. The native button and the focused Canvas also accept keyboard
input. The app never exposes a state setter to tests.

The DOM targets are `#panel` and `#action`. Named panel content is `#title`, `#body`,
`#action`, and `#status`, inside `#content`. The action's content is `#action-label`
inside `#action-content`. A browser test waits for `window.browserE2EFixture.ready`.
For Canvas, `window.browserE2EFixture.measure('panel' | 'action')` returns viewport
CSS-pixel bounds and text rectangles measured with the same `TextMetrics` used to
paint each line. `getState()` observes application and painted state; it cannot set
either one. These globals belong to this fixture, not to the Slicewright API.

The panel adapts to viewport width and Canvas uses the current device pixel ratio.
Add `&scroll=1` to put it below the initial viewport. Independently injectable
negative controls are available through `&fault=...`:

- `missing-handler`: the activation handler does nothing.
- `stale-paint`: application state advances but painting remains at its last state.
- `shift`: activation moves the action label twelve pixels to the right.
- `clipping`: activation clips the status text to an eight-pixel-high box.
- `overlay`: a transparent sibling intercepts pointer input over the action.

The last three checks need geometry, fit, or visible-state assertions; observing an
application counter alone cannot prove that the UI works. The repository's packed
consumer harness uses the published `slicewright/browser` entry point to verify the
same scenario for both renderers without private test utilities.
