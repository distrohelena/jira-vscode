import assert from 'node:assert/strict';
import test from 'node:test';

import { JiraApiTransport } from '../../src/model/jira-api.client';

test('mapCreateIssueFieldDefinitionInternal includes Jira parent metadata', () => {
	const field = JiraApiTransport.mapCreateIssueFieldDefinitionInternal('parent', {
		name: 'Parent',
		required: true,
		operations: ['set'],
		schema: {
			type: 'issuelink',
			system: 'parent',
		},
	});

	assert.deepEqual(field, {
		id: 'parent',
		name: 'Parent',
		required: true,
		multiline: false,
	});
});

test('mapCreateIssueFieldDefinitionInternal still ignores unsupported non-string field types', () => {
	const field = JiraApiTransport.mapCreateIssueFieldDefinitionInternal('customfield_10010', {
		name: 'Priority Bucket',
		required: false,
		operations: ['set'],
		schema: {
			type: 'option',
		},
	});

	assert.equal(field, undefined);
});

test('buildCreateIssueFieldValueInternal maps parent values to Jira parent references', () => {
	assert.deepEqual(JiraApiTransport.buildCreateIssueFieldValueInternal('parent', 'PROJ-123'), {
		key: 'PROJ-123',
	});
	assert.deepEqual(JiraApiTransport.buildCreateIssueFieldValueInternal('parent', '10045'), {
		id: '10045',
	});
	assert.equal(
		JiraApiTransport.buildCreateIssueFieldValueInternal('customfield_10020', 'Needs follow-up'),
		'Needs follow-up'
	);
});
