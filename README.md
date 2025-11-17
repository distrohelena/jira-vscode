# Jira VS Code

Jira VS Code is an open-source Visual Studio Code extension that brings the essential Jira workflows directly into your editor. It provides reliable authentication for Jira Cloud and custom server deployments, a multi-view explorer for projects and issues, and quick actions like assigning tickets, updating status, and creating new tasks without leaving VS Code.

## Features

- **Projects View** – Browse accessible Jira projects, focus a project for work, and refresh data with a single click.
- **Items View** – Displays the currently focused project's Jira issues grouped by status, with badges, an inline search/filter row for your recent items, and tree view actions that mirror VS Code's source control UX.
- **Issue Details Panel** – Open any ticket to view full metadata (including the rich-text description card), switch assignees, transition workflow status, and launch the issue in the browser.
- **Inline Comments** – Read the latest Jira comments (with wiki formatting), refresh the thread, add comments in wiki or plain text, and delete your own remarks without leaving VS Code.
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
- Change assignees by selecting a user and confirming with the OK button beside the dropdown in the details panel.
- Inside the panel you can:
  - Update status via the combobox (transitions are fetched from Jira).
  - Search for and assign the issue to other users (results fetch lazily on demand).
  - Review the formatted description card and refresh/open related issues.
  - Read, refresh, add, and delete Jira comments—choose between Jira wiki (full formatting) or plain text when posting.
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

## HOWTO: First-Time Setup

If you're new to Jira VS Code, follow these steps to get from zero to productive:

1. **Install and build**
   - Clone the repo, run `npm install`, then `npm run compile` to generate `dist/extension.js`.

2. **Start the Extension Development Host**
   - In VS Code, press `F5`. A new window (Extension Development Host) opens with the extension loaded.

3. **Open the Jira view**
   - In the activity bar, click the Jira logo to reveal the Projects, Items, and Settings views in the side bar.

4. **Authenticate**
   - In the Settings view or Command Palette (`Ctrl/Cmd+Shift+P`) run `Jira: Log In`.
   - Choose Jira Cloud or Server, enter your base URL, username/email, and API token/password. The extension stores credentials securely using VS Code's secret storage.

5. **Focus a project**
   - In the Projects view, click the project you want to work on. The Items view reloads to show that project's issues grouped by status.
   - You can switch between “Recent” and “All” projects via the context commands at the top of the view if needed.

6. **Explore issues**
   - Use the Items view to browse issues; the inline “Search recent items” row lets you filter your own tickets quickly.
   - Select an issue to open the details panel. There you can review the description, related issues, comments, and metadata without leaving VS Code.

7. **Update work**
   - Change status from the dropdown, reassign tickets, add or delete comments, and click “Open in Jira” for the full web experience if necessary.
   - Use `Jira: Commit From Issue` (context menu) to prefill your SCM commit message with the issue key.

8. **Create new tickets**
   - Press the `+ Ticket` button in the Items view toolbar, fill in the form (summary, description, type, status), and submit. The new issue opens automatically in the details panel.

9. **Stay in sync**
   - Use the refresh icons on Projects or Items (or the matching commands) to reload data.
   - If you need to log out, run `Jira: Log Out`; the extension clears stored secrets and cached project data.

Following this checklist ensures new users authenticate, focus a project, and start updating or creating Jira issues directly from VS Code within minutes.

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
