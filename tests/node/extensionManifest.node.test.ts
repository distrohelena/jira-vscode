import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Reads the extension manifest so node tests can verify shipped command contribution contracts.
 */
const extensionManifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));

/**
 * Locates one contributed command by its stable command id.
 */
function getContributedCommand(commandId: string): Record<string, unknown> | undefined {
	return extensionManifest?.contributes?.commands?.find((command: Record<string, unknown>) => command?.command === commandId);
}

test('items view refresh command uses a stable codicon contribution instead of mojibake title text', () => {
	const refreshItemsCommand = getContributedCommand('jira.refreshItemsView');

	assert.ok(refreshItemsCommand);
	assert.equal(refreshItemsCommand.title, 'Refresh Items');
	assert.equal(refreshItemsCommand.icon, '$(refresh)');
});
