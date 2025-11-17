import * as vscode from 'vscode';

import { AUTH_STATE_KEY, SECRET_PREFIX } from './constants';
import { deriveErrorMessage } from '../shared/errors';
import { normalizeBaseUrl } from '../shared/urlUtils';
import { inferServerLabelFromProfile, verifyCredentials } from './jiraApiClient';
import { JiraAuthInfo, JiraServerLabel } from './types';

export class JiraAuthManager implements vscode.Disposable {
	private authChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeAuth: vscode.Event<void> = this.authChangeEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	dispose(): void {
		this.authChangeEmitter.dispose();
	}

	async getAuthInfo(): Promise<JiraAuthInfo | undefined> {
		return this.context.globalState.get<JiraAuthInfo>(AUTH_STATE_KEY);
	}

	private async saveAuthInfo(info: JiraAuthInfo | undefined) {
		await this.context.globalState.update(AUTH_STATE_KEY, info);
		this.authChangeEmitter.fire();
	}

	async login(): Promise<void> {
		const selection = await vscode.window.showQuickPick<{ label: string; value: JiraServerLabel }>(
			[
				{ label: 'Jira Cloud (Atlassian)', value: 'cloud' },
				{ label: 'Custom Jira Server/Data Center', value: 'custom' },
			],
			{
				title: 'Select Jira deployment type',
				ignoreFocusOut: true,
			}
		);

		if (!selection) {
			return;
		}

		const configBaseUrl = vscode.workspace.getConfiguration('jira').get<string>('baseUrl')?.trim();
		const baseUrlInput = await vscode.window.showInputBox({
			title: 'Jira base URL',
			prompt:
				selection.value === 'cloud'
					? 'Example: https://your-domain.atlassian.net'
					: 'Example: https://jira.my-company.internal',
			value: configBaseUrl && configBaseUrl !== 'https://your-domain.atlassian.net' ? configBaseUrl : undefined,
			validateInput: (value) => {
				if (!value) {
					return 'Base URL is required';
				}
				try {
					new URL(value);
					return undefined;
				} catch {
					return 'Enter a valid URL starting with http or https';
				}
			},
			ignoreFocusOut: true,
		});

		if (!baseUrlInput) {
			return;
		}

		const normalizedBaseUrl = normalizeBaseUrl(baseUrlInput);

		const username = await vscode.window.showInputBox({
			title: selection.value === 'cloud' ? 'Atlassian account email' : 'Jira username/email',
			prompt: 'This will be used with your API token.',
			validateInput: (value) => (!value ? 'Username or email is required' : undefined),
			ignoreFocusOut: true,
		});

		if (!username) {
			return;
		}

		const token = await vscode.window.showInputBox({
			title: selection.value === 'cloud' ? 'Atlassian API token' : 'Jira API token/password',
			prompt:
				selection.value === 'cloud'
					? 'Create/manage tokens at https://id.atlassian.com/manage-profile/security/api-tokens'
					: 'Provide a Personal Access Token or password (sent over HTTPS).',
			password: true,
			validateInput: (value) => (!value ? 'Token or password is required' : undefined),
			ignoreFocusOut: true,
		});

		if (!token) {
			return;
		}

		const accountKey = buildAccountKey(normalizedBaseUrl, username);

		try {
			const profile = await verifyCredentials(normalizedBaseUrl, username, token, selection.value);
			const serverLabel = inferServerLabelFromProfile(profile) ?? selection.value;
			await this.context.secrets.store(buildSecretKey(accountKey), token);
			await this.saveAuthInfo({
				baseUrl: normalizedBaseUrl,
				username,
				displayName: profile.displayName ?? profile.name ?? username,
				accountId: profile.accountId ?? profile.key,
				serverLabel,
			});

			await vscode.window.showInformationMessage(`Connected to Jira as ${profile.displayName ?? username}`);
		} catch (error) {
			const message = deriveErrorMessage(error);
			await vscode.window.showErrorMessage(`Failed to connect to Jira: ${message}`);
		}
	}

	async logout(): Promise<void> {
		const authInfo = await this.getAuthInfo();
		if (!authInfo) {
			return;
		}
		const accountKey = buildAccountKey(authInfo.baseUrl, authInfo.username);
		await this.context.secrets.delete(buildSecretKey(accountKey));
		await this.saveAuthInfo(undefined);
		await vscode.window.showInformationMessage('Disconnected from Jira.');
	}

	async getToken(): Promise<string | undefined> {
		const authInfo = await this.getAuthInfo();
		if (!authInfo) {
			return undefined;
		}
		const accountKey = buildAccountKey(authInfo.baseUrl, authInfo.username);
		const token = await this.context.secrets.get(buildSecretKey(accountKey));
		return token ?? undefined;
	}
}

function buildAccountKey(baseUrl: string, username: string): string {
	return `${baseUrl}:${username}`;
}

function buildSecretKey(accountKey: string): string {
	return `${SECRET_PREFIX}:${accountKey}`;
}
