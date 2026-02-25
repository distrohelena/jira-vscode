import * as vscode from 'vscode';

import { AUTH_STATE_KEY, SECRET_PREFIX } from './jira.constant';
import { ErrorHelper } from '../shared/error.helper';
import { UrlHelper } from '../shared/url.helper';
import { jiraApiClient } from '../jira-api';
import { JiraAuthInfo, JiraServerLabel } from './jira.type';

export type JiraCredentialValidationState = 'unknown' | 'checking' | 'valid' | 'invalid' | 'error';

export type JiraCredentialValidation = {
	state: JiraCredentialValidationState;
	message?: string;
	checkedAt?: number;
};

type ValidateCredentialsOptions = {
	showSuccessMessage?: boolean;
	promptReLogin?: boolean;
	silent?: boolean;
	force?: boolean;
};

export class JiraAuthManager implements vscode.Disposable {
	private authChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeAuth: vscode.Event<void> = this.authChangeEmitter.event;
	private credentialValidationEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeCredentialValidation: vscode.Event<void> =
		this.credentialValidationEmitter.event;
	private credentialValidation: JiraCredentialValidation = { state: 'unknown' };
	private credentialValidationPending?: Promise<JiraCredentialValidation>;

	constructor(private readonly context: vscode.ExtensionContext) {}

	dispose(): void {
		this.authChangeEmitter.dispose();
		this.credentialValidationEmitter.dispose();
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

		const normalizedBaseUrl = UrlHelper.normalizeBaseUrl(baseUrlInput);

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

		const accountKey = JiraAuthManager.buildAccountKey(normalizedBaseUrl, username);

		try {
			const profile = await jiraApiClient.verifyCredentials(normalizedBaseUrl, username, token, selection.value);
			const serverLabel = jiraApiClient.inferServerLabelFromProfile(profile) ?? selection.value;
			await this.context.secrets.store(JiraAuthManager.buildSecretKey(accountKey), token);
			await this.saveAuthInfo({
				baseUrl: normalizedBaseUrl,
				username,
				displayName: profile.displayName ?? profile.name ?? username,
				accountId: profile.accountId ?? profile.key,
				serverLabel,
			});
			this.setCredentialValidation({
				state: 'valid',
				message: `Verified for ${profile.displayName ?? username}`,
				checkedAt: Date.now(),
			});

			await vscode.window.showInformationMessage(`Connected to Jira as ${profile.displayName ?? username}`);
		} catch (error) {
			const message = ErrorHelper.deriveErrorMessage(error);
			await vscode.window.showErrorMessage(`Failed to connect to Jira: ${message}`);
		}
	}

	async logout(): Promise<void> {
		const authInfo = await this.getAuthInfo();
		if (!authInfo) {
			return;
		}
		const accountKey = JiraAuthManager.buildAccountKey(authInfo.baseUrl, authInfo.username);
		await this.context.secrets.delete(JiraAuthManager.buildSecretKey(accountKey));
		await this.saveAuthInfo(undefined);
		this.setCredentialValidation({ state: 'unknown' });
		await vscode.window.showInformationMessage('Disconnected from Jira.');
	}

	async getToken(): Promise<string | undefined> {
		const authInfo = await this.getAuthInfo();
		if (!authInfo) {
			return undefined;
		}
		const accountKey = JiraAuthManager.buildAccountKey(authInfo.baseUrl, authInfo.username);
		const token = await this.context.secrets.get(JiraAuthManager.buildSecretKey(accountKey));
		return token ?? undefined;
	}

	getCredentialValidation(): JiraCredentialValidation {
		return this.credentialValidation;
	}

	async ensureCredentialValidation(force = false): Promise<JiraCredentialValidation> {
		const authInfo = await this.getAuthInfo();
		const token = await this.getToken();
		if (!authInfo || !token) {
			this.setCredentialValidation({ state: 'unknown' });
			return this.credentialValidation;
		}

		if (!force && this.credentialValidation.state === 'valid') {
			return this.credentialValidation;
		}

		if (this.credentialValidationPending) {
			return this.credentialValidationPending;
		}

		this.setCredentialValidation({ state: 'checking', message: 'Checking API key...' });
		this.credentialValidationPending = this.performCredentialValidation(authInfo, token, {
			showSuccessMessage: false,
			promptReLogin: false,
			silent: true,
		}).finally(() => {
			this.credentialValidationPending = undefined;
		});

		return this.credentialValidationPending;
	}

