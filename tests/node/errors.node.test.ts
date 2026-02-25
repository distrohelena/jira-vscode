import assert from 'node:assert/strict';
import test from 'node:test';

import { ErrorHelper } from '../../src/shared/error.helper';

class ErrorTestData {
	static createAxiosLikeError(options: {
		status?: number;
		statusText?: string;
		data?: unknown;
		code?: string;
		message?: string;
	}): unknown {
		return {
			isAxiosError: true,
			code: options.code,
			message: options.message ?? 'Request failed',
			response:
				options.status === undefined
					? undefined
					: {
							status: options.status,
							statusText: options.statusText,
							data: options.data,
					  },
		};
	}
}

test('isJiraCredentialError identifies 401 responses', () => {
	const error = ErrorTestData.createAxiosLikeError({ status: 401, statusText: 'Unauthorized' });
	assert.equal(ErrorHelper.isJiraCredentialError(error), true);
	assert.equal(
		ErrorHelper.deriveErrorMessage(error),
		'Jira authentication failed. Your API key may be invalid or expired. Please log in again.'
	);
});

test('isJiraCredentialError identifies 403 credential payloads', () => {
	const error = ErrorTestData.createAxiosLikeError({
		status: 403,
		statusText: 'Forbidden',
		data: {
			errorMessages: ['Invalid API token provided.'],
		},
	});
	assert.equal(ErrorHelper.isJiraCredentialError(error), true);
});

test('isJiraCredentialError ignores non-auth 403 responses', () => {
	const error = ErrorTestData.createAxiosLikeError({
		status: 403,
		statusText: 'Forbidden',
		data: {
			errorMessages: ['No permission for this project.'],
		},
	});
	assert.equal(ErrorHelper.isJiraCredentialError(error), false);
	assert.equal(ErrorHelper.deriveErrorMessage(error), '403 Forbidden');
});

test('deriveErrorMessage handles ENOTFOUND', () => {
	const error = ErrorTestData.createAxiosLikeError({
		code: 'ENOTFOUND',
		message: 'getaddrinfo ENOTFOUND jira.example.invalid',
	});
	assert.equal(ErrorHelper.deriveErrorMessage(error), 'Unable to reach Jira server (host not found).');
});

test('deriveErrorMessage returns native error message', () => {
	const error = new Error('Boom');
	assert.equal(ErrorHelper.deriveErrorMessage(error), 'Boom');
});

test('deriveErrorMessage falls back to unknown error', () => {
	assert.equal(ErrorHelper.deriveErrorMessage({ unexpected: true }), 'Unknown error');
});
