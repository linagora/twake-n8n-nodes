import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

import {
	handleCall,
	settingsError,
	subscribe,
	subscriptionExists,
	unsubscribe,
	type Delivery,
	type Request,
	type Settings,
	type State,
} from '../packages/n8n-nodes-twakechat/nodes/TwakeChatNodeTrigger/trigger.ts';

const secret = 'whsec_test';
const now = 1_800_000_000;
const me = '6208ad54-5683-1041-8c8f-c9e6dccfd4ac';
const bob = '7a1c2e9f-0b4d-4c3a-9e8f-1d2c3b4a5f60';
const room = '!r1:test';
const messageUrl = '/client/v3/rooms/!r1%3Atest/event/%24e1';

function header(body: Buffer, timestamp = now, key = secret) {
	const digest = createHmac('sha256', key).update(`${timestamp}.`).update(body).digest('hex');
	return `t=${timestamp},v1=${digest}`;
}

/** What the node's request does with a failure: null for a tolerated status, else a throw. */
function fail(error: Error & { httpCode?: string }, tolerated: readonly number[] = []) {
	if (tolerated.includes(Number(error.httpCode))) return null;
	throw error;
}

const settings = (changes: Partial<Settings> = {}): Settings => ({
	events: ['created', 'mentioned'],
	sentBy: 'others',
	includeMessage: false,
	...changes,
});

const delivery = (
	event: 'created' | 'mentioned',
	actor: string | undefined,
	kind = 'direct',
): Delivery => ({
	id: `${event}-1`,
	type: `com.twake.chat.message.${event}.v1`,
	...(actor !== undefined && { twakeactorid: actor }),
	data: { object: { type: 'message', id: '$e1' }, container: { id: room, kind } },
});

const MESSAGE: IDataObject = {
	event_id: '$e1',
	room_id: room,
	sender: '@bob:test',
	type: 'm.room.message',
	content: { msgtype: 'm.text', body: 'hello' },
};

async function deliver(
	sent: Delivery,
	options: { settings?: Settings; state?: State; signature?: string; error?: Error } = {},
) {
	const rawBody = Buffer.from(JSON.stringify(sent));
	const calls: IHttpRequestOptions[] = [];
	const outcome = await handleCall(
		options.state ?? { subscriptionId: 's1', secret, owner: me },
		options.settings ?? settings(),
		{ signature: options.signature ?? header(rawBody), rawBody, delivery: sent, now },
		async (request, tolerated) => {
			calls.push(request);
			if (options.error) return fail(options.error, tolerated);
			return MESSAGE;
		},
	);
	return { outcome, calls };
}

const actionOf = async (...args: Parameters<typeof deliver>) =>
	(await deliver(...args)).outcome.action;

test('refuses a call with a bad signature, an old one, or without a subscription', async () => {
	const sent = delivery('created', bob);
	const rawBody = Buffer.from(JSON.stringify(sent));
	assert.equal(await actionOf(sent, { signature: header(Buffer.from('{}')) }), 'refuse');
	assert.equal(await actionOf(sent, { signature: header(rawBody, now - 301) }), 'refuse');
	assert.equal(await actionOf(sent, { signature: header(rawBody, now, 'other') }), 'refuse');
	assert.equal(await actionOf(sent, { state: {} }), 'refuse');
});

test('starts on a direct message of someone else, without reading it unless asked', async () => {
	const { outcome, calls } = await deliver(delivery('created', bob));
	assert.deepEqual(outcome, { action: 'start', json: delivery('created', bob) });
	assert.equal(calls.length, 0);
});

test('Sent By tells your direct messages from those of the others', async () => {
	const mine = delivery('created', me.toUpperCase());
	const theirs = delivery('created', bob);
	// A bot has no uuid: its message is not yours
	const unknown = delivery('created', undefined);

	assert.equal(await actionOf(mine), 'ignore');
	assert.equal(await actionOf(theirs), 'start');
	assert.equal(await actionOf(unknown), 'start');

	const byMe = settings({ sentBy: 'me' });
	assert.equal(await actionOf(mine, { settings: byMe }), 'start');
	assert.equal(await actionOf(theirs, { settings: byMe }), 'ignore');
	assert.equal(await actionOf(unknown, { settings: byMe }), 'ignore');

	const byAnyone = settings({ sentBy: 'anyone' });
	assert.equal(await actionOf(mine, { settings: byAnyone }), 'start');
	assert.equal(await actionOf(theirs, { settings: byAnyone }), 'start');
});

test('ignores a message of a room that is no direct conversation', async () => {
	assert.equal(await actionOf(delivery('created', bob, 'room')), 'ignore');
});

