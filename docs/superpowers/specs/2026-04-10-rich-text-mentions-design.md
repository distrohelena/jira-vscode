# Rich Text Mentions Design

## Summary

This design adds shared `@mention` support to every existing shared rich text editor host in the Jira webview. Typing `@` in visual mode opens a compact people picker, selecting a person inserts a structured mention node, and submit uses real Jira rich-text payloads so Jira can resolve the mention as an actual user mention instead of plain `@Name` text.

This feature changes one important editor contract: wiki mode is no longer an editable fallback. It becomes read-only wiki visualization. That keeps the visual editor as the only editable source of truth and avoids destroying structured mention identity when a user switches views.

## Goals

- Add one shared `@mention` experience across all current shared rich text hosts.
- Insert real Jira mentions that preserve stable user identity and allow Jira to notify the selected user.
- Rank local issue participants first, then expand results with project-assignable users.
- Keep mention behavior stable with keyboard navigation, mouse selection, and existing formatting behavior.
- Make wiki mode a read-only visualization surface so mentions do not degrade into fake plain text.
- Submit official Jira Cloud rich-text payloads for shared rich text content in this phase.

## Non-Goals

- No group mentions, team mentions, emoji picker, slash commands, or inline reaction behavior.
- No support for plain textarea fields that do not use the shared rich text editor.
- No editable raw wiki authoring surface in this phase.
- No automatic conversion of pasted `@Name` text into real mentions.
- No attempt to mention arbitrary users without project context.

## Current Problem

The shared editor now behaves more predictably, but it still has no real mention flow. Today, the rich text system serializes back to Jira wiki strings, which cannot safely represent a structured Jira user mention with a stable account id. If we tried to bolt mentions on top of editable wiki mode, the user would be able to destroy the real mention simply by editing the text view.

The missing capability is not just a popup. The editor needs a real inline mention node, a candidate lookup path, and a submit path that follows Jira Cloud's documented Atlassian Document Format support.

## Official Jira Constraints

Implementation must follow the official Jira Cloud platform documentation:

- Jira REST API v3 supports Atlassian Document Format in comment bodies.
- Jira REST API v3 supports Atlassian Document Format in issue `description`, `environment`, and `textarea` custom fields.
- The ADF `mention` node is an inline node with a required `attrs.id` and optional `attrs.text`, `attrs.userType`, and `attrs.accessLevel`.

Because of those documented constraints, real mentions cannot remain a wiki-only feature. The shared rich text submit boundary must support ADF.

## Design Principles

### One Shared Mention System

Comments, comment edits, replies, issue description edits, and create-issue description must all use the same mention behavior path. The host screen may provide different candidate sources, but the detection, popup, insertion, and serialization rules must remain shared.

### Visual Mode Is The Only Editable Authority

Visual mode owns the live document state. Wiki mode shows a serialized view of the same document, but it does not accept edits. This keeps mention identity, formatting state, and document structure in one place.

### Structured Identity, Not Decorated Text

A visible `@Display Name` string is not enough. Every inserted mention must carry the selected Jira user's account id so submit can emit a real ADF mention node.

### Local First, Remote Complete

Issue participants should appear immediately, without waiting on the network. Remote search then expands results through the documented project-assignable user endpoints when the project context allows it.

### Thin Host Integration

The issue panel and create-issue panel should provide project and participant context, but they should not implement mention logic themselves. Mention behavior belongs in the shared editor subsystem.

## Proposed Architecture

### `RichTextMentionExtension`

Add a focused Tiptap mention extension for the shared editor schema.

Responsibilities:

- define the inline mention node used by the editor document
- keep the mention node atomic and selection-safe
- render visible `@Display Name` text in the editor surface
- expose the metadata needed for ADF serialization

The mention node should store:

- `accountId`
- `displayName`
- `mentionText`
- `userType`

`mentionText` should always include the leading `@`.

### `RichTextMentionController`

Add a controller that owns mention query detection and popup lifecycle.

Responsibilities:

