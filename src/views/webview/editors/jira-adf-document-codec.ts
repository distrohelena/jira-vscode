import type {
	JiraAdfBlockNode,
	JiraAdfBulletListNode,
	JiraAdfDocument,
	JiraAdfHardBreakNode,
	JiraAdfInlineNode,
	JiraAdfListItemNode,
	JiraAdfMark,
	JiraAdfMentionNode,
	JiraAdfOrderedListNode,
	JiraAdfParagraphNode,
	JiraAdfTextNode,
} from '../../../model/jira.type';

/**
 * Converts supported Jira Atlassian Document Format content into the editor HTML and readable preview forms
 * used by the shared rich text editor.
 */
export class JiraAdfDocumentCodec {
	/**
	 * Parses a serialized ADF payload into a validated document when the payload matches the supported root shape.
	 */
	static parseSerializedDocument(serialized: string | undefined): JiraAdfDocument | undefined {
		if (!serialized?.trim()) {
			return undefined;
		}

		try {
			const parsed = JSON.parse(serialized) as Partial<JiraAdfDocument>;
			if (parsed.type !== 'doc' || parsed.version !== 1 || !Array.isArray(parsed.content)) {
				return undefined;
			}

			return parsed as JiraAdfDocument;
		} catch {
			return undefined;
		}
	}

	/**
	 * Serializes a supported ADF document into the hidden canonical string field.
	 */
	static stringifyDocument(document: JiraAdfDocument | undefined): string {
		return document ? JSON.stringify(document) : '';
	}

	/**
	 * Converts a supported ADF document into readable wiki-preview text.
	 */
	static convertAdfToWikiPreview(document: JiraAdfDocument | undefined): string {
		if (!document) {
			return '';
		}

		return document.content
			.map((node) => JiraAdfDocumentCodec.serializeBlockNodeToWiki(node))
			.filter((value) => value.length > 0)
			.join('\n\n')
			.trim();
	}

	/**
	 * Extracts a readable plain-text representation from a supported ADF document.
	 */
	static extractPlainText(document: JiraAdfDocument | undefined): string {
		if (!document) {
			return '';
		}

		return document.content
			.map((node) => JiraAdfDocumentCodec.serializeBlockNodeToPlainText(node))
			.filter((value) => value.length > 0)
			.join('\n\n')
			.trim();
	}

	/**
	 * Converts a supported ADF document into editor-safe HTML.
	 */
	static convertAdfToEditorHtml(document: JiraAdfDocument | undefined): string {
		if (!document || document.content.length === 0) {
			return '<p></p>';
		}

		const html = document.content.map((node) => JiraAdfDocumentCodec.serializeBlockNodeToHtml(node)).join('');
		return html.trim().length > 0 ? html : '<p></p>';
	}

	/**
	 * Converts supported editor HTML into an ADF document that preserves the current editor feature set.
	 */
	static convertEditorHtmlToAdf(html: string): JiraAdfDocument {
		const normalized = html.trim();
		if (!normalized) {
			return JiraAdfDocumentCodec.createEmptyDocument();
		}

		const fragment = JiraAdfDocumentCodec.parseHtmlFragment(normalized);
		const content = JiraAdfDocumentCodec.collectBlockNodes(fragment.children);
		return {
			type: 'doc',
			version: 1,
			content: content.length > 0 ? content : JiraAdfDocumentCodec.createEmptyDocument().content,
		};
	}

