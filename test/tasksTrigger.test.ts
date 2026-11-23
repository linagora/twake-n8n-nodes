import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

import {
	handleCall,
	isSignedBy,
	isWantedActor,
	isWantedAssignee,
	parseEmails,
	settingsError,
	subscribe,
	subscriptionExists,
	unsubscribe,
	type Delivery,
	type Request,
	type Settings,
	type State,
} from '../packages/n8n-nodes-twaketasks/nodes/TwakeTasksNodeTrigger/trigger.ts';

const secret = 'whsec_test';
const body = Buffer.from('{"id":"e1","type":"com.twake.tasks.task.created.v1"}');
const now = 1_800_000_000;
const me = '6208ad54-5683-1041-8c8f-c9e6dccfd4ac';
const other = '7a1e0c3b-0000-4000-8000-000000000002';

function header(timestamp: number, key = secret, signed = body) {
	const digest = createHmac('sha256', key).update(`${timestamp}.`).update(signed).digest('hex');
	return `t=${timestamp},v1=${digest}`;
}

test('accepts a delivery signed with the secret', () => {
	assert.equal(isSignedBy(secret, header(now - 10), body, now), true);
});

test('refuses another secret, another body or no header', () => {
	assert.equal(isSignedBy(secret, header(now, 'whsec_other'), body, now), false);
	assert.equal(isSignedBy(secret, header(now), Buffer.from('{}'), now), false);
	assert.equal(isSignedBy(secret, undefined, body, now), false);
	assert.equal(isSignedBy(secret, 't=1,v1=zz', body, now), false);
});

test('refuses a delivery signed more than five minutes ago', () => {
	assert.equal(isSignedBy(secret, header(now - 301), body, now), false);
	assert.equal(isSignedBy(secret, header(now - 299), body, now), true);
});

test('reads emails separated by commas, spaces or lines', () => {
	assert.deepEqual(parseEmails(' Alice@Example.com,bob@example.com\ncarol@example.com ;'), [
		'alice@example.com',
		'bob@example.com',
		'carol@example.com',
	]);
	assert.deepEqual(parseEmails(' , '), []);
});

test('Anyone lets every assignment through', () => {
	assert.equal(isWantedAssignee('anyone', undefined, { emails: [] }), true);
	assert.equal(isWantedAssignee('anyone', other, { me, emails: [] }), true);
});

test('Me only lets through an assignment of you', () => {
	assert.equal(isWantedAssignee('me', me.toUpperCase(), { me, emails: [] }), true);
	assert.equal(isWantedAssignee('me', other, { me, emails: [] }), false);
	assert.equal(isWantedAssignee('me', undefined, { me, emails: [] }), false);
	assert.equal(isWantedAssignee('me', me, { emails: [] }), false);
});

test('Specific People compares the email of the assignee', () => {
	const emails = ['bob@example.com'];
	assert.equal(isWantedAssignee('people', other, { email: 'Bob@Example.com', emails }), true);
	assert.equal(isWantedAssignee('people', other, { email: 'carol@example.com', emails }), false);
	assert.equal(isWantedAssignee('people', other, { emails }), false);
});

test('By Me only lets through what you made', () => {
	assert.equal(isWantedActor('me', me.toUpperCase(), me), true);
	assert.equal(isWantedActor('me', other, me), false);
	assert.equal(isWantedActor('me', undefined, me), false);
	assert.equal(isWantedActor('me', me, undefined), false);
});

/** What the node's request does with a failure: null for a tolerated status, else a throw. */
function fail(error: Error & { httpCode?: string }, tolerated: readonly number[] = []) {
	if (tolerated.includes(Number(error.httpCode))) return null;
	throw error;
}

const settings = (changes: Partial<Settings> = {}): Settings => ({
	events: ['created', 'deleted', 'assigned', 'unassigned'],
	createdBy: 'me',
	deletedBy: 'me',
	assignedTo: 'me',
	emails: [],
	includeTask: false,
	...changes,
});

test('refuses to subscribe without an event, or without an email for Specific People', () => {
	assert.equal(settingsError(settings()), null);
	assert.equal(settingsError(settings({ events: [] })), 'Choose at least one event');
	assert.equal(
		settingsError(settings({ assignedTo: 'people' })),
		'Enter at least one email in Emails',
	);
	assert.equal(
		settingsError(settings({ assignedTo: 'people', emails: ['bob@example.com'] })),
		null,
	);
});

