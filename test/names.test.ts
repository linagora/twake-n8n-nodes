import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { IHttpRequestOptions } from 'n8n-workflow';

import {
	driveAppUrl,
	fetchEditLink,
	withExtensionOf,
} from '../packages/n8n-nodes-twakedrive/nodes/TwakeDrive/names.ts';

test('withExtensionOf keeps the extension of the source file', () => {
	assert.equal(withExtensionOf('new', 'old.pdf'), 'new.pdf');
	assert.equal(withExtensionOf('new.txt', 'old.pdf'), 'new.pdf');
	assert.equal(withExtensionOf('new.v2', 'old'), 'new.v2');
	assert.equal(withExtensionOf('new', '.hidden'), 'new');
});

test('driveAppUrl handles flat and nested subdomains', () => {
	assert.equal(driveAppUrl('https://alice.twake.app', true), 'https://alice-drive.twake.app');
	assert.equal(
		driveAppUrl('http://alice.cozy.localhost:8080', false),
		'http://drive.alice.cozy.localhost:8080',
	);
});

test('fetchEditLink checks the file can open in OnlyOffice, links to the Drive editor, drops the token', async () => {
	const calls: IHttpRequestOptions[] = [];
	const open = {
		data: {
			id: 'f1',
			attributes: { document_id: 'f1', onlyoffice: { token: 'secret', url: 'https://oo.test' } },
		},
	};
	const capabilities = { data: { attributes: { flat_subdomains: true } } };
	const responses = [open, capabilities];
	const request = async (options: IHttpRequestOptions) => {
		calls.push(options);
		return responses.shift()!;
	};

	const output = await fetchEditLink(request, 'https://alice.twake.app', 'f1');

	assert.deepEqual(output, {
		editUrl: 'https://alice-drive.twake.app/#/onlyoffice/f1',
		response: { data: { id: 'f1', attributes: { document_id: 'f1' } } },
	});
	assert.deepEqual(
		calls.map(({ url }) => url),
		['/office/f1/open', '/settings/capabilities'],
	);
});

test('fetchEditLink stops when the stack refuses to open the file', async () => {
	const request = async () => {
		throw new Error('404');
	};
	await assert.rejects(fetchEditLink(request, 'https://alice.twake.app', 'f1'), /404/);
});
