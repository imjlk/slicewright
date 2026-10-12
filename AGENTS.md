# Agent Instructions

slicewright prompts, inspects, and previews nine-slice and three-slice game UI
art. It is a CLI, a library, and an agent skill (`skills/slicewright`).

## Toolchain

- TypeScript 7 through `ttsc`. Run TypeScript entry points with `ttsx`, never
  `tsx` or `ts-node`.
- Lint and format with `@ttsc/lint` only. `lint.config.js` is the single lint
  config; do not add ESLint or Prettier.
- typia validates untrusted JSON (atlases). Prefer a typia call over a
  hand-written shape check.
- Use the `ttsc-graph` MCP server (`.mcp.json`) before broad source
  exploration.

## Spec and evidence

`docs/spec.md` is the contract. Each H2 is a requirement that `@ttsc/evidence`
enforces in `pnpm check`:

- Behavior changes start in `docs/spec.md`.
- An exported function in `src/` and an exported test function in
  `test/*.test.ts` must each cite every H2 with `@evidence docs/spec.md#<slug> <why>`.
- Every citation carries `@evidenceReview docs/spec.md#<slug> #<fingerprint>
  <what you checked>`. The fingerprint comes from the build error and expires
  when the section changes; re-check the code before renewing it. Write only
  what you actually read or ran. Never add a tag just to clear an error; fix
  the code or the spec instead.

## Code boundaries

- The core works on straight-alpha RGBA8 `Raster` values and stays pure
  TypeScript. Do not add native image dependencies to the core; put any future
  heavy image backend behind an optional adapter.
- slicewright does not call image generation APIs. Prompt planning produces
  text; generation belongs to the agent's own tools.
- The CLI uses gunshi. Commands print JSON to stdout only (the gunshi header
  stays off) and keep exit codes: 0 ok, 1 error findings, 2 usage or input
  failure.
- Detection produces an engine-neutral `SliceLayout`; renderers and targets
  read only the layout. Engine specifics live in `src/targets/`, declared
  through capabilities. See `docs/extending.md` before adding a layout
  feature or a target.
- Behavior is judged on real generated art too, not only fixtures: rerun
  `pnpm engine:check` and look at `preview` sheets for `examples/real` after
  detection changes.

## Commands

- `pnpm check`
- `pnpm test`
- `pnpm build`
- `pnpm fix`
- `pnpm examples` regenerates `examples/*.png` from the test fixtures.
- `pnpm engine:check` renders `examples/real` in Phaser 4 and CSS through headless Chrome.

## Releasing

- The version lives in `package.json`. A release PR bumps it and adds a short
  entry to `CHANGELOG.md`; after it merges, push a `v<version>` tag on `main`.
- `.github/workflows/release.yml` publishes on the tag through npm Trusted
  Publishing (OIDC, with provenance). It refuses a tag that does not match
  `package.json`. `prepublishOnly` runs check, test, and build.
- The first version is published once by hand by the maintainer
  (`npm publish` with their own npm login); then configure this workflow as
  the package's Trusted Publisher on npmjs.com before relying on tags.
