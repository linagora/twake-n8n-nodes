import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type { IHttpRequestOptions } from 'n8n-workflow';

import {
	clearMatrixTokenCache,
	loginToMatrix,
	retryWithNewLogin,
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

const tokenOf = async (helper: unknown) =>
	(
		(await loginToMatrix.call(helper as never, credentials)).oauthTokenData as {
			access_token: string;
		}
	).access_token;

test('reuses the Matrix token for an hour', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: 0 });
	const { calls, helper } = makeHelper([
		{ id_token: 'fresh' },
		{ access_token: 'matrix' },
		{ id_token: 'fresh' },
		{ access_token: 'matrix2' },
	]);
	assert.equal(await tokenOf(helper), 'matrix');
	assert.equal(await tokenOf(helper), 'matrix');
	assert.equal(calls.length, 2);

	t.mock.timers.tick(60 * 60 * 1000);
	assert.equal(await tokenOf(helper), 'matrix2');
	assert.equal(calls.length, 4);
});

test('retries once with a new Matrix login after a 401', async () => {
	const { calls, helper } = makeHelper([
		{ id_token: 'fresh' },
		{ access_token: 'revoked' },
		{ id_token: 'fresh' },
		{ access_token: 'matrix' },
	]);
	await tokenOf(helper);

	// As n8n does, each request runs the preAuthentication, then sends with the token it returns.
	const sent: string[] = [];
	const request = async () => {
		const token = await tokenOf(helper);
		sent.push(token);
		if (token === 'revoked') throw Object.assign(new Error('401'), { httpCode: '401' });
		return 'ok';
	};
	assert.equal(await retryWithNewLogin(credentials, request), 'ok');
	assert.deepEqual(sent, ['revoked', 'matrix']);
	assert.equal(calls.length, 4);
});

test('does not retry another error', async () => {
	let attempts = 0;
	const request = async () => {
		attempts++;
		throw Object.assign(new Error('403'), { httpCode: '403' });
	};
	await assert.rejects(retryWithNewLogin(credentials, request), /403/);
	assert.equal(attempts, 1);
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
