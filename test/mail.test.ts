import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { IHttpRequestOptions } from 'n8n-workflow';

import {
	EMAIL_PROPERTIES,
	MAIL,
	downloadUrl,
	emailFilter,
	getAttachments,
	getEmail,
	getThread,
	jmap,
	mailAccount,
	searchEmails,
} from '../packages/n8n-nodes-twakemail/nodes/TwakeMail/jmap.ts';

const account = {
	accountId: 'a1',
	apiUrl: 'https://jmap.test/jmap',
	downloadUrl: 'https://jmap.test/download/{accountId}/{blobId}?type={type}&name={name}',
};

function makeCall(responses: unknown[]) {
	const calls: IHttpRequestOptions[] = [];
	const call = async (options: IHttpRequestOptions) => {
		calls.push(options);
		return responses.shift();
	};
	return { calls, call };
}

const answer = (...methodResponses: unknown[]) => ({ methodResponses });
const bodyOf = (options: IHttpRequestOptions) =>
	options.body as { using: string[]; methodCalls: unknown[] };

test('reads the mail account on the origin of the credential', () => {
	const session = {
		primaryAccounts: { 'urn:ietf:params:jmap:mail': 'a1' },
		apiUrl: 'http://internal:80/jmap',
		downloadUrl: 'http://internal:80/download/{accountId}/{blobId}?type={type}&name={name}',
	};
	assert.deepEqual(mailAccount(session, 'https://jmap.test/'), account);
	assert.throws(() => mailAccount({}, 'https://jmap.test'), /no mail account/);
});

test('throws on a JMAP method error, which comes with HTTP 200', async () => {
	const { calls, call } = makeCall([
		answer(['error', { type: 'invalidArguments', description: 'bad filter' }, 'q']),
	]);
	await assert.rejects(jmap(call, account, [['Email/query', {}, 'q']]), {
		message: 'JMAP error invalidArguments: bad filter',
	});
	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://jmap.test/jmap');
	assert.equal(calls[0].headers?.Accept, 'application/json;jmapVersion=rfc-8621');
	assert.deepEqual(bodyOf(calls[0]).using, MAIL);
});

test('searches with a back-reference and pages until a short page', async () => {
	const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i}`);
	const emails = (n: number) => ids(n).map((id) => ({ id }));
	const { calls, call } = makeCall([
		answer(['Email/query', { ids: ids(256) }, 'q'], ['Email/get', { list: emails(256) }, 'g']),
		answer(['Email/query', { ids: ids(3) }, 'q'], ['Email/get', { list: emails(3) }, 'g']),
	]);
	const filter = emailFilter({ inMailbox: 'm1', subject: 'Hi', text: '', after: '2026-11-01' });
	const output = await searchEmails(call, account, filter);

	assert.equal(output.length, 259);
	assert.equal(calls.length, 2);
	assert.deepEqual(bodyOf(calls[0]).methodCalls, [
		[
			'Email/query',
			{
				accountId: 'a1',
				filter: { inMailbox: 'm1', subject: 'Hi', after: '2026-11-01T00:00:00Z' },
				sort: [{ property: 'receivedAt', isAscending: false }],
				position: 0,
				limit: 256,
			},
			'q',
		],
		[
			'Email/get',
			{
				accountId: 'a1',
				'#ids': { resultOf: 'q', name: 'Email/query', path: '/ids/*' },
				properties: EMAIL_PROPERTIES,
			},
			'g',
		],
	]);
	assert.equal(
		(bodyOf(calls[1]).methodCalls[0] as [string, { position: number }])[1].position,
		256,
	);
});

test('searches up to a limit', async () => {
	const { calls, call } = makeCall([
		answer(['Email/query', { ids: ['e0', 'e1'] }, 'q'], ['Email/get', { list: [{}, {}] }, 'g']),
	]);
	await searchEmails(call, account, {}, 2);
	assert.equal(calls.length, 1);
	assert.equal((bodyOf(calls[0]).methodCalls[0] as [string, { limit: number }])[1].limit, 2);
});

test('gets an email with its bodies, and throws on an unknown ID', async () => {
	const { calls, call } = makeCall([
		answer(['Email/get', { list: [{ id: 'e1' }], notFound: [] }, 'g']),
		answer(['Email/get', { list: [], notFound: ['e2'] }, 'g']),
	]);
	assert.deepEqual(await getEmail(call, account, 'e1'), { id: 'e1' });
	const [[name, args]] = bodyOf(calls[0]).methodCalls as [[string, Record<string, unknown>]];
	assert.equal(name, 'Email/get');
	assert.deepEqual(args.ids, ['e1']);
	assert.equal(args.fetchTextBodyValues, true);
	assert.equal(args.fetchHTMLBodyValues, true);
	assert.ok((args.properties as string[]).includes('bodyValues'));
	await assert.rejects(getEmail(call, account, 'e2'), { message: 'No email with the ID e2' });
});

test('gets the emails of a thread with a back-reference', async () => {
	const { calls, call } = makeCall([
		answer(
			['Thread/get', { list: [{ id: 't1', emailIds: ['e1', 'e2'] }], notFound: [] }, 't'],
			['Email/get', { list: [{ id: 'e1' }, { id: 'e2' }] }, 'g'],
		),
	]);
	assert.deepEqual(await getThread(call, account, 't1'), [{ id: 'e1' }, { id: 'e2' }]);
	assert.deepEqual(bodyOf(calls[0]).methodCalls, [
		['Thread/get', { accountId: 'a1', ids: ['t1'] }, 't'],
		[
			'Email/get',
			{
				accountId: 'a1',
				'#ids': { resultOf: 't', name: 'Thread/get', path: '/list/*/emailIds' },
				properties: EMAIL_PROPERTIES,
			},
			'g',
		],
	]);
});

test('lists the attachments of an email and builds their download URL', async () => {
	const attachment = { blobId: 'b/1', name: 'Q3 report.pdf', type: 'application/pdf', size: 3 };
	const { calls, call } = makeCall([
		answer(['Email/get', { list: [{ id: 'e1', attachments: [attachment] }] }, 'g']),
	]);
	assert.deepEqual(await getAttachments(call, account, 'e1'), [attachment]);
	const [[, args]] = bodyOf(calls[0]).methodCalls as [[string, Record<string, unknown>]];
	assert.deepEqual(args.properties, ['id', 'attachments']);
	assert.equal(
		downloadUrl(account, attachment),
		'https://jmap.test/download/a1/b%2F1?type=application%2Fpdf&name=Q3%20report.pdf',
	);
});
