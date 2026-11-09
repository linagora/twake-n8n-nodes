import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROOT_DIR_ID, walkTree } from '../packages/n8n-nodes-twakedrive/nodes/TwakeDrive/tree.ts';

const entry = (id: string, name: string, type: string) => ({ id, attributes: { name, type } });
const tree: Record<string, ReturnType<typeof entry>[]> = {
	[ROOT_DIR_ID]: [
		entry('io.cozy.files.trash-dir', '.cozy_trash', 'directory'),
		entry('b', 'Bills', 'directory'),
		entry('r', 'readme.md', 'file'),
	],
	b: [entry('i', 'invoice.pdf', 'file')],
	'io.cozy.files.trash-dir': [entry('x', 'deleted.pdf', 'file')],
};
const list = async (id: string) => [...tree[id]];

test('lists folders with their path, starting at the root, without the trash', async () => {
	const { results, paginationToken } = await walkTree(list, 'directory');
	assert.deepEqual(results, [
		{ name: '/', value: ROOT_DIR_ID },
		{ name: '/Bills', value: 'b' },
	]);
	assert.equal(paginationToken, undefined);
});

test('finds files of sub-folders by path, whatever the case', async () => {
	const { results } = await walkTree(list, 'file', 'BILLS/inv');
	assert.deepEqual(results, [{ name: '/Bills/invoice.pdf', value: 'i' }]);
});

test('resumes from the pagination token', async () => {
	const big = async (id: string) =>
		id === ROOT_DIR_ID
			? [
					entry('d', 'Deep', 'directory'),
					...Array.from({ length: 50 }, (_, n) => entry(`f${n}`, `f${n}`, 'file')),
				]
			: [entry('last', 'last', 'file')];
	const first = await walkTree(big, 'file');
	assert.equal(first.results.length, 50);
	const second = await walkTree(big, 'file', undefined, first.paginationToken);
	assert.deepEqual(second.results, [{ name: '/Deep/last', value: 'last' }]);
	assert.equal(second.paginationToken, undefined);
});
