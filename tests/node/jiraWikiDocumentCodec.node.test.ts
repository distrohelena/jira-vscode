import assert from 'node:assert/strict';
import test from 'node:test';

import { JiraWikiDocumentCodec } from '../../src/views/webview/editors/jira-wiki-document-codec';

test('convertWikiToEditorHtml converts inline Jira wiki markup into editor HTML', () => {
	assert.equal(
		JiraWikiDocumentCodec.convertWikiToEditorHtml('*bold* _italic_ +underline+ [Docs|https://example.test]'),
		'<p><strong>bold</strong> <em>italic</em> <u>underline</u> <a href="https://example.test">Docs</a></p>'
	);
});

test('convertEditorHtmlToWiki serializes bullet and ordered lists', () => {
	assert.equal(
		JiraWikiDocumentCodec.convertEditorHtmlToWiki('<ul><li>One</li><li>Two</li></ul><ol><li>Three</li></ol>'),
		['* One', '* Two', '# Three'].join('\n')
	);
});

test('convertEditorHtmlToWiki degrades unsupported block content into readable paragraphs', () => {
	assert.equal(
		JiraWikiDocumentCodec.convertEditorHtmlToWiki('<blockquote><p>Quoted</p></blockquote><p>Normal</p>'),
		['Quoted', '', 'Normal'].join('\n')
	);
});