	/**
	 * Creates the canonical empty document used when the editor has no content.
	 */
	private static createEmptyDocument(): JiraAdfDocument {
		return {
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'paragraph',
					content: [],
				},
			],
		};
	}

	/**
	 * Collects block nodes from a parsed HTML flow fragment.
	 */
	private static collectBlockNodes(nodes: HtmlNode[]): JiraAdfBlockNode[] {
		const blocks: JiraAdfBlockNode[] = [];
		let inlineBuffer: HtmlNode[] = [];

		const flushInlineBuffer = (): void => {
			const paragraph = JiraAdfDocumentCodec.createParagraphFromNodes(inlineBuffer);
			inlineBuffer = [];
			if (paragraph) {
				blocks.push(paragraph);
			}
		};

		for (const node of nodes) {
			if (node.type === 'text') {
				inlineBuffer.push(node);
				continue;
			}

			if (JiraAdfDocumentCodec.isBlockElement(node.tagName)) {
				flushInlineBuffer();
				blocks.push(...JiraAdfDocumentCodec.collectBlockNodesFromElement(node));
				continue;
			}

			inlineBuffer.push(node);
		}

		flushInlineBuffer();
		return blocks;
	}

	/**
	 * Collects block nodes from one parsed HTML element.
	 */
	private static collectBlockNodesFromElement(node: HtmlElementNode): JiraAdfBlockNode[] {
		if (node.tagName === 'p') {
			return [JiraAdfDocumentCodec.createParagraphFromChildren(node.children)];
		}

		if (node.tagName === 'ul') {
			return [JiraAdfDocumentCodec.createListNode(node, 'bulletList')];
		}

		if (node.tagName === 'ol') {
			return [JiraAdfDocumentCodec.createListNode(node, 'orderedList')];
		}

		const nestedBlocks = JiraAdfDocumentCodec.collectBlockNodes(node.children);
		if (nestedBlocks.length > 0) {
			return nestedBlocks;
		}

		const paragraph = JiraAdfDocumentCodec.createParagraphFromNodes(node.children);
		return paragraph ? [paragraph] : [];
	}

	/**
	 * Creates a list block from an HTML list element.
	 */
	private static createListNode(
		node: HtmlElementNode,
		listType: 'bulletList' | 'orderedList'
	): JiraAdfBulletListNode | JiraAdfOrderedListNode {
		const items: JiraAdfListItemNode[] = [];
		for (const child of node.children) {
			if (child.type !== 'element' || child.tagName !== 'li') {
				const paragraph = JiraAdfDocumentCodec.createParagraphFromNodes([child]);
				if (paragraph) {
					items.push({
						type: 'listItem',
						content: [paragraph],
					});
				}
				continue;
			}

			items.push(JiraAdfDocumentCodec.createListItemNode(child));
		}

		return {
			type: listType,
			content: items,
		};
	}

	/**
	 * Creates one list-item block from an HTML list item element.
	 */
	private static createListItemNode(node: HtmlElementNode): JiraAdfListItemNode {
		const content: JiraAdfBlockNode[] = [];
		let inlineBuffer: HtmlNode[] = [];

		const flushInlineBuffer = (): void => {
			const paragraph = JiraAdfDocumentCodec.createParagraphFromNodes(inlineBuffer);
			inlineBuffer = [];
			if (paragraph) {
				content.push(paragraph);
			}
		};

		for (const child of node.children) {
			if (child.type === 'element' && (child.tagName === 'ul' || child.tagName === 'ol')) {
				flushInlineBuffer();
				content.push(...JiraAdfDocumentCodec.collectBlockNodesFromElement(child));
				continue;
			}

			if (child.type === 'element' && child.tagName === 'p') {
				flushInlineBuffer();
				content.push(JiraAdfDocumentCodec.createParagraphFromChildren(child.children));
				continue;
			}

			if (child.type === 'element' && JiraAdfDocumentCodec.isBlockElement(child.tagName)) {
				flushInlineBuffer();
				content.push(...JiraAdfDocumentCodec.collectBlockNodesFromElement(child));
				continue;
			}

			inlineBuffer.push(child);
		}

		flushInlineBuffer();
		if (content.length === 0) {
			content.push({
				type: 'paragraph',
				content: [],
			});
		}

		return {
			type: 'listItem',
			content,
		};
	}

	/**
	 * Creates one paragraph block from a set of parsed HTML children.
	 */
	private static createParagraphFromChildren(children: HtmlNode[]): JiraAdfParagraphNode {
		return {
			type: 'paragraph',
			content: JiraAdfDocumentCodec.normalizeInlineNodes(JiraAdfDocumentCodec.collectInlineNodes(children)),
		};
	}

	/**
	 * Creates one paragraph block from arbitrary nodes when they carry visible inline content.
	 */
	private static createParagraphFromNodes(nodes: HtmlNode[]): JiraAdfParagraphNode | undefined {
		const paragraph = JiraAdfDocumentCodec.createParagraphFromChildren(nodes);
		if ((paragraph.content ?? []).length === 0) {
			return undefined;
		}

		return paragraph;
	}

	/**
	 * Collects supported inline ADF nodes from parsed HTML children.
	 */
	private static collectInlineNodes(nodes: HtmlNode[], activeMarks: JiraAdfMark[] = []): JiraAdfInlineNode[] {
		const inlineNodes: JiraAdfInlineNode[] = [];
		for (const node of nodes) {
			inlineNodes.push(...JiraAdfDocumentCodec.collectInlineNodesFromNode(node, activeMarks));
		}

		return inlineNodes;
	}

	/**
	 * Collects supported inline ADF nodes from one parsed HTML node.
	 */
	private static collectInlineNodesFromNode(node: HtmlNode, activeMarks: JiraAdfMark[]): JiraAdfInlineNode[] {
		if (node.type === 'text') {
			const text = JiraAdfDocumentCodec.decodeHtmlEntities(node.text);
			if (!text) {
				return [];
			}

			const textNode: JiraAdfTextNode = {
				type: 'text',
				text,
				...(activeMarks.length > 0 ? { marks: activeMarks.map((mark) => ({ ...mark })) } : {}),
			};
			return [textNode];
		}

		if (node.tagName === 'br') {
			const hardBreakNode: JiraAdfHardBreakNode = {
				type: 'hardBreak',
			};
			return [hardBreakNode];
		}

		if (JiraAdfDocumentCodec.isMentionElement(node)) {
			const mentionNode: JiraAdfMentionNode = {
				type: 'mention',
				attrs: {
					id: node.attributes['data-mention-id'],
					text:
						node.attributes['data-mention-text'] ??
						JiraAdfDocumentCodec.normalizeMentionText(JiraAdfDocumentCodec.collectElementText(node)),
					userType: node.attributes['data-mention-user-type'] || 'DEFAULT',
					...(node.attributes['data-mention-access-level']
						? { accessLevel: node.attributes['data-mention-access-level'] }
						: {}),
				},
			};
			return [mentionNode];
		}

		const mark = JiraAdfDocumentCodec.createMarkForElement(node);
		const nextMarks = mark ? [...activeMarks, mark] : activeMarks;
		return JiraAdfDocumentCodec.collectInlineNodes(node.children, nextMarks);
	}

	/**
	 * Merges adjacent text nodes that share the same active marks.
	 */
	private static normalizeInlineNodes(nodes: JiraAdfInlineNode[]): JiraAdfInlineNode[] {
		const normalized: JiraAdfInlineNode[] = [];
		for (const node of nodes) {
			if (node.type !== 'text') {
				normalized.push(node);
				continue;
			}

			const previous = normalized.at(-1);
			if (
				previous?.type === 'text' &&
				JiraAdfDocumentCodec.getMarksKey(previous.marks) === JiraAdfDocumentCodec.getMarksKey(node.marks)
			) {
				previous.text += node.text;
				continue;
			}

			normalized.push({
				type: 'text',
				text: node.text,
				...(node.marks ? { marks: node.marks.map((mark) => ({ ...mark })) } : {}),
			});
		}

		return normalized;
	}

	/**
	 * Creates a supported ADF mark for an inline HTML element when it maps to editor formatting.
	 */
	private static createMarkForElement(node: HtmlElementNode): JiraAdfMark | undefined {
		if (node.tagName === 'strong' || node.tagName === 'b') {
			return { type: 'strong' };
		}

		if (node.tagName === 'em' || node.tagName === 'i') {
			return { type: 'em' };
		}

		if (node.tagName === 'u') {
			return { type: 'underline' };
		}

		if (node.tagName === 'a' && typeof node.attributes.href === 'string' && node.attributes.href.trim().length > 0) {
			return {
				type: 'link',
				attrs: {
					href: node.attributes.href,
				},
			};
		}

		return undefined;
	}

	/**
	 * Serializes one supported block node into editor HTML.
	 */
	private static serializeBlockNodeToHtml(node: JiraAdfBlockNode): string {
		if (node.type === 'paragraph') {
			return `<p>${JiraAdfDocumentCodec.serializeInlineNodesToHtml(node.content ?? [])}</p>`;
		}

		if (node.type === 'bulletList' || node.type === 'orderedList') {
			const tagName = node.type === 'bulletList' ? 'ul' : 'ol';
			const items = node.content.map((item) => JiraAdfDocumentCodec.serializeListItemNodeToHtml(item)).join('');
			return `<${tagName}>${items}</${tagName}>`;
		}

		return JiraAdfDocumentCodec.serializeListItemNodeToHtml(node);
	}

	/**
	 * Serializes one list-item block into editor HTML.
	 */
	private static serializeListItemNodeToHtml(node: JiraAdfListItemNode): string {
		const content = node.content.map((child) => JiraAdfDocumentCodec.serializeBlockNodeToHtml(child)).join('');
		return `<li>${content || '<p></p>'}</li>`;
	}

	/**
	 * Serializes inline ADF nodes into editor-safe HTML.
	 */
	private static serializeInlineNodesToHtml(nodes: JiraAdfInlineNode[]): string {
		return nodes.map((node) => JiraAdfDocumentCodec.serializeInlineNodeToHtml(node)).join('');
	}

	/**
	 * Serializes one supported inline ADF node into editor-safe HTML.
	 */
	private static serializeInlineNodeToHtml(node: JiraAdfInlineNode): string {
		if (node.type === 'hardBreak') {
			return '<br>';
		}

		if (node.type === 'mention') {
			const mentionText = JiraAdfDocumentCodec.normalizeMentionText(node.attrs.text) || '@unknown';
			return `<span class="jira-rich-editor-mention" data-mention-id="${JiraAdfDocumentCodec.escapeAttribute(
				node.attrs.id
			)}" data-mention-text="${JiraAdfDocumentCodec.escapeAttribute(mentionText)}" data-mention-user-type="${JiraAdfDocumentCodec.escapeAttribute(
				node.attrs.userType || 'DEFAULT'
			)}"${node.attrs.accessLevel ? ` data-mention-access-level="${JiraAdfDocumentCodec.escapeAttribute(node.attrs.accessLevel)}"` : ''}>${JiraAdfDocumentCodec.escapeHtml(
				mentionText
			)}</span>`;
		}

		return JiraAdfDocumentCodec.applyMarksToHtml(JiraAdfDocumentCodec.escapeHtml(node.text), node.marks);
	}

	/**
	 * Serializes one supported block node into readable wiki-preview text.
	 */
	private static serializeBlockNodeToWiki(node: JiraAdfBlockNode): string {
		if (node.type === 'paragraph') {
			return JiraAdfDocumentCodec.serializeInlineNodesToWiki(node.content ?? []);
		}

		if (node.type === 'bulletList' || node.type === 'orderedList') {
			const prefix = node.type === 'bulletList' ? '*' : '#';
			return node.content
				.map((item) => JiraAdfDocumentCodec.serializeListItemNodeToWiki(item, prefix))
				.filter((value) => value.length > 0)
				.join('\n');
		}

		return JiraAdfDocumentCodec.serializeListItemNodeToWiki(node, '*');
	}

	/**
	 * Serializes one list-item block into readable wiki-preview text.
	 */
	private static serializeListItemNodeToWiki(node: JiraAdfListItemNode, prefix: '*' | '#'): string {
		const lines: string[] = [];
		for (const block of node.content) {
			if (block.type === 'paragraph') {
				const line = JiraAdfDocumentCodec.serializeInlineNodesToWiki(block.content ?? []);
				if (line.length > 0) {
					lines.push(`${prefix} ${line}`);
				}
				continue;
			}

			const nested = JiraAdfDocumentCodec.serializeBlockNodeToWiki(block);
			if (nested.length > 0) {
				lines.push(nested);
			}
		}

		return lines.join('\n');
	}

	/**
	 * Serializes inline ADF nodes into readable wiki-preview text.
	 */
	private static serializeInlineNodesToWiki(nodes: JiraAdfInlineNode[]): string {
		return nodes.map((node) => JiraAdfDocumentCodec.serializeInlineNodeToWiki(node)).join('');
	}

	/**
	 * Serializes one supported inline ADF node into readable wiki-preview text.
	 */
	private static serializeInlineNodeToWiki(node: JiraAdfInlineNode): string {
		if (node.type === 'hardBreak') {
			return '\\\\';
		}

		if (node.type === 'mention') {
			return JiraAdfDocumentCodec.normalizeMentionText(node.attrs.text) || '@unknown';
		}

		return JiraAdfDocumentCodec.applyMarksToWiki(node.text, node.marks);
	}

	/**
	 * Serializes one supported block node into plain text.
	 */
	private static serializeBlockNodeToPlainText(node: JiraAdfBlockNode): string {
		if (node.type === 'paragraph') {
			return JiraAdfDocumentCodec.serializeInlineNodesToPlainText(node.content ?? []);
		}

		if (node.type === 'bulletList' || node.type === 'orderedList') {
			return node.content
				.map((item) => JiraAdfDocumentCodec.serializeListItemNodeToPlainText(item))
				.filter((value) => value.length > 0)
				.join('\n');
		}

		return JiraAdfDocumentCodec.serializeListItemNodeToPlainText(node);
	}

	/**
	 * Serializes one list-item block into plain text.
	 */
	private static serializeListItemNodeToPlainText(node: JiraAdfListItemNode): string {
		return node.content
			.map((block) => JiraAdfDocumentCodec.serializeBlockNodeToPlainText(block))
			.filter((value) => value.length > 0)
			.join('\n');
	}

	/**
	 * Serializes inline ADF nodes into plain text.
	 */
	private static serializeInlineNodesToPlainText(nodes: JiraAdfInlineNode[]): string {
		return nodes.map((node) => JiraAdfDocumentCodec.serializeInlineNodeToPlainText(node)).join('');
	}

	/**
	 * Serializes one supported inline ADF node into plain text.
	 */
	private static serializeInlineNodeToPlainText(node: JiraAdfInlineNode): string {
		if (node.type === 'hardBreak') {
			return '\n';
		}

		if (node.type === 'mention') {
			return JiraAdfDocumentCodec.normalizeMentionText(node.attrs.text) || '@unknown';
		}

		return node.text;
	}

	/**
	 * Applies supported inline marks to plain text when generating wiki-preview content.
	 */
	private static applyMarksToWiki(text: string, marks: JiraAdfMark[] | undefined): string {
		if (!marks || marks.length === 0) {
			return text;
		}

		let result = text;
		for (const mark of marks.filter((candidate) => candidate.type !== 'link')) {
			if (mark.type === 'strong') {
				result = `*${result}*`;
				continue;
			}

			if (mark.type === 'em') {
				result = `_${result}_`;
				continue;
			}

			if (mark.type === 'underline') {
				result = `+${result}+`;
			}
		}

		const linkMark = marks.find((candidate) => candidate.type === 'link');
		const href = linkMark?.attrs?.href?.trim();
		return href ? `[${result}|${href}]` : result;
	}

	/**
	 * Applies supported inline marks to escaped HTML text.
	 */
	private static applyMarksToHtml(text: string, marks: JiraAdfMark[] | undefined): string {
		if (!marks || marks.length === 0) {
			return text;
		}

		let result = text;
		for (const mark of marks.filter((candidate) => candidate.type !== 'link')) {
			if (mark.type === 'strong') {
				result = `<strong>${result}</strong>`;
				continue;
			}

			if (mark.type === 'em') {
				result = `<em>${result}</em>`;
				continue;
			}

			if (mark.type === 'underline') {
				result = `<u>${result}</u>`;
			}
		}

		const linkMark = marks.find((candidate) => candidate.type === 'link');
		const href = linkMark?.attrs?.href?.trim();
		return href ? `<a href="${JiraAdfDocumentCodec.escapeAttribute(href)}">${result}</a>` : result;
	}

	/**
	 * Returns a stable comparison key for a text node mark set.
	 */
	private static getMarksKey(marks: JiraAdfMark[] | undefined): string {
		return JSON.stringify(marks ?? []);
	}

	/**
	 * Returns whether a parsed element should be treated as a flow-level block boundary.
	 */
	private static isBlockElement(tagName: string): boolean {
		return (
			tagName === 'p' ||
			tagName === 'ul' ||
			tagName === 'ol' ||
			tagName === 'div' ||
			tagName === 'section' ||
			tagName === 'article' ||
			tagName === 'aside' ||
			tagName === 'header' ||
			tagName === 'footer' ||
			tagName === 'main' ||
			tagName === 'nav' ||
			tagName === 'blockquote'
		);
	}

	/**
	 * Returns whether a parsed element carries mention metadata.
	 */
	private static isMentionElement(node: HtmlElementNode): boolean {
		return typeof node.attributes['data-mention-id'] === 'string' && node.attributes['data-mention-id'].trim().length > 0;
	}

	/**
	 * Collects the rendered text content under one parsed element.
	 */
	private static collectElementText(node: HtmlElementNode): string {
		return node.children.map((child) => JiraAdfDocumentCodec.collectNodeText(child)).join('');
	}

	/**
	 * Collects the rendered text content under one parsed node.
	 */
	private static collectNodeText(node: HtmlNode): string {
		if (node.type === 'text') {
			return JiraAdfDocumentCodec.decodeHtmlEntities(node.text);
		}

		return node.children.map((child) => JiraAdfDocumentCodec.collectNodeText(child)).join('');
	}

	/**
	 * Normalizes mention text so it always renders with the leading @ marker.
	 */
	private static normalizeMentionText(text: string | undefined): string | undefined {
		const normalized = text?.trim();
		if (!normalized) {
			return undefined;
		}

		return normalized.startsWith('@') ? normalized : `@${normalized}`;
	}

	/**
	 * Parses a fragment of editor HTML into a lightweight node tree that does not depend on browser DOM APIs.
	 */
	private static parseHtmlFragment(html: string): HtmlElementNode {
		const root: HtmlElementNode = {
			type: 'element',
			tagName: 'root',
			attributes: {},
			children: [],
		};
		const stack: HtmlElementNode[] = [root];
		const tokenPattern = /<!--[\s\S]*?-->|<\/?[^>]+>|[^<]+/g;
		const voidTags = new Set(['br']);

		for (let match = tokenPattern.exec(html); match; match = tokenPattern.exec(html)) {
			const token = match[0];
			if (token.startsWith('<!--')) {
				continue;
			}

			if (token.startsWith('</')) {
				const closingTag = token.slice(2, -1).trim().toLowerCase();
				for (let index = stack.length - 1; index > 0; index--) {
					if (stack[index].tagName === closingTag) {
						stack.length = index;
						break;
					}
				}
				continue;
			}

			if (token.startsWith('<')) {
				const isSelfClosing = token.endsWith('/>');
				const tagMatch = /^<\s*([a-zA-Z0-9-]+)/.exec(token);
				if (!tagMatch) {
					continue;
				}

				const tagName = tagMatch[1].toLowerCase();
				const element: HtmlElementNode = {
					type: 'element',
					tagName,
					attributes: JiraAdfDocumentCodec.parseTagAttributes(token),
					children: [],
				};
				stack[stack.length - 1].children.push(element);
				if (!isSelfClosing && !voidTags.has(tagName)) {
					stack.push(element);
				}
				continue;
			}

			stack[stack.length - 1].children.push({
				type: 'text',
				text: token,
			});
		}

		return root;
	}

	/**
	 * Parses HTML attributes from one start tag.
	 */
	private static parseTagAttributes(tag: string): Record<string, string> {
		const attributes: Record<string, string> = {};
		const tagNameMatch = /^<\s*([a-zA-Z0-9-]+)/.exec(tag);
		const tagName = tagNameMatch?.[1]?.toLowerCase();
		const attributePattern = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
		attributePattern.lastIndex = tagNameMatch ? tagNameMatch[0].length : 0;

		for (let match = attributePattern.exec(tag); match; match = attributePattern.exec(tag)) {
			const name = match[1].toLowerCase();
			const value = match[2] ?? match[3] ?? match[4] ?? '';
			if (name !== tagName) {
				attributes[name] = value;
			}
		}

		return attributes;
	}

	/**
	 * Escapes HTML text content before it is inserted into serialized HTML.
	 */
	private static escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	/**
	 * Escapes HTML attribute values before serialization.
	 */
	private static escapeAttribute(text: string): string {
		return JiraAdfDocumentCodec.escapeHtml(text).replace(/`/g, '&#96;');
	}

	/**
	 * Decodes the small HTML entity set emitted by editor content.
	 */
	private static decodeHtmlEntities(text: string): string {
		return text
			.replace(/&#(\d+);/g, (match: string, value: string) =>
				JiraAdfDocumentCodec.decodeNumericEntity(match, Number.parseInt(value, 10))
			)
			.replace(/&#x([0-9a-f]+);/gi, (match: string, value: string) =>
				JiraAdfDocumentCodec.decodeNumericEntity(match, Number.parseInt(value, 16))
			)
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/&nbsp;/g, ' ');
	}

	/**
	 * Safely decodes a numeric HTML entity without throwing on invalid code points.
	 */
	private static decodeNumericEntity(fallback: string, codePoint: number): string {
		if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
			return fallback;
		}

		try {
			return String.fromCodePoint(codePoint);
		} catch {
			return fallback;
		}
	}
}

/**
 * Represents one node in the lightweight HTML fragment tree used by the ADF codec.
 */
type HtmlNode = HtmlTextNode | HtmlElementNode;

/**
 * Represents a text node inside a parsed HTML fragment.
 */
type HtmlTextNode = {
	/**
	 * Identifies the parsed node as a text node.
	 */
	type: 'text';

	/**
	 * Carries the literal text content emitted by the fragment parser.
	 */
	text: string;
};

/**
 * Represents an element node inside a parsed HTML fragment.
 */
type HtmlElementNode = {
	/**
	 * Identifies the parsed node as an element node.
	 */
	type: 'element';

	/**
	 * Carries the normalized lowercase HTML tag name.
	 */
	tagName: string;

	/**
	 * Carries the parsed HTML attributes for the element.
	 */
	attributes: Record<string, string>;

	/**
	 * Carries the parsed children for the element node.
	 */
	children: HtmlNode[];
};