	async validateStoredCredentials(options?: ValidateCredentialsOptions): Promise<boolean> {
		const showSuccessMessage = options?.showSuccessMessage ?? true;
		const promptReLogin = options?.promptReLogin ?? true;
		const silent = options?.silent ?? false;
		const force = options?.force ?? true;
		const authInfo = await this.getAuthInfo();
		if (!authInfo) {
			this.setCredentialValidation({ state: 'unknown' });
			if (!silent) {
				await vscode.window.showInformationMessage('Log in to Jira first.');
			}
			return false;
		}

		const token = await this.getToken();
		if (!token) {
			this.setCredentialValidation({ state: 'unknown', message: 'Missing auth token.' });
			if (!silent) {
				await vscode.window.showInformationMessage('Missing auth token. Please log in again.');
			}
			return false;
		}

		if (!force && this.credentialValidation.state === 'valid') {
			if (showSuccessMessage && !silent) {
				await vscode.window.showInformationMessage(
					`Jira API key is valid for ${authInfo.displayName ?? authInfo.username}.`
				);
			}
			return true;
		}

		if (this.credentialValidationPending) {
			const status = await this.credentialValidationPending;
			return status.state === 'valid';
		}

		this.setCredentialValidation({ state: 'checking', message: 'Checking API key...' });
		this.credentialValidationPending = this.performCredentialValidation(authInfo, token, {
			showSuccessMessage,
			promptReLogin,
			silent,
		}).finally(() => {
			this.credentialValidationPending = undefined;
		});

		const status = await this.credentialValidationPending;
		return status.state === 'valid';
	}

	private setCredentialValidation(next: JiraCredentialValidation): void {
		this.credentialValidation = next;
		this.credentialValidationEmitter.fire();
	}

	private async performCredentialValidation(
		authInfo: JiraAuthInfo,
		token: string,
		options: { showSuccessMessage: boolean; promptReLogin: boolean; silent: boolean }
	): Promise<JiraCredentialValidation> {
		try {
			const profile = await jiraApiClient.verifyCredentials(
				authInfo.baseUrl,
				authInfo.username,
				token,
				authInfo.serverLabel
			);
			const nextInfo: JiraAuthInfo = {
				...authInfo,
				displayName: profile.displayName ?? profile.name ?? authInfo.username,
				accountId: profile.accountId ?? profile.key ?? authInfo.accountId,
			};
			const authChanged =
				nextInfo.displayName !== authInfo.displayName || nextInfo.accountId !== authInfo.accountId;
			if (authChanged) {
				await this.saveAuthInfo(nextInfo);
			}
			const successState: JiraCredentialValidation = {
				state: 'valid',
				message: `Valid for ${nextInfo.displayName ?? authInfo.username}`,
				checkedAt: Date.now(),
			};
			this.setCredentialValidation(successState);
			if (options.showSuccessMessage && !options.silent) {
				await vscode.window.showInformationMessage(
					`Jira API key is valid for ${nextInfo.displayName ?? authInfo.username}.`
				);
			}
			return successState;
		} catch (error) {
			if (ErrorHelper.isJiraCredentialError(error)) {
				const invalidState: JiraCredentialValidation = {
					state: 'invalid',
					message: 'API key invalid or expired.',
					checkedAt: Date.now(),
				};
				this.setCredentialValidation(invalidState);
				if (!options.silent) {
					const choice = await vscode.window.showErrorMessage(
						'Jira authentication failed. Your API key appears invalid or expired.',
						'Log In Again'
					);
					if (choice === 'Log In Again' && options.promptReLogin) {
						await this.login();
					}
				}
				return invalidState;
			}

			const message = ErrorHelper.deriveErrorMessage(error);
			const errorState: JiraCredentialValidation = {
				state: 'error',
				message,
				checkedAt: Date.now(),
			};
			this.setCredentialValidation(errorState);
			if (!options.silent) {
				await vscode.window.showErrorMessage(`Failed to validate Jira credentials: ${message}`);
			}
			return errorState;
		}
	}

	private static buildAccountKey(baseUrl: string, username: string): string {
		return `${baseUrl}:${username}`;
	}

	private static buildSecretKey(accountKey: string): string {
		return `${SECRET_PREFIX}:${accountKey}`;
	}
}
