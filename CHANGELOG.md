# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Added `Search Commit History` on Jira issues, using the repository currently selected in Source Control.
- Commit history search now scans local Git commit messages for the Jira issue key and summary, shows matches in a picker, and opens the selected commit details.

## 1.0.31

- Added a Notifications view that keeps a local `My Activity` history from supported Jira issue, comment, and changelog APIs.
- Reworked notifications into a bounded feed for issues related to the current user, surfacing mentions, assignment changes, and comment or status activity without the earlier broad crawl.
- Creating a ticket now keeps the create panel open and reveals the new issue in the Items tree.

## 1.0.29

- Added comment reply actions in the issue panel. Replies are posted as standard Jira comments with reply context preserved in the comment body.

## 1.0.28

- `Commit from Issue` now writes to the Git repository currently selected in Source Control instead of always targeting the first repository.
- Items tree groups now preserve their expanded state across refreshes, including refreshes triggered by ticket creation or issue updates.

## 1.0.27

- Refactored the extension around a reusable Jira API layer.
- Renamed internal `jira-api` module paths and tightened package-level documentation and structure.
- No major user-facing workflow changes were introduced in this release.

## 1.0.26

- Added automatic API key validation warnings across Jira views.
- Fixed issue panel inline editing regressions.
- Added broader automated coverage for issue-panel editing behavior.

## 1.0.25

- Added Jira-driven additional fields to the create-issue workflow.
- Fixed inline-editing issues in the create and issue-detail flows.

## 1.0.24

- Refined assignee presentation so the current assignee name and avatar align cleanly in the issue details panel.

## 1.0.23

- Improved visual description editing.
- Cleaned up title hover behavior in the issue details panel.

## 1.0.22

- Added reporter details to the issue panel.
- Fixed description editor prefill behavior.

## 1.0.21

- Added inline description editing.
- Polished the rich text editor used by the issue panel.

## 1.0.20

- Added inline summary editing.
- Introduced a reusable rich text editor for Jira content.
- Added a dedicated Jira-backed search action alongside the local Items filter.
- Standardized issue comment posting on Jira wiki format.

## 1.0.19

- Improved the issue header and assignee action layout.
- Added `Last Update` as an Items sort option.
- Fixed inconsistent row alignment in the Items tree.

## 1.0.18

- Added `Load More` paging in the Items view for large result sets.

## 1.0.17

- Replaced `Show Recent` with `Show Assigned` for active items assigned to the current user.
- Added the third Items mode, `Unassigned`.
- Made the Items filter local and instant.
- Improved create-issue assignee and status UX.
- Kept the create-issue form state when the panel is hidden.
- Updated `Show All` to load the full project issue list instead of a short first page.
- Closed the new-ticket panel immediately after successful creation.
- Improved create-ticket layout on narrow screens.
- Added a VSIX packaging script and switched Jira search and paging flows to documented endpoints.

## 1.0.12 - 1.0.13

- Added `Group By` support in the Items view.
- Reused existing issue panels instead of opening duplicates for the same issue.
- Added clearer loading states while issue panels refresh.

## 1.0.11

- Prefetched project statuses per issue type plus transitions for every status so issue detail dropdowns unlock immediately even on first open.
- Warmed the transition cache for items already displayed in the Items view.
- Projects view `Show All` now fetches every accessible project instead of stopping at the first 50 results from Jira.
- Added a Favorites tab to the Projects view, including Recent, All, and Favorites modes plus context menu actions to star or unstar projects.
- VSIX packaging now excludes nested workspace artifacts so the extension ships only the bundled output and required assets.

## 1.0.9

- Added an inline search row that filters recent items directly inside the Items tree.
- Changing an issue assignee now requires explicit confirmation with an `OK` button.
- Issue details now show a full description card ahead of related issues.
- Added full Jira comment support directly inside the issue details webview.
- Items view badge now reflects the count of in-progress issues.
- Removed the project count badge so the activity badge emphasizes issue activity only.

## 1.0.0

- Added Projects, Items, and Settings tree views with focus and authentication commands.
- Implemented refresh buttons for Projects and Items, plus contextual commit helpers.
- Introduced the issue details webview with status transitions, assignee management, and status-specific icons.
- Added the create-ticket panel with summary, description, issue type, and starting status, including automatic post-create transition.
- Swapped SVG assets for PNGs to satisfy VSCE policies and added bundling via esbuild with `.vscodeignore` refinements.
- Documented workflows in the README and AGENTS files and added the MIT license.

## 0.0.1

- Initial release scaffolding, build scripts, and VS Code contribution setup.
