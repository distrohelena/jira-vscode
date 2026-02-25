# Jira TypeScript API Library

## Status
- **Name:** `JiraApiClient`
- **Namespace:** `src/jira-api`
- **Scope:** Shared Jira REST client for extension features and future external consumers
- **Design style:** C#-inspired service contract (`IJiraApiClient`) and implementation (`JiraApiClient`)

## Purpose
`JiraApiClient` centralizes all Jira REST operations currently used by this repository so the same API surface can be reused by other TypeScript projects.

## Public Surface

### Contract
- `IJiraApiClient` (`src/jira-api/contracts/jira-api.client.contract.ts`)

### Default Instance
- `jiraApiClient` (`src/jira-api/default-jira-api.client.ts`)

### Implementation
- `JiraApiClient` (`src/jira-api/services/jira-api.client.ts`)

### Shared Request Types
- `JiraIssueSearchRequest` (`src/jira-api/types/jira-issue-search-request.type.ts`)
- `JiraAssignableUserScope` (`src/jira-api/types/jira-assignable-user-scope.type.ts`)

## Supported Features (Current)

### Authentication
- Verify credentials against Jira profile endpoints.
- Infer server type (`cloud` vs `custom`) from profile data.
- Support Jira Cloud and Jira Server/Data Center URL patterns.

### Project Discovery
- Fetch all accessible projects.
- Fetch recent projects.

### Issue Query and Detail
- Search by project with optional filters:
  - assigned-to-current-user + non-done status
  - unassigned only
  - free-text/JQL text search
- Paged issue retrieval with classic (`startAt`) and enhanced (`nextPageToken`) pagination.
- Generic JQL issue search.
- Full issue detail retrieval including:
  - summary/status/type
  - assignee and reporter identities and avatars
  - parent/sub-task relationships
  - rendered description HTML and raw text

### Workflow and Status
- Fetch issue transitions.
- Transition issue status.
- Fetch project status catalogs grouped by issue type.

### Assignment
- Fetch assignable users by issue scope or project scope.
- Assign issue to selected account identifier.

### Issue Editing
- Update issue summary.
- Update issue description.

### Comments
- Fetch issue comments (rendered and raw body handling).
- Add comments in wiki or plain format.
- Delete issue comments.

### Issue Creation
- Create issue with:
  - project key
  - summary
  - description
  - issue type
  - optional assignee
  - optional custom text fields
- Fetch dynamic create-meta field definitions.
- Finalize newly created issue with optional status transition.

## Jira REST Endpoint Coverage

| Capability | Endpoints |
| --- | --- |
| Verify credentials | `GET /rest/api/{version}/myself` |
| Recent projects | `GET /rest/api/{version}/project/recent` |
| Accessible projects | `GET /rest/api/{version}/project/search` |
| Project issues | `POST/GET /rest/api/{version}/search` and `POST/GET /rest/api/{version}/search/jql` |
| Issue details | `GET /rest/api/{version}/issue/{issueKey}` |
| Issue transitions | `GET /rest/api/{version}/issue/{issueKey}/transitions` |
| Transition issue | `POST /rest/api/{version}/issue/{issueKey}/transitions` |
| Project statuses | `GET /rest/api/{version}/project/{projectKey}/statuses` |
| Assignable users | `GET /rest/api/{version}/user/assignable/search` |
| Assign issue | `PUT /rest/api/{version}/issue/{issueKey}/assignee` |
| Update summary/description | `PUT /rest/api/{version}/issue/{issueKey}` |
| Issue comments | `GET/POST /rest/api/{version}/issue/{issueKey}/comment` |
| Delete comment | `DELETE /rest/api/{version}/issue/{issueKey}/comment/{commentId}` |
| Create issue | `POST /rest/api/{version}/issue` |
| Create metadata | `GET /rest/api/{version}/issue/createmeta` |

## Compatibility Rules
- API version fallback order:
  - Cloud: `3 -> latest -> 2`
  - Custom: `latest -> 2 -> 3`
- Base URL expansion supports nested Jira paths and origin fallback candidates.
- Search APIs support both POST and GET fallback for deployments that reject specific methods.
- Enhanced search token pagination is used when available.

## Current Integration in This Repository
The extension now routes Jira interaction call sites through `jiraApiClient`, including:
- authentication manager
- focus manager
- project status store
- project transition prefetcher
- items/projects tree providers
- issue and create-issue controllers

## Usage Example
```ts
import { jiraApiClient } from '../src/jira-api';

const issues = await jiraApiClient.fetchProjectIssuesPage(authInfo, token, 'ABC', {
  onlyAssignedToCurrentUser: true,
  maxResults: 100,
});
```

## Stability Notes
- The library surface is designed as the canonical integration point for Jira operations.
- Additional Jira features should be added to `IJiraApiClient` first, then implemented in `JiraApiClient`, then consumed by UI/controllers.