const BOARD = {
	tasks: [{ id: 'task-1', title: 'Plan' }],
	members: [
		{ userId: me, email: 'me@example.com' },
		{ userId: other, email: 'bob@example.com' },
	],
};

function event(type: string, changes: Partial<Delivery> = {}): Delivery {
	return {
		id: 'e1',
		type: `com.twake.tasks.task.${type}.v1`,
		twakeactorid: me,
		data: { object: { id: 'task-1', board: { id: 'board-1' } } },
		...changes,
	};
}

/** Calls handleCall with a delivery signed with the state's secret, and records the API calls. */
async function deliver(
	delivery: Delivery,
	options: {
		settings?: Settings;
		state?: State;
		signature?: string;
		boardError?: Error;
	} = {},
) {
	const rawBody = Buffer.from(JSON.stringify(delivery));
	const calls: IHttpRequestOptions[] = [];
	const outcome = await handleCall(
		options.state ?? { subscriptionId: 's1', secret, owner: me },
		options.settings ?? settings(),
		{ signature: options.signature ?? header(now, secret, rawBody), rawBody, delivery, now },
		async (request, tolerated) => {
			calls.push(request);
			return options.boardError ? fail(options.boardError, tolerated) : BOARD;
		},
	);
	return { outcome, calls };
}

test('refuses a call with a bad signature, or before the node has a secret', async () => {
	const delivery = event('created');
	assert.deepEqual((await deliver(delivery, { signature: header(now, 'whsec_other') })).outcome, {
		action: 'refuse',
	});
	assert.deepEqual((await deliver(delivery, { state: {} })).outcome, { action: 'refuse' });
});

test('ignores an event that is not chosen', async () => {
	const { outcome, calls } = await deliver(event('created'), {
		settings: settings({ events: ['assigned'] }),
	});
	assert.deepEqual(outcome, { action: 'ignore' });
	assert.equal(calls.length, 0);
});

test('starts on a creation or deletion of yours, and ignores one by someone else', async () => {
	assert.equal((await deliver(event('created'))).outcome.action, 'start');
	assert.equal((await deliver(event('deleted'))).outcome.action, 'start');
	const theirs = event('created', { twakeactorid: other });
	assert.deepEqual((await deliver(theirs)).outcome, { action: 'ignore' });
});

test('Assigned To Me starts on your assignment, and ignores the others', async () => {
	const toMe = event('assigned', {
		twakeactorid: other,
		data: { ...event('assigned').data, assignee: { id: me } },
	});
	const toOther = event('assigned', {
		data: { ...event('assigned').data, assignee: { id: other } },
	});
	assert.equal((await deliver(toMe)).outcome.action, 'start');
	assert.deepEqual((await deliver(toOther)).outcome, { action: 'ignore' });
	const anyone = settings({ assignedTo: 'anyone' });
	assert.equal((await deliver(toOther, { settings: anyone })).outcome.action, 'start');
});

test('Specific People reads the board to find the email of the assignee', async () => {
	const removed = event('unassigned', {
		data: { ...event('unassigned').data, assignee: { id: other } },
	});
	const bob = settings({ assignedTo: 'people', emails: ['bob@example.com'] });
	const carol = settings({ assignedTo: 'people', emails: ['carol@example.com'] });
	const { outcome, calls } = await deliver(removed, { settings: bob });
	assert.equal(outcome.action, 'start');
	assert.deepEqual(calls, [{ method: 'GET', url: '/api/boards/board-1' }]);
	assert.deepEqual((await deliver(removed, { settings: carol })).outcome, { action: 'ignore' });
	const upperCased = event('unassigned', {
		data: { ...event('unassigned').data, assignee: { id: other.toUpperCase() } },
	});
	assert.equal((await deliver(upperCased, { settings: bob })).outcome.action, 'start');
});

test('Include Task outputs the task, or null when the board is out of reach', async () => {
	const withTask = settings({ includeTask: true });
	const started = await deliver(event('created'), { settings: withTask });
	assert.deepEqual(started.outcome, {
		action: 'start',
		json: { ...event('created'), task: { id: 'task-1', title: 'Plan' } },
	});
	const forbidden = Object.assign(new Error('Forbidden'), { httpCode: '403' });
	const hidden = await deliver(event('created'), { settings: withTask, boardError: forbidden });
	assert.deepEqual(hidden.outcome, { action: 'start', json: { ...event('created'), task: null } });
	const broken = Object.assign(new Error('Bad gateway'), { httpCode: '502' });
	await assert.rejects(
		deliver(event('created'), { settings: withTask, boardError: broken }),
		/Bad gateway/,
	);
});

