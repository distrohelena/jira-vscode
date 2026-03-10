import { GitRepository } from '../model/jira.type';

/**
 * Describes the UI state exposed by the Git extension for a repository.
 */
export type GitRepositoryUiState = {
	/**
	 * Indicates whether the repository is currently selected in the SCM repositories list.
	 */
	selected?: boolean;
};

/**
 * Describes the subset of the Git repository API needed to resolve a commit target.
 */
export type GitRepositorySelectionCandidate = GitRepository & {
	/**
	 * Exposes UI state for repository selection when VS Code provides it.
	 */
	ui?: GitRepositoryUiState;
};

/**
 * Resolves which Git repository should receive Jira-generated commit content.
 */
export class GitRepositorySelectionService {
	/**
	 * Selects the repository currently highlighted in SCM and falls back to the first repository when needed.
	 */
	static getPreferredRepository(
		repositories: ReadonlyArray<GitRepositorySelectionCandidate> | undefined
	): GitRepositorySelectionCandidate | undefined {
		if (!repositories || repositories.length === 0) {
			return undefined;
		}

		const selectedRepository = repositories.find((repository) => repository.ui?.selected);
		return selectedRepository ?? repositories[0];
	}
}
