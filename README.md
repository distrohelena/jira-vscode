# Jira VS Code

Jira VS Code is an open-source Visual Studio Code extension for working with Jira Cloud and Jira Server/Data Center without leaving the editor. It combines project browsing, issue triage, inline editing, comments, ticket creation, and commit message helpers in a single sidebar and issue panel workflow.

See [CHANGELOG.md](CHANGELOG.md) for release history.

## Current Feature Set

### Projects view

- Browse accessible Jira projects in `Recent`, `All`, or `Favorites` modes.
- Focus a project to drive the Items view.
- Favorite or unfavorite projects from the tree context menu.
- Refresh project data from the view toolbar.

### Items view

- Switch between `Assigned`, `All`, and `Unassigned` issue modes.
- Filter the loaded issue list locally by key, summary, status, or assignee.
- Run a separate Jira-backed search when you need server-side matching.
- Group issues by `Status`, `Type`, or `None`.
- Sort by created date, last update, or alphabetical order.
- Load additional pages for large result sets with `Load More`.
- Keep expanded groups open across refreshes by using stable tree item identities.
- Show an activity badge for in-progress items.

### Issue details panel

- Open a dedicated issue panel from the Items tree and reuse the same panel for the same issue instead of opening duplicates.
- Inline edit the issue summary.
- Inline edit the issue description with a richer visual editor.
- Change status using Jira-provided workflow transitions.
- Search assignable users and confirm assignee changes explicitly with an `OK` action.
- View assignee, reporter, timestamps, related parent/child issues, and rich Jira description content.
- Open the issue directly in Jira.
- Start a commit message from the issue key, targeting the repository currently selected in VS Code Source Control.

### Comments

- Load and refresh issue comments inside the issue details panel.
- Add comments without leaving VS Code.
- Reply to existing comments from the issue panel, with reply context preserved in the new Jira comment body.
- Delete your own comments.
- Post issue comments using Jira wiki format.

### Create issue flow

- Create tickets from the Items view toolbar.
- Set summary, description, issue type, assignee, and target status.
- Load Jira-driven additional fields when the selected project or issue type requires them.
- Search assignable users and use `Assign to Me` when Jira provides a current user.
- Preserve create-form state while the panel is hidden.
- Open the created issue automatically after success.

### Authentication and validation

- Supports Jira Cloud and custom Jira Server/Data Center deployments.
- Stores credentials in VS Code secret storage.
- Surfaces automatic API key and credential validation warnings across Jira views.

## Quick Start

1. Install dependencies with `npm install`.
2. Build the extension with `npm run compile`.
3. Press `F5` in VS Code to launch an Extension Development Host.
4. Open the Jira activity bar icon to reveal the `Projects`, `Items`, and `Settings` views.
5. Run `Jira: Log In` and enter your Jira base URL, username/email, and API token or password.
6. Focus a project in the Projects view.
7. Use the Items view to filter, search, group, sort, open, create, and update tickets.

## Everyday Workflow

### 1. Authenticate

- Run `Jira: Log In` from the Command Palette or use the login action exposed in the Jira views.
- If credentials become invalid, the extension shows warnings and exposes `Jira: Validate API Key`.

### 2. Choose a project

- Use the Projects view to browse recent projects, all accessible projects, or your favorites.
- Click a project to focus it. The Items view refreshes automatically for that project.

### 3. Work in the Items view

- Switch between `Assigned`, `All`, and `Unassigned` modes from the view toolbar.
- Use `Jira: Filter Items` for instant local filtering of loaded items.
- Use `Jira: Search Items` for Jira-backed search.
- Use the `Group By` and `Sort By` menus to change how the tree is presented.

### 4. Work in the issue panel

- Open any issue to inspect metadata, reporter, assignee, related issues, and comments.
- Edit summary or description inline.
- Change assignee or workflow status directly from the panel.
- Refresh, add, reply to, or delete comments from the same panel.
- Replies are posted as regular Jira comments with reply context so they remain readable in Jira itself.
- Use `Commit from Issue` from the panel or the issue tree context menu to prefill the SCM commit box.

### 5. Create new tickets

- Click `+ Ticket` in the Items view.
- Fill in the form and any additional Jira-required fields.
- Submit the form to create the ticket and open its details automatically.

## Commands

The extension contributes these commands. Some are primarily exposed through view toolbars or tree item context menus.

| Command | Description |
| ------- | ----------- |
| `Jira: Log In` | Authenticate with Jira Cloud or Jira Server/Data Center. |
| `Jira: Log Out` | Clear stored Jira credentials. |
| `Jira: Validate API Key` | Re-check stored credentials and show validation status. |
| `Jira: Focus Project` | Pick the active project for the Items view. |
| `Jira: Clear Project Focus` | Clear the current project focus. |
| `Refresh` | Refresh the Items view. |
| `Refresh Projects` | Refresh the Projects view. |
| `Show Recent` | Switch the Projects view to recent projects. |
| `Show All` | Switch the Projects view or Items view to show all entries for that view. |
| `Show Favorites` | Switch the Projects view to favorites. |
| `Favorite Project` | Add the selected project to favorites. |
| `Remove Favorite` | Remove the selected project from favorites. |
| `Show Assigned` | Switch the Items view to issues assigned to the current user. |
| `Show Unassigned` | Switch the Items view to unassigned issues. |
| `Jira: Filter Items` | Edit the local Items filter. |
| `Jira: Search Items` | Run server-side Jira search for the focused project. |
| `Jira: Load More Items` | Load the next page of Items results. |
| `Group Items: None` | Flatten the Items tree. |
| `Group Items: Status` | Group Items by status. |
| `Group Items: Type` | Group Items by issue type. |
| `Sort Items: Date` | Sort Items by created date. |
| `Sort Items: Last Update` | Sort Items by last updated time. |
| `Sort Items: Alphabetically` | Sort Items by summary/key ordering. |
| `Jira: Open Issue Details` | Open the issue details panel. |
| `Jira: Commit From Issue` | Prefill the SCM commit input with the issue key. |
| `Jira: Create Issue` | Open the create issue panel. |

## Development

### Scripts

- `npm run compile` bundles the extension to `dist/extension.js`.
- `npm run watch` runs esbuild in watch mode.
- `npm run test` runs node tests, DOM tests, and a smoke syntax check.
- `npm run package` creates a VSIX with `vsce package`.

### Key paths

- `src/extension.entrypoint.ts` wires activation, commands, tree views, and controllers.
- `src/views/tree/` contains the Projects, Items, and Settings tree providers.
- `src/views/webview/webview.panel.ts` renders the issue and create-ticket webviews.
- `src/controllers/` contains issue, create-issue, and commit workflows.
- `src/jira-api/` contains the reusable Jira API layer.
- `docs/JiraTypeScriptApiLibrary.md` documents the Jira API package.

When contributing:

1. Run `npm run test`.
2. Run `npm run compile`.
3. Verify the workflow in an Extension Development Host.
4. Update the changelog for user-visible changes.

## License

This project is licensed under the [MIT License](LICENSE).
