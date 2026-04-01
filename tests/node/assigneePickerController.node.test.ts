import assert from 'node:assert/strict';
import test from 'node:test';

import { AssigneePickerController } from '../../src/controllers/assignee-picker.controller';
import { jiraApiClient } from '../../src/jira-api';
import { AssigneePickerNoneSelectionKey } from '../../src/views/webview/assignee-picker.overlay';

test('pickAssignee falls back to the selected none option when confirm posts an empty account id', async () => {
	const controller = new AssigneePickerController();
	const originalFetchAssignableUsers = jiraApiClient.fetchAssignableUsers;
	const panel: any = {
		webview: {
			postMessage: async () => true,
		},
		onDidDispose: () => ({ dispose() {} }),
	};

	jiraApiClient.fetchAssignableUsers = (async () => []) as typeof jiraApiClient.fetchAssignableUsers;

	let selection;
	try {
		const session = controller.pickAssignee({
			panel,
			scopeLabel: 'Project PROJ',
			authInfo: {
				baseUrl: 'https://example.atlassian.net',
				username: 'helena',
				serverLabel: 'cloud',
			},
			token: 'token-123',
			scopeOrIssueKey: {
				projectKey: 'PROJ',
			},
		});

		await session.handleMessage({
			type: 'selectAssigneeOption',
			accountId: AssigneePickerNoneSelectionKey,
		});
		await session.handleMessage({
			type: 'confirmAssigneeOption',
			accountId: '',
		});
		selection = await session.promise;
	} finally {
		jiraApiClient.fetchAssignableUsers = originalFetchAssignableUsers;
	}

	assert.deepEqual(selection, {
		kind: 'none',
	});
});
