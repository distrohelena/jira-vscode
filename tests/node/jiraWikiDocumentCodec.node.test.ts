import assert from 'node:assert/strict';
import test from 'node:test';

import { JiraWikiDocumentCodec } from '../../src/views/webview/editors/jira-wiki-document-codec.ts';

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

test('convertEditorHtmlToWiki preserves paragraph separation inside unsupported block quotes', () => {
	assert.equal(
		JiraWikiDocumentCodec.convertEditorHtmlToWiki('<blockquote><p>First</p><p>Second</p></blockquote>'),
		['First', '', 'Second'].join('\n')
	);
});

test('convertEditorHtmlToWiki degrades nested lists without merging nested text', () => {
	assert.equal(
		JiraWikiDocumentCodec.convertEditorHtmlToWiki('<ul><li>Parent<ul><li>Child</li></ul></li></ul>'),
		['* Parent', '* Child'].join('\n')
	);
});

test('convertEditorHtmlToWiki round-trips hard breaks without turning them into paragraph boundaries', () => {
	const wiki = JiraWikiDocumentCodec.convertEditorHtmlToWiki('<p>Line one<br>Line two</p>');

	assert.equal(wiki, 'Line one\\\\Line two');
	assert.equal(JiraWikiDocumentCodec.convertWikiToEditorHtml(wiki), '<p>Line one<br>Line two</p>');
});

test('convertPlainTextToEditorHtml preserves soft breaks inside plain text pastes', () => {
	assert.equal(
		JiraWikiDocumentCodec.convertPlainTextToEditorHtml('Line one\nLine two'),
		'<p>Line one<br>Line two</p>'
	);
	assert.equal(
		JiraWikiDocumentCodec.convertEditorHtmlToWiki(
			JiraWikiDocumentCodec.convertPlainTextToEditorHtml('Line one\nLine two')
		),
		'Line one\\\\Line two'
	);
});

test('convertEditorHtmlToWiki does not throw on malformed numeric entities', () => {
	assert.doesNotThrow(() => JiraWikiDocumentCodec.convertEditorHtmlToWiki('&#999999999;'));
	assert.equal(JiraWikiDocumentCodec.convertEditorHtmlToWiki('&#999999999;'), '&#999999999;');
});
