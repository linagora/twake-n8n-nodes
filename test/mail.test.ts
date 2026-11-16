import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { IHttpRequestOptions } from 'n8n-workflow';

import {
	EMAIL_PROPERTIES,
	MAIL,
	addresses,
	composeContext,
	createEmail,
	deleteEmail,
	downloadUrl,
	emailFilter,
	forwardDraft,
	getAttachments,
	getEmail,
	getThread,
	jmap,
	mailAccount,
	replyDraft,
	searchEmails,
	updateEmail,
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
		answer(
			['Email/query', { ids: ['e0', 'e1'] }, 'q'],
			['Email/get', { list: [{ id: 'e0' }, { id: 'e1' }] }, 'g'],
		),
	]);
	await searchEmails(call, account, {}, 2);
	assert.equal(calls.length, 1);
	assert.equal((bodyOf(calls[0]).methodCalls[0] as [string, { limit: number }])[1].limit, 2);
});

test('keeps the order of the query, and pages by query IDs when an email is not found', async () => {
	const { calls, call } = makeCall([
		answer(
			['Email/query', { ids: ['e0', 'e1', 'e2'] }, 'q'],
			['Email/get', { list: [{ id: 'e2' }, { id: 'e0' }], notFound: ['e1'] }, 'g'],
		),
		answer(['Email/query', { ids: ['e3'] }, 'q'], ['Email/get', { list: [{ id: 'e3' }] }, 'g']),
	]);
	const output = await searchEmails(call, account, {}, 3);
	assert.deepEqual(output, [{ id: 'e0' }, { id: 'e2' }, { id: 'e3' }]);
	const [, second] = calls.map(
		(options) =>
			(bodyOf(options).methodCalls[0] as [string, { position: number; limit: number }])[1],
	);
	assert.deepEqual([second.position, second.limit], [3, 1]);
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
			['Email/get', { list: [{ id: 'e2' }, { id: 'e1' }] }, 'g'],
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

const SUBMISSION = [...MAIL, 'urn:ietf:params:jmap:submission'];
const context = { identity: { id: 'i1', name: 'Me', email: 'me@test' }, drafts: 'd', sent: 's' };

test('parses comma-separated addresses with or without a name', () => {
	assert.deepEqual(addresses(' alice@test, "Bob B" <bob@test>,, '), [
		{ email: 'alice@test' },
		{ name: 'Bob B', email: 'bob@test' },
	]);
	assert.deepEqual(addresses(undefined), []);
});

test('sends an email: creates it in Drafts, submits it and moves it to Sent', async () => {
	const { calls, call } = makeCall([
		answer(
			['Email/set', { created: { draft: { id: 'e1', threadId: 't1' } } }, 's'],
			['EmailSubmission/set', { created: { send: { id: 'sub1' } } }, 'u'],
			['Email/set', { updated: { e1: null } }, 'u'],
		),
	]);
	const draft = { to: addresses('alice@test'), subject: 'Hi', body: 'Hello' };
	const output = await createEmail(call, account, context, draft, true);
	assert.deepEqual(output, { id: 'e1', threadId: 't1', submissionId: 'sub1' });
	assert.deepEqual(bodyOf(calls[0]).using, SUBMISSION);
	assert.deepEqual(bodyOf(calls[0]).methodCalls, [
		[
			'Email/set',
			{
				accountId: 'a1',
				create: {
					draft: {
						mailboxIds: { d: true },
						keywords: { $draft: true, $seen: true },
						from: [{ name: 'Me', email: 'me@test' }],
						subject: 'Hi',
						bodyValues: { body: { value: 'Hello' } },
						textBody: [{ partId: 'body', type: 'text/plain' }],
						to: [{ email: 'alice@test' }],
					},
				},
			},
			's',
		],
		[
			'EmailSubmission/set',
			{
				accountId: 'a1',
				create: { send: { identityId: 'i1', emailId: '#draft' } },
				onSuccessUpdateEmail: {
					'#send': { 'mailboxIds/d': null, 'mailboxIds/s': true, 'keywords/$draft': null },
				},
			},
			'u',
		],
	]);
});

test('creates a draft in HTML without sending it, and throws a SetError', async () => {
	const { calls, call } = makeCall([
		answer(['Email/set', { created: { draft: { id: 'e1' } } }, 's']),
		answer(['Email/set', { notCreated: { draft: { type: 'invalidProperties' } } }, 's']),
	]);
	assert.deepEqual(
		await createEmail(call, account, context, { body: '<b>Hi</b>', html: true }, false),
		{
			id: 'e1',
		},
	);
	const [[, args]] = bodyOf(calls[0]).methodCalls as [[string, { create: { draft: object } }]];
	assert.deepEqual(args.create.draft, {
		mailboxIds: { d: true },
		keywords: { $draft: true, $seen: true },
		from: [{ name: 'Me', email: 'me@test' }],
		subject: '',
		bodyValues: { body: { value: '<b>Hi</b>' } },
		htmlBody: [{ partId: 'body', type: 'text/html' }],
	});
	assert.equal(bodyOf(calls[0]).methodCalls.length, 1);
	await assert.rejects(createEmail(call, account, context, { body: '' }, false), {
		message: 'invalidProperties',
	});
});

test('reads the identity, the Drafts and Sent mailboxes and the original email in one request', async () => {
	const { calls, call } = makeCall([
		answer(
			['Identity/get', { list: [{ id: 'i1', email: 'me@test' }] }, 'i'],
			[
				'Mailbox/get',
				{
					list: [
						{ id: 'd', role: 'drafts' },
						{ id: 's', role: 'sent' },
					],
				},
				'm',
			],
			['Email/get', { list: [{ id: 'e1' }], notFound: [] }, 'e'],
		),
		answer(['Identity/get', { list: [{ id: 'i1' }] }, 'i'], ['Mailbox/get', { list: [] }, 'm']),
	]);
	const output = await composeContext(call, account, 'e1');
	assert.deepEqual(output, {
		identity: { id: 'i1', email: 'me@test' },
		drafts: 'd',
		sent: 's',
		original: { id: 'e1' },
	});
	const methodCalls = bodyOf(calls[0]).methodCalls as Array<[string, Record<string, unknown>]>;
	assert.deepEqual(
		methodCalls.map(([name]) => name),
		['Identity/get', 'Mailbox/get', 'Email/get'],
	);
	assert.deepEqual(methodCalls[2][1].ids, ['e1']);
	await assert.rejects(composeContext(call, account), {
		message: 'The account has no Drafts mailbox',
	});
});

const original = {
	from: [{ name: 'Alice', email: 'alice@test' }],
	to: [{ email: 'me@test' }, { email: 'bob@test' }],
	cc: [{ email: 'Carol@test' }, { email: 'carol@test' }, { email: 'alice@test' }],
	replyTo: null,
	subject: 'Plan',
	messageId: ['m1@test'],
	references: ['m0@test'],
	sentAt: '2026-11-16T09:00:00Z',
	textBody: [{ partId: '1', type: 'text/plain' }],
	htmlBody: [{ partId: '1', type: 'text/plain' }],
	bodyValues: { '1': { value: 'a < b\nbye' } },
	attachments: [{ blobId: 'b1', name: 'a.pdf', type: 'application/pdf', size: 3 }],
};

test('replies to the sender, or to all but me, in the thread of the email', () => {
	assert.deepEqual(replyDraft(original, 'me@test', false, 'Ok'), {
		to: [{ name: 'Alice', email: 'alice@test' }],
		cc: [],
		subject: 'Re: Plan',
		body: 'Ok',
		html: false,
		inReplyTo: ['m1@test'],
		references: ['m0@test', 'm1@test'],
	});
	const all = replyDraft(
		{ ...original, subject: 'RE: Plan', replyTo: [{ email: 'list@test' }] },
		'ME@test',
		true,
		'Ok',
	);
	assert.deepEqual(all.to, [{ email: 'list@test' }]);
	assert.deepEqual(all.cc, [
		{ email: 'bob@test' },
		{ email: 'Carol@test' },
		{ email: 'alice@test' },
	]);
	assert.equal(all.subject, 'RE: Plan');
});

test('forwards the original email quoted in HTML, with its attachments', () => {
	const draft = forwardDraft(original, { to: [{ email: 'dan@test' }], body: 'See <below>' });
	assert.equal(draft.subject, 'Fwd: Plan');
	assert.equal(draft.html, true);
	assert.deepEqual(draft.to, [{ email: 'dan@test' }]);
	assert.deepEqual(draft.attachments, original.attachments);
	assert.equal(
		draft.body,
		'<div>See &lt;below&gt;</div><br><div>---------- Forwarded message ----------<br>' +
			'From: Alice &lt;alice@test&gt;<br>Date: 2026-11-16T09:00:00Z<br>Subject: Plan<br>' +
			'To: me@test, bob@test<br>Cc: Carol@test, carol@test, alice@test<br><br>a &lt; b<br>bye</div>',
	);
});

test('updates an email with a patch and returns it as it is now', async () => {
	const { calls, call } = makeCall([
		answer(
			['Email/set', { updated: { e1: null } }, 's'],
			['Email/get', { list: [{ id: 'e1' }] }, 'g'],
		),
		answer(
			['Email/set', { notUpdated: { e2: { type: 'notFound' } } }, 's'],
			['Email/get', { list: [] }, 'g'],
		),
	]);
	assert.deepEqual(await updateEmail(call, account, 'e1', { 'keywords/$seen': true }), {
		id: 'e1',
	});
	assert.deepEqual(bodyOf(calls[0]).methodCalls, [
		['Email/set', { accountId: 'a1', update: { e1: { 'keywords/$seen': true } } }, 's'],
		['Email/get', { accountId: 'a1', ids: ['e1'], properties: EMAIL_PROPERTIES }, 'g'],
	]);
	await assert.rejects(updateEmail(call, account, 'e2', {}), { message: 'notFound' });
});

test('deletes an email by moving it to Trash, or permanently', async () => {
	const { calls, call } = makeCall([
		answer([
			'Mailbox/get',
			{
				list: [
					{ id: 'in', role: 'inbox' },
					{ id: 'tr', role: 'trash' },
				],
			},
			'm',
		]),
		answer(
			['Email/set', { updated: { e1: null } }, 's'],
			['Email/get', { list: [{ id: 'e1' }] }, 'g'],
		),
		answer(['Email/set', { destroyed: ['e1'] }, 's']),
	]);
	assert.deepEqual(await deleteEmail(call, account, 'e1', false), { id: 'e1' });
	assert.deepEqual((bodyOf(calls[1]).methodCalls[0] as [string, { update: unknown }])[1].update, {
		e1: { mailboxIds: { tr: true } },
	});
	assert.deepEqual(await deleteEmail(call, account, 'e1', true), { id: 'e1', deleted: true });
	assert.deepEqual(bodyOf(calls[2]).methodCalls, [
		['Email/set', { accountId: 'a1', destroy: ['e1'] }, 's'],
	]);
});
