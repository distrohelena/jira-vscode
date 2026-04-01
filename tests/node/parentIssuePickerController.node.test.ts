import assert from 'node:assert/strict';
import test from 'node:test';

import { ParentIssuePickerController } from '../../src/controllers/parent-issue-picker.controller';
import { ParentIssuePickerNoneSelectionKey } from '../../src/views/webview/parent-issue-picker.overlay';

test('pickParentIssue resolves a none selection when the modal confirms the None option', async () => {
	const controller = new ParentIssuePickerController();
	const disposeHandlers: Array<() => void> = [];
	const panel: any = {
		webview: {
			postMessage: async () => true,
		},
		onDidDispose: (handler: () => void) => {
			disposeHandlers.push(handler);
			return { dispose() {} };
		},
	};

	const session = controller.pickParentIssue({
		panel,
		project: {
			key: 'PROJ',
			name: 'Project',
		},
		authInfo: {
			baseUrl: 'https://example.atlassian.net',
			username: 'helena',
			serverLabel: 'cloud',
		},
		token: 'token-123',
	});

	const selectHandled = await session.handleMessage({
		type: 'selectParentIssue',
		issueKey: ParentIssuePickerNoneSelectionKey,
	});
	const confirmHandled = await session.handleMessage({
		type: 'confirmParentIssue',
	});
	const selection = await session.promise;

	assert.equal(selectHandled, true);
	assert.equal(confirmHandled, true);
	assert.deepEqual(selection, {
		kind: 'none',
	});
	assert.equal(disposeHandlers.length, 1);
});

test('pickParentIssue falls back to the selected none option when confirm posts an empty issue key', async () => {
	const controller = new ParentIssuePickerController();
	const panel: any = {
		webview: {
			postMessage: async () => true,
		},
		onDidDispose: () => ({ dispose() {} }),
	};

	const session = controller.pickParentIssue({
		panel,
		project: {
			key: 'PROJ',
			name: 'Project',
		},
		authInfo: {
			baseUrl: 'https://example.atlassian.net',
			username: 'helena',
			serverLabel: 'cloud',
		},
		token: 'token-123',
	});

	await session.handleMessage({
		type: 'selectParentIssue',
		issueKey: ParentIssuePickerNoneSelectionKey,
	});
	await session.handleMessage({
		type: 'confirmParentIssue',
		issueKey: '',
	});
	const selection = await session.promise;

	assert.deepEqual(selection, {
		kind: 'none',
	});
});

test('pickParentIssue dispose hides the overlay before resolving the pending session', async () => {
	const messages: any[] = [];
	const controller = new ParentIssuePickerController();
	const panel: any = {
		webview: {
			postMessage: async (message: any) => {
				messages.push(message);
				return true;
			},
		},
		onDidDispose: () => ({ dispose() {} }),
	};

	const session = controller.pickParentIssue({
		panel,
		project: {
			key: 'PROJ',
			name: 'Project',
		},
		authInfo: {
			baseUrl: 'https://example.atlassian.net',
			username: 'helena',
			serverLabel: 'cloud',
		},
		token: 'token-123',
	});

	session.dispose();
	const selection = await session.promise;

	assert.equal(messages.some((message) => message?.type === 'parentPickerHide'), true);
	assert.equal(selection, undefined);
});

test('pickParentIssue loads dynamic project status options into the overlay', async () => {
	const messages: any[] = [];
	const projectStatusStore: any = {
		get: () => undefined,
		ensure: async () => [
			{ name: 'Ready for QA' },
			{ name: 'Blocked' },
		],
	};
	const controller = new ParentIssuePickerController(undefined, projectStatusStore);
	const panel: any = {
		webview: {
			postMessage: async (message: any) => {
				messages.push(message);
				return true;
			},
		},
		onDidDispose: () => ({ dispose() {} }),
	};

	controller.pickParentIssue({
		panel,
		project: {
			key: 'PROJ',
			name: 'Project',
		},
		authInfo: {
			baseUrl: 'https://example.atlassian.net',
			username: 'helena',
			serverLabel: 'cloud',
		},
		token: 'token-123',
	});

	await new Promise((resolve) => setImmediate(resolve));

	const renderMessages = messages.filter((message) => message?.type === 'parentPickerRender');
	assert.equal(renderMessages.length >= 2, true);
	const latestHtml = renderMessages[renderMessages.length - 1]?.html ?? '';
	assert.equal(latestHtml.includes('>Ready for QA<'), true);
	assert.equal(latestHtml.includes('>Blocked<'), true);
	assert.equal(latestHtml.includes('>To Do<'), false);
	assert.equal(latestHtml.includes('>In Progress<'), false);
});
