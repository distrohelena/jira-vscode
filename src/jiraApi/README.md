# Jira API Library

Reusable Jira TypeScript API layer designed for extraction into a standalone package.

This module provides a stable service contract (`IJiraApiClient`) and default implementation (`JiraApiClient`) for all Jira interactions currently used by this codebase.

## Goals

- Provide one reusable Jira integration surface for multiple projects.
- Keep the API contract stable while allowing implementation evolution.
- Support Jira Cloud and Custom/Data Center deployments through one client.
- Preserve C#-style structure in TypeScript: contract + concrete client + DTO-like request types.

## Current Public Surface

- Entry point: `src/jiraApi/index.ts`
- Default singleton: `jiraApiClient`
- Contract: `IJiraApiClient`
- Implementation: `JiraApiClient`
- Request helper types:
  - `JiraAssignableUserScope`
  - `JiraIssueSearchRequest`

## Features Implemented

### Authentication and server detection

- Verify credentials against Jira profile endpoints.
- Infer server label (`cloud` or `custom`) from profile response.

### Project retrieval

- Fetch recent projects.
- Fetch all accessible projects.

### Issue retrieval and search

- Fetch project issues with filters:
  - assigned to current user
  - unassigned
  - free text / issue key query
- Fetch paged project issues with pagination metadata.
- Execute generic JQL searches.
- Fetch issue details with rendered fields.

### Workflow and statuses

- Fetch issue transitions.
- Transition issue status.
- Fetch project status metadata grouped by issue type.

### Assignment

- Fetch assignable users scoped by issue key or project key.
- Assign issue to a user account.

### Issue editing

- Update issue summary.
- Update issue description.

### Comments

- Fetch issue comments.
- Add issue comments.
- Delete issue comments.
- Supports comment format strategies used by this extension (`plain` and `wiki`) with Jira API compatibility handling.

### Issue creation

- Create issue with summary, description, type, assignee, and custom field values.
- Fetch dynamic create metadata fields (`createmeta`) for project/issue type.
- Finalize created issue with optional status transition and refreshed issue details.

## Usage

```ts
import { jiraApiClient } from '../jiraApi';

const projects = await jiraApiClient.fetchAccessibleProjects(authInfo, token);
const issue = await jiraApiClient.fetchIssueDetails(authInfo, token, 'PROJ-123');
```

Use contract-driven dependency injection when composing higher-level services:

```ts
import type { IJiraApiClient } from '../jiraApi';

class IssueApplicationService {
	constructor(private readonly jiraClient: IJiraApiClient) {}
}
```

## Error and compatibility behavior

- The client uses deployment-aware endpoint strategies for Cloud and Custom servers.
- Search and other operations include compatibility fallbacks for Jira API variants used in real environments.
- API methods throw on failure and return typed successful results.
- Caller layers are responsible for user-facing error messaging.

## Package extraction plan

When moved to a standalone package, keep these boundaries:

- `contracts/*`: public interfaces only.
- `types/*`: public request/response helper types.
- `services/*`: implementation details.
- `index.ts`: curated public exports only.

Recommended follow-up during extraction:

- Move shared domain types currently imported from `src/model/jira.type.ts` into package-owned public types.
- Add package-level semantic versioning and changelog.
- Add API contract tests that validate behavior across Cloud and Custom fixtures.
- Keep one default singleton export plus class export for dependency injection scenarios.

## Stability note

This module is already used as a reusable boundary inside the extension and is intended to become an independent package with minimal API changes.
