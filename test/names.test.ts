import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	driveAppUrl,
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