- detect when the caret is inside an active `@query`
- request candidates from the active provider
- manage popup open, close, anchor position, and highlighted index
- handle `ArrowUp`, `ArrowDown`, `Enter`, `Tab`, and `Escape`
- insert the chosen mention node and trailing space

This controller should work from editor state, not DOM scraping.

### `RichTextMentionProvider`

Add a host-facing provider contract that resolves mention candidates for one editor instance.

Responsibilities:

- return immediate local candidates when the popup opens
- expand with remote candidates when a query is available
- deduplicate by Jira account id
- expose compact display data for the popup

Suggested candidate shape:

- `accountId`
- `displayName`
- `mentionText`
- `avatarUrl`
- `userType`
- `source`

### `IssueMentionCandidateService`

Add a service that builds local participants for issue-bound editors.

Initial local set:

- issue reporter
- issue assignee
- loaded comment authors
- current reply target author, when replying
- current authenticated user, when available

This service should deduplicate by account id and rank the most recently relevant people first when timestamps are available.

### `ProjectAssignableMentionService`

Add a service that queries Jira for project-assignable users using the documented assignable-user search endpoints.

Responsibilities:

- search by active project key
- normalize Jira user payloads into mention candidates
- discard unusable records that do not provide an account id
- debounce outbound queries so typing remains stable

For issue-bound editors, this service expands the issue-participant results. For create-issue, this is the main remote source.

### `JiraAdfDocumentCodec`

Add a dedicated ADF codec for the shared rich text editor.

Responsibilities:

- parse supported incoming ADF into editor content
- serialize editor content into supported Jira ADF
- emit official ADF mention nodes for selected users
- preserve the existing supported text formatting scope

This codec becomes the canonical submit boundary for shared rich text hosts.

### `JiraWikiPreviewCodec`

Keep wiki serialization, but reduce its role to preview only.

Responsibilities:

- serialize the current editor document to readable wiki text
- render mentions as visible `@Display Name` text in preview
- never act as the canonical editable format

The current wiki codec should no longer be treated as the primary integration contract for shared rich text fields.

### `RichTextEditorController`

Update the shared controller responsibilities:

- create the editor with the mention extension enabled
- keep the visual document mounted as the only editable document
- own the read-only wiki preview surface
- synchronize the hidden submit payload from editor state to ADF
- route project and participant context into the mention provider

The controller should stop reparsing wiki back into the editor on mode switches.

## Interaction Contract

### Trigger Rules

- Typing `@` in visual mode opens the mention popup.
- Typing additional text filters the active results by the query after `@`.
- The popup closes if the caret leaves the query, the token is deleted, or the user presses `Escape`.
- Wiki mode never opens the mention popup because wiki mode is read-only.

### Initial Results

- Issue-bound editors show local issue participants immediately on bare `@`.
- Create-issue description uses project-assignable users when a project key is already selected.
- If create-issue has no active project key yet, the popup shows an instructional empty state instead of making a blind user search.

### Remote Search

- Remote search starts after the popup opens and the host has enough project context.
- Querying should be debounced.
- Local results stay visible while remote results are loading.
- Remote results merge into the list without duplicating existing local candidates.

### Keyboard And Mouse

- `ArrowDown` moves to the next result.
- `ArrowUp` moves to the previous result.
- `Enter` selects the highlighted user.
- `Tab` also selects the highlighted user.
- `Escape` closes the popup without inserting a mention.
- Mouse click selects a result without losing the editor selection first.

### Insertion

- Selecting a user replaces the active `@query` token with one mention node.
- The inserted node renders as visible `@Display Name`.
- The controller inserts one trailing space after the mention so typing can continue naturally.
- Mentions behave as atomic inline nodes for cursor movement and deletion.

### Editing Around Mentions

- Typing before or after a mention behaves like normal inline editing.
- Backspace or Delete removes the whole mention node when the caret is adjacent to it.
- Plain text edits do not silently turn a real mention into a different user.

## Wiki Mode Contract

Wiki mode becomes read-only visualization for the shared rich text editor.

Rules:

- Switching to wiki mode serializes the current visual document once.
- The wiki surface is read-only and not submitted as the canonical payload.
- Switching back to visual mode does not reparse wiki text.
- Mentions display as readable `@Display Name` preview text in wiki mode.
- Editing always happens in visual mode.

