import assert from 'node:assert/strict';
import test from 'node:test';

import { ItemsTreeIdentityService } from '../../src/services/items-tree-identity.service';

test('createStatusGroupId stays stable across case and spacing differences', () => {
	const firstId = ItemsTreeIdentityService.createStatusGroupId('PROJ', 'In Progress');
	const secondId = ItemsTreeIdentityService.createStatusGroupId(' proj ', ' in   progress ');

	assert.equal(firstId, secondId);
});

test('createStatusGroupId isolates groups by project', () => {
	const firstProjectId = ItemsTreeIdentityService.createStatusGroupId('PROJ', 'In Progress');
	const secondProjectId = ItemsTreeIdentityService.createStatusGroupId('OTHER', 'In Progress');

	assert.notEqual(firstProjectId, secondProjectId);
});

test('createTypeGroupId uses a distinct namespace from status groups', () => {
	const statusId = ItemsTreeIdentityService.createStatusGroupId('PROJ', 'Bug');
	const typeId = ItemsTreeIdentityService.createTypeGroupId('PROJ', 'Bug');

	assert.notEqual(statusId, typeId);
});
