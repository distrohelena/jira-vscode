# Jira Icons From Jira Design

## Goal

Replace extension-owned issue icons with Jira-owned icons across both supported UI surfaces:

- the create/edit/details webviews
- the left Items tree

The extension should prefer Jira-provided icon URLs for issue status and issue type metadata, while retaining a narrow fallback path so the UI still renders when Jira does not provide an icon.

## Current State

The current implementation uses two unrelated icon systems:

- the issue details webview renders a local status image through `ViewResource.getStatusIconWebviewSrc`
- the Items tree renders VS Code `ThemeIcon` circles for issue status groups and issue rows

This produces two problems:

- the extension does not match the iconography shown in Jira itself
- the same issue can display with different icon styles depending on where it is shown

## External API Basis

Implementation must rely only on documented Jira REST fields:

- issue type payloads include `iconUrl`
- workflow status payloads include `iconUrl`

These fields are documented in Atlassian Jira Cloud REST references for issue types and workflow statuses. The implementation should use the icon URLs already present on issue and status data returned by the documented issue and search endpoints before adding any secondary lookup behavior.

## Design Overview

Use Jira-owned icon URLs as the canonical icon source, with a surface-specific rendering strategy:

- webviews render Jira icon URLs directly in `<img>` elements
- tree items resolve Jira icon URLs into a local on-disk cache, then use cached file URIs for `TreeItem.iconPath`

Fallback behavior remains available only when Jira does not provide an icon URL or an icon download fails.

## Data Model Changes

Extend the issue-facing types so icon URLs can flow through the existing model without UI classes inferring icon choices from status text.

`JiraIssue` should gain:

- `issueTypeIconUrl?: string`
- `statusIconUrl?: string`

`IssueStatusOption` should gain:

- `iconUrl?: string`

If a grouped tree node requires a representative icon for a status group, it should use the `iconUrl` captured for that status option or the first issue in that group with the same status.

## Jira Mapping Changes

The Jira transport layer should map icon URLs directly from the documented response objects when reading:

- issue details
- project issue search results
- issue transition/status option payloads
- project status metadata

Mapping rules:

- preserve Jira absolute URLs as returned
- prefer the status object `iconUrl` for status rendering
- prefer the issue type object `iconUrl` for issue type rendering
- do not rewrite URLs except where existing URL normalization is already required by the transport layer

## Webview Rendering

The create/edit/details webviews should stop depending on packaged status images for issue visuals where Jira data already contains icon URLs.

Behavior:

- the issue details header should render the Jira status icon, and may keep the issue type label text beside it
- parent ticket and related issue rows should render Jira type/status icons if those models already include them
- any create/edit ticket cards that display issue references should render the same Jira-provided icons

Layout constraints:

- keep icon dimensions fixed so switching from fallback to Jira icons does not move surrounding content
- reserve the same width and height whether the icon comes from Jira or a fallback asset
- keep alt text explicit for accessibility and testability

## Tree Rendering

The left tree should use Jira-owned icons while remaining reliable inside VS Code tree rendering.

Recommended behavior:

- add a dedicated icon cache service responsible for downloading and reusing Jira icon files
- cache by normalized source URL so repeated issues do not trigger repeated downloads
- expose a method that returns a `vscode.Uri` suitable for `TreeItem.iconPath`
- keep the existing theme or packaged fallback when the cache has no local file yet or download fails

The tree should not depend on remote HTTP image loading at render time. Once an icon is resolved, it should be read from the local cache.

## Cache Service Design

Add a focused service, for example `JiraIconCacheService`, with responsibilities limited to icon caching:

- derive a stable cache key from the Jira icon URL
- choose a deterministic file extension
- create the cache directory under extension storage
- download the icon bytes
- skip re-downloading when a cached file already exists
- return the cached local URI

Behavioral rules:

- failed downloads should not throw tree-wide rendering failures
- concurrent requests for the same URL should share in-flight work
- non-HTTP or invalid URLs should be rejected early and fall back cleanly
- cache writes should be atomic enough to avoid partially written files being reused

## Fallback Rules

Fallbacks are allowed only to preserve rendering continuity:

- webviews fall back to the current local status asset only when Jira provides no usable status icon URL
- issue rows without a Jira type icon can render text-only or the current fallback, but should not invent a new icon system
- tree items fall back to the existing `ThemeIcon` logic when no cached Jira icon is available

The extension should not silently prefer local assets over Jira icons when Jira data exists.

## Error Handling

Failure to load an icon must not block issue rendering, tree refreshes, or modal interactions.

Expected handling:

- log cache/download failures through the existing debug path if one is available
- keep the existing item visible with fallback iconography
- avoid repeated noisy retries during a single refresh cycle for a known failing URL

## Testing

Add regression coverage in three layers:

1. Node mapping tests
   - verify issue mapping captures `statusIconUrl`
   - verify issue mapping captures `issueTypeIconUrl`
   - verify status option mapping captures `iconUrl`

2. DOM rendering tests
   - verify issue details HTML prefers Jira icon URLs over local media URLs
   - verify icon markup preserves fixed dimensions and stable structure

3. Service tests
   - verify the icon cache service reuses an existing cached file
   - verify duplicate requests for the same URL share work
   - verify invalid or failed URLs return fallback behavior instead of throwing

Tree integration tests may remain focused on `iconPath` assignment rather than full download behavior if the cache service has direct unit coverage.

## Implementation Notes

Keep responsibilities separated:

- Jira transport maps data only
- cache service handles file acquisition only
- webview classes render supplied icon URLs only
- tree item classes request resolved local URIs only

This keeps the code aligned with the repository MVC guidance and avoids UI classes embedding transport or file-system logic.

## Acceptance Criteria

The feature is complete when all of the following are true:

- issue status icons shown in the webview come from Jira when Jira provides them
- issue type icons shown in the webview come from Jira when Jira provides them
- left tree issue and group icons use Jira-owned icons through a local cache path
- fallback rendering remains intact when Jira provides no icon or an icon cannot be cached
- icon rendering does not shift layout during interaction
- automated tests cover mapping, rendering, and caching behavior