This is an intentional simplification. Real mentions and editable wiki mode are in direct tension, and the user explicitly chose visualization over modification.

## Data Flow

### Load

1. The host creates a shared rich text editor.
2. If the field already has raw ADF content, the controller seeds the editor from ADF.
3. If raw ADF is unavailable, the controller falls back to the existing supported wiki import path.
4. The controller builds a mention provider from the current host context.

### Visual Editing

1. The user types in visual mode.
2. The mention controller detects an active `@query`.
3. The provider returns local candidates immediately and remote candidates when available.
4. The user selects a person.
5. The editor document stores a structured mention node with the selected account id.
6. The controller serializes the current editor state to the hidden ADF payload.
7. The controller also refreshes the read-only wiki preview text.

### Submit

1. Comments, comment edits, and replies submit Jira REST API v3 comment bodies as ADF.
2. Issue description edits submit the `description` field as ADF.
3. Create-issue description submits the `description` field as ADF.
4. Any other future shared rich-text `textarea` fields should follow the same ADF path when they adopt this editor.

## Host Integration Rules

- The issue panel must provide issue participant data already available in the screen model.
- The create-issue panel must provide the active project key before remote mention search can run.
- Hosts must not implement ad hoc mention popups or duplicate filtering logic.
- Mention popup layout must reserve stable space and must not shift surrounding controls when it opens.

## Error Handling

- If local candidate building fails, typing continues and the popup stays closed.
- If remote search fails, local results remain usable and the popup may show a compact error state.
- If no candidates match, the popup shows an empty state instead of disappearing unpredictably.
- If mention insertion fails, the original `@query` text remains in place.
- If ADF serialization fails for a shared rich text host, submit must fail explicitly through the existing error surfaces instead of silently degrading to fake plain text.
- If incoming ADF is invalid, the controller should fall back to readable content using the existing supported import path.

## Testing Strategy

Implementation must follow TDD.

### Unit Tests

Add or expand tests for:

- issue participant ranking and deduplication
- project-assignable user normalization
- ADF mention node serialization
- ADF mention node parsing
- wiki preview rendering of mentions as `@Display Name`

### DOM Tests

Add or expand tests for:

- typing `@` opens the popup in every shared rich text host
- bare `@` shows local participants in issue-bound editors
- create-issue shows the project-required empty state when no project is selected
- query filtering updates the visible result list
- `ArrowUp` and `ArrowDown` move the highlighted result
- `Enter` and `Tab` insert the selected mention
- `Escape` closes the popup without mutation
- clicking a result does not steal focus or corrupt selection
- mention insertion keeps follow-up typing stable
- mention deletion behaves atomically
- wiki mode is read-only

### Integration Tests

Add or expand tests for:

- comment composer mention insertion and submit payload
- comment edit mention insertion and submit payload
- reply composer mention insertion and submit payload
- issue description edit mention insertion and submit payload
- create-issue description mention insertion and submit payload

### Real Webview Verification

Verify in a real VS Code webview during implementation:

- popup anchor position near the caret
- keyboard navigation inside the popup
- mouse selection without focus theft
- comment submit with a real mention
- description submit with a real mention

## Success Criteria

This phase is complete when:

- typing `@` in any shared rich text host opens a stable people picker
- selecting a person inserts a visible `@Display Name` mention node
- shared rich text submit paths emit official Jira ADF with real mention nodes
- wiki mode shows a readable preview but cannot destroy mention identity
- comments, replies, description edit, and create description all follow the same mention behavior contract
- the mention popup does not reintroduce the focus and toolbar regressions already fixed in the editor

## References

- Atlassian Document Format overview: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
- Atlassian ADF mention node: https://developer.atlassian.com/cloud/jira/platform/apis/document/nodes/mention/
- Jira Cloud REST API v3 intro: https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/
- Jira Cloud issue comment endpoints: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/
- Jira Cloud user search endpoints: https://developer.atlassian.com/cloud/jira/platform/rest/v2/api-group-user-search/
