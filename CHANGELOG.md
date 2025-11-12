# Changelog

All notable changes to this project will be documented in this file.

## 1.0.9

- Added an inline "Search recent items" row (and command palette entry) that filters your recent project items directly inside the Items tree.
- Changing an issue's assignee now requires confirming via the new OK button next to the assignee dropdown to prevent accidental reassignment.
- Issue details panel now shows a full description card ahead of related issues, preserving rich Jira formatting.
- Added complete Jira comment support (view, refresh, add with wiki/plain formats, and delete) directly inside the issue details webview.

## 1.0.0

- Added Projects, Items, and Settings tree views with focus and authentication commands.
- Implemented refresh buttons for Projects and Items, plus contextual commit helpers.
- Introduced issue details webview with status transitions, assignee management (lazy-loaded, searchable assignee lists), and status-specific icons.
- Added ticket creation panel with summary/description/issue type/starting status, including automatic post-create status transition.
- Swapped all SVG assets for PNGs to satisfy VSCE policies and added bundling via esbuild with `.vscodeignore` refinements.
- Documented workflows in README and AGENTS, added MIT license file.

## 0.0.1

- Initial release scaffolding, build scripts, and VS Code contribution setup.
