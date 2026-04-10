# VSIX Packaging Ignore Design

## Goal

Reduce the shipped VSIX contents to runtime assets only by tightening `.vscodeignore`, without changing the existing bundling pipeline.

## Current State

The extension already bundles its runtime entrypoint through `esbuild` and publishes from `dist/extension.js`. Despite that, `vsce ls` currently reports 5,211 packaged files because the repository-level `.vscodeignore` does not exclude several large local-only directories and documentation trees.

The current package includes:

- local worktree snapshots under `.worktrees/**`
- raw screenshot captures under `.artifacts/**`
- internal docs under `docs/**`
- test code under `tests/**`
- build scripts under `scripts/**`
- repo-only metadata like `AGENTS.md`

These files are not needed at runtime and are the direct cause of the packaging warning.

## Recommended Approach

Keep the bundling contract unchanged and tighten `.vscodeignore` only.

This design intentionally does not add a `files` whitelist to `package.json`. The repo already has a working extension packaging path, and the fastest low-risk fix is to exclude the non-runtime trees that are currently leaking into the VSIX.

## Packaging Contract

The packaged VSIX should keep:

- `package.json`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `dist/**`
- `media/**`

The packaged VSIX should exclude:

- `.worktrees/**`
- `.artifacts/**`
- `docs/**`
- `tests/**`
- `scripts/**`
- `.github/**` if present
- repo policy files such as `AGENTS.md`
- other source-only or config-only files already covered by the existing ignore rules

## Implementation Scope

Files to modify:

- `.vscodeignore`

Files to inspect during verification:

- `package.json`
- `dist/**`
- `media/**`

No runtime code, build scripts, or extension behavior should change.

## Verification

The change is complete only when fresh packaging evidence shows the ignore rules are working:

1. Run `npx @vscode/vsce ls` before and after the `.vscodeignore` change.
2. Confirm the packaged file list no longer includes `.worktrees`, `.artifacts`, `docs`, `tests`, or `scripts`.
3. Run `npx @vscode/vsce package --no-dependencies` or the repo packaging command if equivalent, and confirm it succeeds.

## Risks

- Over-excluding runtime assets would break the shipped extension package.
- Under-excluding repo files would keep the packaging warning effectively unresolved.

The verification step is therefore package-content focused rather than test-suite focused.
