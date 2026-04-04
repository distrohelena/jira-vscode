import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Resolves the tracked extension bundle used by the live VS Code runtime.
 */
const extensionBundlePath = path.resolve(process.cwd(), 'dist/extension.js');

/**
 * Captures the current bundled extension source so regression checks can verify shipped markup contracts.
 */
const extensionBundleSource = fs.readFileSync(extensionBundlePath, 'utf8');

test('bundled edit assignee action keeps the shared edit-only assign-to-me class contract', () => {
	assert.match(extensionBundleSource, /buttonClassName:\s*"jira-create-assign-me"/);
	assert.match(extensionBundleSource, /buttonClassName:\s*"jira-assignee-assign-me"/);
	assert.doesNotMatch(
		extensionBundleSource,
		/buttonClassName:\s*"jira-create-assign-me jira-assignee-assign-me"/
	);
});
