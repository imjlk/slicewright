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

Releases go through Sampo (`.sampo/config.toml`), as in mpgd-kit:

- A PR that changes the published package's behavior, public API, CLI, skill,
  or package metadata adds a changeset in `.sampo/changesets/` (`pnpm
  sampo:add`, or a file with `npm/slicewright: patch|minor|major` front matter
  and a user-facing description; `patch (Fixed)` style tags pick the changelog
  section). Docs-only, CI-only, and example-only PRs need none; say so in the
  PR summary.
- After CI passes on `main`, `.github/workflows/release.yml` runs Sampo: with
  pending changesets it opens or updates the release PR (`release/main`),
  which bumps `package.json` and `CHANGELOG.md`; never edit those two by hand
  for a release.
- Merging the release PR publishes to npm through Trusted Publishing (OIDC,
  with provenance; `prepublishOnly` runs check, test, and build) and creates
  the `v<version>` tag and GitHub release. Merge the release PR after the
  other PRs meant for that release.
- 0.1.0 was published by hand; npm already lists this repository's
  `release.yml` as the package's Trusted Publisher.
