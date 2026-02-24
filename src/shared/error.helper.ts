import axios, { AxiosError } from 'axios';

const AUTH_FAILURE_PATTERNS = [
	'unauthorized',
	'authentication',
	'authenticate',
	'api token',
	'invalid token',
	'expired token',
	'basic auth',
	'credentials',
];

export function isJiraCredentialError(error: unknown): boolean {
	if (!axios.isAxiosError(error)) {
		return false;
	}

	const axiosError = error as AxiosError<any>;
	const status = axiosError.response?.status;
	const payloadText = extractAxiosPayloadText(axiosError).toLowerCase();
	const hasAuthPattern = AUTH_FAILURE_PATTERNS.some((pattern) => payloadText.includes(pattern));

	if (status === 401) {
		return true;
	}

	if (status === 403) {
		return hasAuthPattern;
	}

	return hasAuthPattern && status !== undefined && status >= 400 && status < 500;
}

export function deriveErrorMessage(error: unknown): string {
	if (isJiraCredentialError(error)) {
		return 'Jira authentication failed. Your API key may be invalid or expired. Please log in again.';
	}

	if (axios.isAxiosError(error)) {
		const axiosError = error as AxiosError<any>;
		const status = axiosError.response?.status;
		const statusText = axiosError.response?.statusText;
		if (status) {
			return `${status}${statusText ? ` ${statusText}` : ''}`;
		}
		if (axiosError.code === 'ENOTFOUND') {
			return 'Unable to reach Jira server (host not found).';
		}
		return axiosError.message;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return 'Unknown error';
}

function extractAxiosPayloadText(error: AxiosError<any>): string {
	const data = error.response?.data;
	if (!data) {
		return error.message ?? '';
	}

	if (typeof data === 'string') {
		return data;
	}

	if (typeof data === 'object') {
		const values: string[] = [];
		const errorMessages = Array.isArray((data as { errorMessages?: unknown }).errorMessages)
			? ((data as { errorMessages: unknown[] }).errorMessages ?? []).filter(
					(value): value is string => typeof value === 'string'
			  )
			: [];
		const errorsObject = (data as { errors?: Record<string, unknown> }).errors;
		values.push(...errorMessages);
		if (errorsObject && typeof errorsObject === 'object') {
			for (const value of Object.values(errorsObject)) {
				if (typeof value === 'string') {
					values.push(value);
				}
			}
		}
		if (values.length > 0) {
			return values.join(' ');
		}
	}

	return error.message ?? '';
}