/** A fake gateway that answers each call with the next of `answers`, and records the calls. */
function gateway(...answers: (IDataObject | Error)[]) {
	const calls: IHttpRequestOptions[] = [];
	const request: Request = async (options, tolerated) => {
		calls.push(options);
		const answer = answers.shift() ?? {};
		if (answer instanceof Error) return fail(answer, tolerated);
		return answer;
	};
	return { calls, request };
}

const notFound = () => Object.assign(new Error('Not found'), { httpCode: '404' });

const WEBHOOK = 'https://n8n.example.com/webhook/x';
const CREATED_ONLY = settings({ events: ['created'] });
const subscription = (changes: IDataObject = {}) => ({
	id: 's1',
	url: WEBHOOK,
	types: ['com.twake.tasks.task.created.v1'],
	owner: me,
	...changes,
});

test('subscribes to the chosen events and keeps the id, secret and owner', async () => {
	const state: State = {};
	const { calls, request } = gateway({ id: 's1', secret: 'whsec_new', owner: me });
	await subscribe(
		state,
		request,
		'https://n8n.example.com/webhook/x',
		settings({ events: ['created'] }),
	);
	assert.deepEqual(calls, [
		{
			method: 'POST',
			url: '/subscriptions',
			body: {
				url: 'https://n8n.example.com/webhook/x',
				types: ['com.twake.tasks.task.created.v1'],
			},
		},
	]);
	assert.deepEqual(state, { subscriptionId: 's1', secret: 'whsec_new', owner: me });
});

test('checks the subscription still exists, and forgets it when the gateway does not know it', async () => {
	assert.equal(await subscriptionExists({}, gateway().request, WEBHOOK, CREATED_ONLY), false);
	const kept: State = { subscriptionId: 's1', secret };
	const found = gateway(subscription());
	assert.equal(await subscriptionExists(kept, found.request, WEBHOOK, CREATED_ONLY), true);
	assert.deepEqual(found.calls, [{ method: 'GET', url: '/subscriptions/s1' }]);
	assert.deepEqual(kept, { subscriptionId: 's1', secret, owner: me });
	const gone: State = { subscriptionId: 's1', secret, owner: me };
	assert.equal(
		await subscriptionExists(gone, gateway(notFound()).request, WEBHOOK, CREATED_ONLY),
		false,
	);
	assert.deepEqual(gone, {});
	const failing = gateway(Object.assign(new Error('Unavailable'), { httpCode: '503' }));
	await assert.rejects(
		subscriptionExists({ subscriptionId: 's1' }, failing.request, WEBHOOK, CREATED_ONLY),
		/Unavailable/,
	);
});

test('replaces a subscription for another URL or other events', async () => {
	for (const stale of [
		subscription({ url: 'https://old-n8n.example.com/webhook/x' }),
		subscription({ types: ['com.twake.tasks.task.created.v1', 'com.twake.tasks.task.deleted.v1'] }),
	]) {
		const state: State = { subscriptionId: 's1', secret, owner: me };
		const { calls, request } = gateway(stale, {});
		assert.equal(await subscriptionExists(state, request, WEBHOOK, CREATED_ONLY), false);
		assert.deepEqual(calls, [
			{ method: 'GET', url: '/subscriptions/s1' },
			{ method: 'DELETE', url: '/subscriptions/s1' },
		]);
		assert.deepEqual(state, {});
	}
});

test('unsubscribes, and keeps the subscription when the gateway fails', async () => {
	const state: State = { subscriptionId: 's1', secret, owner: me };
	const ok = gateway();
	assert.equal(await unsubscribe(state, ok.request), true);
	assert.deepEqual(ok.calls, [{ method: 'DELETE', url: '/subscriptions/s1' }]);
	assert.deepEqual(state, {});
	const gone: State = { subscriptionId: 's1', secret };
	assert.equal(await unsubscribe(gone, gateway(notFound()).request), true);
	assert.deepEqual(gone, {});
	const failing: State = { subscriptionId: 's1', secret };
	const down = gateway(Object.assign(new Error('Unavailable'), { httpCode: '503' }));
	assert.equal(await unsubscribe(failing, down.request), false);
	assert.deepEqual(failing, { subscriptionId: 's1', secret });
});
