# AGENTS.md

This document captures the key decisions and patterns discussed while building the Jira VS Code extension in this workspace. Future agents can use it as a quick-start reference when continuing development.

## Extension Overview
- TypeScript-based VS Code extension that integrates Jira Cloud and Server instances.
- Provides three tree views (Projects, Items, Settings) plus an issue detail webview and ticket creation workflow.
- Bundled with esbuild into `dist/extension.js`; TypeScript sources are excluded via `.vscodeignore`.

## Tooling & Build
- **Install dependencies:** `npm install`
- **Bundle/build:** `npm run compile` (runs esbuild, outputs `dist/extension.js` and sourcemap).
- **Watch mode:** `npm run watch` for esbuild watch.
- **Testing:** Currently manual; run the extension via VS Code's Extension Development Host.
- Keep `.vscodeignore` in sync to avoid shipping TS sources, node modules, etc.

## Assets & Marketplace Requirements
- Only PNG icons are included (no SVG) to satisfy VSCE security checks.
- Extension icon: `media/jira.png`; view icon: `media/items.png`; status icons: `media/status-*.png`.
- `package.json` includes `galleryBanner`, `icon`, and keywords; categories limited to supported values (e.g., `Other`).

## Key Features Recap
- **Projects View:** Lists accessible Jira projects; includes refresh button and focus commands.
- **Items View:** Shows issues grouped by status, with toolbar actions for refresh and ticket creation.
- **Issue Panel:** Webview for details, status transitions, and assignee changes (assignee list is lazy-loaded and searchable on Enter).
- **Ticket Creation:** `+ Ticket` button opens webview form for summary/description/issue type/status.
- **Git Commit Helper:** Context menu action fills the SCM input (`ISSUE-KEY: `).

## Process Guidelines
- Never make large or high-impact changes—such as removing dependencies, adding new packages, or altering primary features—without first confirming the approach with the team.
- Structure new extension functionality following an MVC-style separation (data/model handling, view rendering, controller/command wiring) to keep the codebase consistent.

## Assignee Search Logic
- Assignee dropdown fetches data only when the search query changes or user presses Enter in the search box.
- Frontend posts `loadAssignees` messages with `issueKey` and `query`; backend caches the last query in panel state to avoid redundant calls.

## Deployment Notes
- Use `vsce package` / `vsce publish` after running `npm run compile`.
- Ensure `README.md`, `CHANGELOG.md`, and `LICENSE` stay accurate (extension uses MIT license).
- Monitor `package.json` versioning and publisher info before release.

## Outstanding Considerations
- No automated tests yet; manual validation is recommended.
- Assignee list currently restricted to 50 results; adjust if pagination becomes necessary.
- Consider adding telemetry or configuration options for large tenants if needed.
