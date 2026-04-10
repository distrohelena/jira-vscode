# VSIX Packaging Ignore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the VSIX package to runtime assets only by tightening `.vscodeignore`, while leaving the existing `esbuild` bundling flow unchanged.

**Architecture:** Keep the packaging contract narrow and explicit. The change lives entirely in `.vscodeignore`, with verification based on fresh `vsce` package listings before and after the update so we can prove that local worktrees, screenshots, tests, docs, and scripts are no longer shipped.

**Tech Stack:** VS Code extension packaging (`@vscode/vsce`), `.vscodeignore`, PowerShell verification commands

---

## File Structure

**Modify:**
- `.vscodeignore`
  - Exclude local-only repository content that should never ship in the VSIX while preserving `dist/**`, `media/**`, and the standard manifest/readme/license files.

**Inspect During Verification:**
- `package.json`
  - Confirm the runtime entrypoint remains `dist/extension.js` and that no packaging logic changes are required.
- `dist/**`
  - Confirm the bundled extension output remains packaged.
- `media/**`
  - Confirm icons and README screenshots remain packaged.

**No new runtime code or test files are expected.**

### Task 1: Tighten `.vscodeignore` To Exclude Non-Runtime Content

**Files:**
- Modify: `.vscodeignore`

- [ ] **Step 1: Capture the current packaging leak baseline**

Run the package listing and filter for files that should not ship:

```powershell
npx @vscode/vsce ls | Select-String '^(\\.worktrees/|\\.artifacts/|docs/|tests/|scripts/|AGENTS\\.md$)'
```

Expected: output contains matches such as `.worktrees/...`, `.artifacts/...`, `docs/...`, `tests/...`, `scripts/esbuild.mjs`, or `AGENTS.md`, proving the VSIX is currently packaging repository-only content.

- [ ] **Step 2: Update `.vscodeignore` with the missing repository-only exclusions**

Extend `.vscodeignore` by adding these entries below the existing ignore rules:

```gitignore
.worktrees/**
.artifacts/**
docs/**
tests/**
scripts/**
.github/**
AGENTS.md
```

Keep the existing runtime-safe rules intact so the package still includes:

```text
package.json
README.md
CHANGELOG.md
LICENSE
dist/**
media/**
```

- [ ] **Step 3: Re-run the filtered package listing to verify the leaked directories are gone**

Run:

```powershell
npx @vscode/vsce ls | Select-String '^(\\.worktrees/|\\.artifacts/|docs/|tests/|scripts/|AGENTS\\.md$)'
```

Expected: no output. If any line still appears, fix `.vscodeignore` before proceeding.

- [ ] **Step 4: Verify the runtime assets are still present in the package listing**

Run:

```powershell
npx @vscode/vsce ls | Select-String '^(package\\.json|README\\.md|CHANGELOG\\.md|LICENSE|dist/|media/)'
```

Expected: output includes `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `dist/extension.js`, `dist/webview/rich-text-editor.js`, and the needed `media/...` assets.

- [ ] **Step 5: Build the VSIX to confirm packaging still succeeds**

Run:

```powershell
npx @vscode/vsce package --no-dependencies
```

Expected: command exits successfully and creates a `.vsix` package using the reduced file set. The generated `.vsix` file remains ignored by the existing `*.vsix` rule.

- [ ] **Step 6: Commit the packaging ignore change**

```bash
git add .vscodeignore
git commit -m "build: exclude non-runtime files from VSIX"
```
