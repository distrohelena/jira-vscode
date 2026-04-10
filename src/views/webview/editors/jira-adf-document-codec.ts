import type {
	JiraAdfBlockNode,
	JiraAdfDocument,
	JiraAdfInlineNode,
} from '../../../model/jira.type';

/**
 * Converts supported Jira Atlassian Document Format content into the plain-text and wiki-preview forms
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
	 * Converts a supported ADF document into readable wiki-preview text.
	 */
	static convertAdfToWikiPreview(document: JiraAdfDocument | undefined): string {
		return JiraAdfDocumentCodec.serializeDocument(document);
	}

	/**
	 * Extracts a readable plain-text representation from a supported ADF document.
	 */
	static extractPlainText(document: JiraAdfDocument | undefined): string {
		return JiraAdfDocumentCodec.serializeDocument(document);
	}

	/**
	 * Serializes a supported ADF document into readable text while preserving block spacing and hard breaks.
	 */
	private static serializeDocument(document: JiraAdfDocument | undefined): string {
		if (!document) {
			return '';
		}

		return document.content
			.map((node) => JiraAdfDocumentCodec.serializeBlockNode(node))
			.filter((value) => value.length > 0)
			.join('\n\n')
			.trim();
	}

	/**
	 * Serializes one supported block node into readable text.
	 */
	private static serializeBlockNode(node: JiraAdfBlockNode): string {
		if (node.type !== 'paragraph') {
			return '';
		}

		return (node.content ?? [])
			.map((child) => JiraAdfDocumentCodec.serializeInlineNode(child))
			.join('');
	}

	/**
	 * Serializes one supported inline node into readable text.
	 */
	private static serializeInlineNode(node: JiraAdfInlineNode): string {
		if (node.type === 'text') {
			return node.text;
		}

		if (node.type === 'hardBreak') {
			return '\n';
		}

		return node.attrs.text?.trim() || '@unknown';
	}
}