test('starts on a mention in any room, but not on a mention you made', async () => {
	assert.equal(await actionOf(delivery('mentioned', bob, 'room')), 'start');
	assert.equal(await actionOf(delivery('mentioned', bob, 'direct')), 'start');
	assert.equal(await actionOf(delivery('mentioned', me, 'room')), 'ignore');
	// Sent By is about the direct messages only
	assert.equal(
		await actionOf(delivery('mentioned', bob, 'room'), { settings: settings({ sentBy: 'me' }) }),
		'start',
	);
});

test('ignores an event that is not chosen', async () => {
	const onlyMentions = settings({ events: ['mentioned'] });
	assert.equal(await actionOf(delivery('created', bob), { settings: onlyMentions }), 'ignore');
	assert.equal(
		await actionOf({ ...delivery('created', bob), type: 'com.twake.chat.room.invited.v1' }),
		'ignore',
	);
});

test('Include Message outputs the message, or null when it is out of reach', async () => {
	const withMessage = settings({ includeMessage: true });
	const read = await deliver(delivery('created', bob), { settings: withMessage });
	assert.deepEqual(read.outcome, {
		action: 'start',
		json: { ...delivery('created', bob), message: MESSAGE },
	});
	assert.deepEqual(read.calls, [{ method: 'GET', url: messageUrl }]);

	const forbidden = Object.assign(new Error('Forbidden'), { httpCode: '403' });
	const gone = await deliver(delivery('created', bob), { settings: withMessage, error: forbidden });
	assert.deepEqual(gone.outcome, {
		action: 'start',
		json: { ...delivery('created', bob), message: null },
	});

	const down = Object.assign(new Error('Bad gateway'), { httpCode: '502' });
	await assert.rejects(
		deliver(delivery('created', bob), { settings: withMessage, error: down }),
		/Bad gateway/,
	);
});

test('refuses to subscribe without an event', () => {
	assert.equal(settingsError(settings({ events: [] })), 'Choose at least one event');
	assert.equal(settingsError(settings()), null);
});

function gatewayWith(answers: Record<string, IDataObject | null>) {
	const calls: IHttpRequestOptions[] = [];
	const gateway: Request = async (request) => {
		calls.push(request);
		return answers[`${String(request.method)} ${request.url}`] ?? null;
	};
	return { calls, gateway };
}

const TYPES = ['com.twake.chat.message.created.v1', 'com.twake.chat.message.mentioned.v1'];

test('subscribes to the chosen events, and keeps the secret and your uuid', async () => {
	const state: State = {};
	const { calls, gateway } = gatewayWith({
		'POST /subscriptions': { id: 's1', secret, owner: me },
	});

	await subscribe(state, gateway, 'https://n8n.test/webhook/1', settings());

	assert.deepEqual(calls, [
		{
			method: 'POST',
			url: '/subscriptions',
			body: { url: 'https://n8n.test/webhook/1', types: TYPES },
		},
	]);
	assert.deepEqual(state, { subscriptionId: 's1', secret, owner: me });
});

test('keeps a subscription for the same URL and events, and replaces any other', async () => {
	const url = 'https://n8n.test/webhook/1';
	const kept: State = { subscriptionId: 's1', secret };
	const same = gatewayWith({ 'GET /subscriptions/s1': { url, types: TYPES, owner: me } });
	assert.equal(await subscriptionExists(kept, same.gateway, url, settings()), true);
	assert.equal(kept.owner, me);

	const replaced: State = { subscriptionId: 's1', secret, owner: me };
	const other = gatewayWith({
		'GET /subscriptions/s1': { url, types: [TYPES[0] as string], owner: me },
	});
	assert.equal(await subscriptionExists(replaced, other.gateway, url, settings()), false);
	assert.deepEqual(
		other.calls.map((call) => `${String(call.method)} ${call.url}`),
		['GET /subscriptions/s1', 'DELETE /subscriptions/s1'],
	);
	assert.deepEqual(replaced, {});

	const unknown: State = { subscriptionId: 's1', secret, owner: me };
	assert.equal(await subscriptionExists(unknown, gatewayWith({}).gateway, url, settings()), false);
	assert.deepEqual(unknown, {});
});

test('unsubscribes, and says so when the gateway could not', async () => {
	const state: State = { subscriptionId: 's1', secret, owner: me };
	const failing: Request = async () => {
		throw new Error('down');
	};
	assert.equal(await unsubscribe(state, failing), false);
	assert.equal(state.subscriptionId, 's1');

	assert.equal(await unsubscribe(state, gatewayWith({}).gateway), true);
	assert.deepEqual(state, {});
});
