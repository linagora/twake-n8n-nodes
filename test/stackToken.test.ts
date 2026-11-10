import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, test } from 'node:test';

import type { IHttpRequestOptions } from 'n8n-workflow';

import {
	clearStackTokenCache,
	exchangeForStackToken,
	instanceUrlOf,
} from '../packages/n8n-nodes-twakedrive/credentials/stackToken.ts';

const credentials = {
	accessTokenUrl: 'https://sso.test/oauth2/token',
	clientId: 'n8n',
	clientSecret: 'secret',
	instanceUrl: 'https://alice.test/',
	oauthTokenData: { access_token: 'sso', refresh_token: 'refresh' },
};

function makeHelper(responses: unknown[]) {
	const calls: IHttpRequestOptions[] = [];
	return {
		calls,
		helper: {
			helpers: {
				httpRequest: async (options: IHttpRequestOptions) => {
					calls.push(options);
					return responses.shift();
				},
			},
		},
	};
}

beforeEach(clearStackTokenCache);

test('refreshes at the SSO, then exchanges the id_token at the instance', async () => {
	const { calls, helper } = makeHelper([{ id_token: 'id' }, { access_token: 'stack' }]);
	const output = await exchangeForStackToken.call(helper as never, credentials);

	assert.deepEqual(output, {
		oauthTokenData: { access_token: 'stack', refresh_token: 'refresh' },
	});
	assert.equal(calls[0].url, 'https://sso.test/oauth2/token');
	assert.equal(calls[1].url, 'https://alice.test/auth/token_exchange');
	assert.deepEqual(calls[1].body, { id_token: 'id', exchange_type: 'app' });
});

test('reuses the stack token without calling anything', async () => {
	const { calls, helper } = makeHelper([{ id_token: 'id' }, { access_token: 'stack' }]);
	await exchangeForStackToken.call(helper as never, credentials);
	const output = await exchangeForStackToken.call(helper as never, credentials);

	assert.equal(calls.length, 2);
	assert.equal((output.oauthTokenData as { access_token: string }).access_token, 'stack');
});

test('fails when the SSO returns no id_token', async () => {
	const { helper } = makeHelper([{ access_token: 'sso2' }]);
	await assert.rejects(
		exchangeForStackToken.call(helper as never, credentials),
		/did not return an id_token/,
	);
});

test('fails on a credential connected without a refresh token', async () => {
	const { helper } = makeHelper([]);
	await assert.rejects(
		exchangeForStackToken.call(helper as never, { ...credentials, oauthTokenData: {} }),
		/connect it again/,
	);
});

test('asks to reconnect when the SSO refuses the refresh', async () => {
	const helper = {
		helpers: {
			httpRequest: async () => {
				throw new Error('Request failed with status code 400');
			},
		},
	};
	await assert.rejects(
		exchangeForStackToken.call(helper as never, credentials),
		/Connect it again/,
	);
});

test('the cozy-stack packages ship the same exchange', () => {
	const read = (name: string) =>
		readFileSync(`packages/n8n-nodes-${name}/credentials/stackToken.ts`, 'utf8');
	assert.equal(read('twakedrive'), read('twakesettings'));
	assert.equal(read('twakedrive'), read('twakehome'));
});

const idToken = (claims: object) =>
	`header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

test('exchanges at the instance the SSO gives when no instance URL is filled in', async () => {
	const { calls, helper } = makeHelper([
		{ id_token: idToken({ workplaceFqdn: 'bob.test' }) },
		{ access_token: 'stack' },
	]);
	await exchangeForStackToken.call(helper as never, { ...credentials, instanceUrl: '' });
	assert.equal(calls[1].url, 'https://bob.test/auth/token_exchange');
});

test('reads the instance from the stored id_token, the filled URL winning', () => {
	const oauthTokenData = { id_token: idToken({ workplaceFqdn: 'https://bob.test/' }) };
	assert.equal(instanceUrlOf({ instanceUrl: '', oauthTokenData }), 'https://bob.test');
	assert.equal(
		instanceUrlOf({ instanceUrl: 'https://alice.test/', oauthTokenData }),
		'https://alice.test',
	);
	assert.throws(
		() => instanceUrlOf({ instanceUrl: '', oauthTokenData: {} }),
		/fill in the instance URL/,
	);
});
