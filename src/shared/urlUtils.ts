export function normalizeBaseUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) {
		return '';
	}
	return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function extractHost(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		return parsed.host;
	} catch {
		return undefined;
	}
}
