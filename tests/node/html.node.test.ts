import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeAttribute, escapeHtml, sanitizeRenderedHtml } from '../../src/shared/html.helper';

test('escapeHtml encodes reserved characters', () => {
	const input = `<div class="x">it's & done</div>`;
	const output = escapeHtml(input);
	assert.equal(output, '&lt;div class=&quot;x&quot;&gt;it&#39;s &amp; done&lt;/div&gt;');
});

test('escapeAttribute delegates to escapeHtml', () => {
	assert.equal(escapeAttribute(`"x'&"`), '&quot;x&#39;&amp;&quot;');
});

test('sanitizeRenderedHtml strips scripts, styles and links', () => {
	const html = [
		'<p>Keep me</p>',
		'<script>alert(1)</script>',
		'<style>body { color: red; }</style>',
		'<link rel="stylesheet" href="evil.css" />',
	].join('');
	const sanitized = sanitizeRenderedHtml(html);
	assert.equal(sanitized, '<p>Keep me</p>');
});

test('sanitizeRenderedHtml returns undefined for empty content', () => {
	assert.equal(sanitizeRenderedHtml(''), undefined);
	assert.equal(sanitizeRenderedHtml('   '), undefined);
	assert.equal(sanitizeRenderedHtml(undefined), undefined);
});

