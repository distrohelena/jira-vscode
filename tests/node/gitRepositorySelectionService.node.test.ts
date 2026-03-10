import assert from 'node:assert/strict';
import test from 'node:test';

import { GitRepositorySelectionCandidate, GitRepositorySelectionService } from '../../src/services/git-repository-selection.service';

class GitRepositorySelectionServiceTestData {
	static createRepository(selected?: boolean): GitRepositorySelectionCandidate {
		return {
			inputBox: {} as never,
			ui: selected === undefined ? undefined : { selected },
		};
	}
}

test('getPreferredRepository returns undefined when no repositories are available', () => {
	assert.equal(GitRepositorySelectionService.getPreferredRepository(undefined), undefined);
	assert.equal(GitRepositorySelectionService.getPreferredRepository([]), undefined);
});

test('getPreferredRepository prefers the repository selected in SCM', () => {
	const primaryRepository = GitRepositorySelectionServiceTestData.createRepository(false);
	const selectedRepository = GitRepositorySelectionServiceTestData.createRepository(true);

	const repository = GitRepositorySelectionService.getPreferredRepository([primaryRepository, selectedRepository]);
	assert.equal(repository, selectedRepository);
});

test('getPreferredRepository falls back to the first repository when SCM selection is unavailable', () => {
	const firstRepository = GitRepositorySelectionServiceTestData.createRepository();
	const secondRepository = GitRepositorySelectionServiceTestData.createRepository();

	const repository = GitRepositorySelectionService.getPreferredRepository([firstRepository, secondRepository]);
	assert.equal(repository, firstRepository);
});
