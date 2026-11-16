import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type { IHttpRequestOptions } from 'n8n-workflow';

import {
	clearMatrixTokenCache,
	loginToMatrix,
} from '../packages/n8n-nodes-twakechat/credentials/matrixToken.ts';

const credentials = {
	accessTokenUrl: 'https://sso.test/oauth2/token',
	clientId: 'n8n',
	clientSecret: 'secret',
	apiUrl: 'https://matrix.test/',
	oauthTokenData: { access_token: 'sso', refresh_token: 'refresh', id_token: 'old' },
};

function makeHelper(responses: unknown[]) {
	const calls: IHttpRequestOptions[] = [];
	return {
		calls,
		helper: {
			helpers: {
				httpRequest: async (options: IHttpRequestOptions) => {
					calls.push(options);
					const response = responses.shift();
					if (response instanceof Error) throw response;
					return response;
				},
			},
		},
	};
}

beforeEach(clearMatrixTokenCache);

test('refreshes at the SSO, then logs in to Matrix with the id_token on the n8n device', async () => {
	const { calls, helper } = makeHelper([{ id_token: 'fresh' }, { access_token: 'matrix' }]);
	const output = await loginToMatrix.call(helper as never, credentials);

	assert.deepEqual(output, {
		oauthTokenData: { access_token: 'matrix', refresh_token: 'refresh', id_token: 'old' },
	});
	assert.equal(calls[0].url, 'https://sso.test/oauth2/token');
	assert.match(calls[0].body as string, /grant_type=refresh_token&refresh_token=refresh/);
	assert.equal(calls[1].url, 'https://matrix.test/_matrix/client/v3/login');
	assert.deepEqual(calls[1].body, {
		type: 'org.matrix.login.jwt',
		token: 'fresh',
		device_id: 'N8N',
		initial_device_display_name: 'n8n',
	});
});

test('reuses the Matrix token until n8n holds another id_token', async () => {
	const { calls, helper } = makeHelper([
		{ id_token: 'fresh' },
		{ access_token: 'matrix' },
		{ id_token: 'fresher' },
		{ access_token: 'matrix2' },
	]);
	await loginToMatrix.call(helper as never, credentials);
	const again = await loginToMatrix.call(helper as never, credentials);
	assert.equal(calls.length, 2);
	assert.equal((again.oauthTokenData as { access_token: string }).access_token, 'matrix');

	// After a 401, n8n refreshes the SSO login itself and calls again with the new id_token.
	const afterRefresh = await loginToMatrix.call(helper as never, {
		...credentials,
		oauthTokenData: { ...credentials.oauthTokenData, id_token: 'refreshed-by-n8n' },
	});
	assert.equal(calls.length, 4);
	assert.equal((afterRefresh.oauthTokenData as { access_token: string }).access_token, 'matrix2');
});

test('says which side refused', async () => {
	const sso = makeHelper([new Error('400')]);
	await assert.rejects(loginToMatrix.call(sso.helper as never, credentials), /SSO refused/);

	const matrix = makeHelper([{ id_token: 'fresh' }, new Error('403')]);
	await assert.rejects(
		loginToMatrix.call(matrix.helper as never, credentials),
		/homeserver refused the SSO login/,
	);

	await assert.rejects(
		loginToMatrix.call(makeHelper([]).helper as never, { ...credentials, oauthTokenData: {} }),
		/no refresh token/,
	);
});
