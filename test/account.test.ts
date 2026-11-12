import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listAll } from '../packages/n8n-nodes-twakeaccount/nodes/TwakeAccount/pagination.ts';

test('listAll follows the next link of the stack until there is none', async () => {
	const asked: (string | undefined)[] = [];
	const pages: Record<string, object> = {
		first: {
			data: [{ id: 'a' }, { id: 'b' }],
			links: { next: 'http://alice.test/apps/?limit=0&start_key=io.cozy.apps%2Fc' },
		},
		'io.cozy.apps/c': { data: [{ id: 'c' }] },
	};
	const apps = await listAll(async (startKey) => {
		asked.push(startKey);
		return pages[startKey ?? 'first'];
	});
	assert.deepEqual(apps, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
	assert.deepEqual(asked, [undefined, 'io.cozy.apps/c']);
});

test('listAll answers an empty list when the stack has no data', async () => {
	assert.deepEqual(await listAll(async () => ({})), []);
});
