import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { GitCommitHistoryEntry, JiraIssue } from '../model/jira.type';

/**
 * Captures the stdout and stderr returned by one Git process invocation.
 */
type GitCommandExecutionResult = {
	/**
	 * The standard output returned by the Git command.
	 */
	stdout: string;

	/**
	 * The standard error returned by the Git command.
	 */
	stderr: string;
};

/**
 * Describes the injected Git command runner used for testing and local process execution.
 */
type GitCommandRunner = (repositoryPath: string, args: readonly string[]) => Promise<GitCommandExecutionResult>;

/**
 * Runs a Git subprocess in the provided repository.
 */
const runGitCommandInternal: GitCommandRunner = async (
	repositoryPath: string,
	args: readonly string[]
): Promise<GitCommandExecutionResult> => {
	const executeFileAsync = promisify(execFile);
	const result = await executeFileAsync('git', [...args], {
		cwd: repositoryPath,
		maxBuffer: 8 * 1024 * 1024,
		windowsHide: true,
	});
	return {
		stdout: result.stdout,
		stderr: result.stderr,
	};
};

/**
 * Searches and loads Git commit history for Jira issues against the selected local repository.
 */
export class GitCommitHistoryService {
	/**
	 * Separates one parsed Git log field from the next.
	 */
	private static readonly FieldSeparator = '\u001f';

	/**
	 * Separates one parsed Git log record from the next.
	 */
	private static readonly RecordSeparator = '\u001e';

	/**
	 * Bounds the number of commit history results shown in the picker.
	 */
	private static readonly MaxCommitResults = 50;

	/**
	 * Creates the service with an overridable Git command runner for tests.
	 */
	constructor(private readonly gitCommandRunner: GitCommandRunner = runGitCommandInternal) {}

	/**
	 * Searches local commit history using the Jira issue key and summary as commit-message filters.
	 */
	async searchIssueCommitHistory(repositoryPath: string, issue: JiraIssue): Promise<GitCommitHistoryEntry[]> {
		const searchPatterns = this.buildSearchPatterns(issue);
		if (searchPatterns.length === 0) {
			return [];
		}

		const result = await this.gitCommandRunner(repositoryPath, this.buildLogArguments(searchPatterns));
		return GitCommitHistoryService.parseLogOutput(result.stdout);
	}

	/**
	 * Loads the full Git show output for the selected commit hash.
	 */
	async loadCommitDetails(repositoryPath: string, commitHash: string): Promise<string> {
		const normalizedCommitHash = commitHash?.trim();
		if (!normalizedCommitHash) {
			throw new Error('Commit hash is required.');
		}

		const result = await this.gitCommandRunner(repositoryPath, [
			'show',
			'--stat',
			'--patch',
			'--format=fuller',
			normalizedCommitHash,
		]);
		return result.stdout;
	}

	/**
	 * Builds the bounded git log command arguments used to search commit messages.
	 */
	private buildLogArguments(searchPatterns: readonly string[]): string[] {
		return [
			'log',
			'--regexp-ignore-case',
			'--perl-regexp',
			`--max-count=${GitCommitHistoryService.MaxCommitResults}`,
			'--date=short',
			`--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e`,
			...searchPatterns.flatMap((pattern) => ['--grep', GitCommitHistoryService.escapeRegex(pattern)]),
		];
	}

	/**
	 * Extracts the stable issue key and summary search patterns used against commit messages.
	 */
	private buildSearchPatterns(issue: JiraIssue): string[] {
		const candidates = [issue.key, issue.summary]
			.map((value) => value?.trim())
			.filter((value): value is string => !!value);
		return Array.from(new Set(candidates));
	}

	/**
	 * Parses the structured git log output into picker-friendly commit history entries.
	 */
	private static parseLogOutput(output: string): GitCommitHistoryEntry[] {
		const records = output
			.split(GitCommitHistoryService.RecordSeparator)
			.map((value) => value.trim())
			.filter((value) => value.length > 0);

		return records
			.map((record) => record.split(GitCommitHistoryService.FieldSeparator))
			.map(([hash, shortHash, authorName, authoredDate, subject]) => ({
				hash: hash?.trim() ?? '',
				shortHash: shortHash?.trim() ?? '',
				authorName: authorName?.trim() ?? 'Unknown author',
				authoredDate: authoredDate?.trim() ?? 'Unknown date',
				subject: subject?.trim() ?? '(no subject)',
			}))
			.filter((entry) => entry.hash.length > 0);
	}

	/**
	 * Escapes a plain-text search term so Git can evaluate it as a safe regex literal.
	 */
	private static escapeRegex(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}
