# Jira VS Code

Jira VS Code is an open-source Visual Studio Code extension that brings the essential Jira workflows directly into your editor. It provides reliable authentication for Jira Cloud and custom server deployments, a multi-view explorer for projects and issues, and quick actions like assigning tickets, updating status, and creating new tasks without leaving VS Code.

## Features

- **Projects View** – Browse accessible Jira projects, focus a project for work, and refresh data with a single click.
- **Items View** – Displays the currently focused project's Jira issues grouped by status, with badges, an inline search/filter row for your recent items, and tree view actions that mirror VS Code's source control UX.
- **Issue Details Panel** – Open any ticket to view metadata, switch assignees, transition workflow status, and launch the issue in the browser.
- **Ticket Creation** – Use the `+ Ticket` button to create new issues with summary, description, issue type, and starting status right from VS Code.
- **Authentication Support** – Works with Jira Cloud as well as custom Jira Server/Data Center deployments, storing tokens securely via VS Code's secret storage.

## Getting Started

1. **Install dependencies**: `npm install`
2. **Build**: `npm run compile` (runs the esbuild bundler and outputs `dist/extension.js`)
3. **Launch the extension**:
   - Press `F5` in VS Code to start a new Extension Development Host.
   - Open the "Jira" activity bar icon to access the Projects, Items, and Settings views.

## Usage

### Authenticating
- Run `Jira: Log In` from the Command Palette or click "Log in to Jira" in any view.
- Choose Jira Cloud or Server, provide your base URL, username/email, and API token/password.

### Focusing Projects
- In the Projects view, click a project to focus it. The Items view automatically refreshes to show its backlog.
- Use the refresh icon to reload project listings, or `Jira: Clear Project Focus` to reset.

### Working with Issues
- Issues appear grouped by status in the Items view. Selecting an item opens the details panel.
- Use the first "Search recent items" row in the Items view to filter your recent issues without leaving the tree.
- Inside the panel you can:
  - Update status via the combobox (transitions are fetched from Jira).
  - Search for and assign the issue to other users (results fetch lazily on demand).
  - Click "Open in Jira" to view the ticket in your browser.

### Creating Tickets
- Click `+ Ticket` in the Items view toolbar.
- Fill in the summary, description, issue type, and desired starting status, then submit.
- The new ticket is created via Jira's REST API, transitions to the requested status, and opens in the details view automatically.

## Commands

| Command | Description |
| ------- | ----------- |
| `Jira: Log In` | Authenticate with Jira Cloud/Server. |
| `Jira: Focus Project` | Choose a project to work on. |
| `Jira: Clear Project Focus` | Reset the focused project. |
| `Jira: Refresh Items` | Refresh the Items tree. |
| `Jira: Search Items` | Edit the inline Items search/filter row to narrow your recent issues. |
| `Jira: Refresh Projects` | Refresh the Projects tree. |
| `Jira: Create Issue` | Launch the ticket creation panel. |
| `Jira: Open Issue Details` | Open the webview panel for a specific ticket. |
| `Jira: Commit From Issue` | Prefill the SCM commit box with the selected issue key. |
| `Jira: Log Out` | Clear credentials and stored secrets. |

## Development

This extension is written in TypeScript. Key entry points:

- `src/extension.ts` – Activation, tree providers, commands, and webview wiring.
- `dist/extension.js` – Compiled output loaded by VS Code (generated via `npm run compile`).

When contributing:
1. Make sure to run `npm run compile`.
2. Test flows in the Extension Development Host.
3. Update the changelog when changes are user-visible.

### Packaging & Bundling

- The extension is bundled with [esbuild](https://esbuild.github.io/) so that runtime dependencies are inlined and the marketplace payload stays small. `npm run compile` handles bundling for both development builds and publishing.
- Packaging for VS Code (`vsce package`) automatically honors `.vscodeignore`, which excludes TypeScript sources, `node_modules`, and other development artifacts for smaller `.vsix` files. For more guidance, see [aka.ms/vscode-bundle-extension](https://aka.ms/vscode-bundle-extension).

## License

This project is licensed under the [MIT License](LICENSE).
