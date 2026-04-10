import assert from 'node:assert/strict';
import test from 'node:test';

import { JiraAdfDocumentCodec } from '../../src/views/webview/editors/jira-adf-document-codec';
import type { JiraAdfDocument } from '../../src/model/jira.type';

test('convertAdfToWikiPreview renders mention nodes as readable @Display Name text', () => {
	const document: JiraAdfDocument = {
		type: 'doc',
		version: 1,
		content: [
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Hello ' },
					{
						type: 'mention',
						attrs: {
							id: 'acct-123',
							text: '@Helena',
							userType: 'DEFAULT',
						},
					},
				],
			},
		],
	};

	assert.equal(JiraAdfDocumentCodec.convertAdfToWikiPreview(document), 'Hello @Helena');
});

test('parseSerializedDocument round-trips a mention-bearing ADF payload', () => {
	const serialized = JSON.stringify({
		type: 'doc',
		version: 1,
		content: [
			{
				type: 'paragraph',
				content: [
					{
						type: 'mention',
						attrs: {
							id: 'acct-123',
							text: '@Helena',
							userType: 'DEFAULT',
						},
					},
				],
			},
		],
	});

	const parsed = JiraAdfDocumentCodec.parseSerializedDocument(serialized);
	assert.equal(parsed?.content[0]?.type, 'paragraph');
	assert.equal((parsed?.content[0] as any).content?.[0]?.type, 'mention');
	assert.equal(((parsed?.content[0] as any).content?.[0] as any).attrs?.id, 'acct-123');
});

test('extractPlainText collapses mention nodes into readable inline text', () => {
	const document: JiraAdfDocument = {
		type: 'doc',
		version: 1,
		content: [
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Ping ' },
					{
						type: 'mention',
						attrs: {
							id: 'acct-123',
							text: '@Helena',
						},
					},
					{ type: 'text', text: ' please' },
				],
			},
		],
	};

	assert.equal(JiraAdfDocumentCodec.extractPlainText(document), 'Ping @Helena please');
});
