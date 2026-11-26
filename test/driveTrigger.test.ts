import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

import {
	handleCall,
	isInside,
	matchesMime,
	parseMimeTypes,
	settingsError,
	subscribe,
	subscriptionExists,
	type Delivery,
	type Request,
	type Settings,
	type State,
} from '../packages/n8n-nodes-twakedrive/nodes/TwakeDriveNodeTrigger/trigger.ts';

const secret = 'whsec_test';
const now = 1_800_000_000;
const me = '6208ad54-5683-1041-8c8f-c9e6dccfd4ac';

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
	events: ['created'],
	watch: 'anyFile',
	folderId: '',
	subfolders: false,
	mimeTypes: [],
	includeFile: false,
	...changes,
});

const fileEvent = (event: string, folderId = 'invoices'): Delivery => ({
	id: `file-1/${event}`,
	type: `com.twake.drive.file.${event}.v1`,
	twakeactorid: me,
	data: { object: { type: 'file', id: 'file-1', folder: { id: folderId } } },
});
const created = (folderId = 'invoices') => fileEvent('created', folderId);

const shareReceived: Delivery = {
	id: 'sharing-1/received',
	type: 'com.twake.drive.share.received.v1',
	data: { object: { type: 'sharing', id: 'sharing-1', shortcut: { id: 'shortcut-1' } } },
};

// The drive, as GET /files/:id answers: /Invoices/2026/march.pdf. A file has no path.
const ENTRIES: Record<string, IDataObject> = {
	'file-1': {
		id: 'file-1',
		attributes: { name: 'march.pdf', dir_id: '2026', mime: 'application/pdf' },
	},
	'shortcut-1': { id: 'shortcut-1', attributes: { name: 'Invoices.url' } },
	'2026': { id: '2026', attributes: { name: '2026', path: '/Invoices/2026' } },
	invoices: { id: 'invoices', attributes: { name: 'Invoices', path: '/Invoices' } },
	inv: { id: 'inv', attributes: { name: 'Inv', path: '/Inv' } },
};

async function deliver(
	delivery: Delivery,
	options: { settings?: Settings; state?: State; signature?: string; error?: Error } = {},
) {
	const rawBody = Buffer.from(JSON.stringify(delivery));
	const calls: IHttpRequestOptions[] = [];
	const outcome = await handleCall(
		options.state ?? { subscriptionId: 's1', secret, owner: me },
		options.settings ?? settings(),
		{ signature: options.signature ?? header(rawBody), rawBody, delivery, now },
		async (request, tolerated) => {
			calls.push(request);
			if (options.error) return fail(options.error, tolerated);
			// A sharing you cannot see anymore.
			if (request.url.startsWith('/sharings/')) return fail(forbidden(), tolerated);
			const id = decodeURIComponent(request.url.replace('/files/', ''));
			return ENTRIES[id] ? { data: ENTRIES[id] } : fail(notFound(), tolerated);
		},
	);
	return { outcome, calls };
}

const notFound = () => Object.assign(new Error('Not found'), { httpCode: '404' });
const forbidden = () => Object.assign(new Error('Forbidden'), { httpCode: '403' });

test('refuses a call with a bad signature', async () => {
	const { outcome } = await deliver(created(), { signature: header(Buffer.from('{}')) });
	assert.deepEqual(outcome, { action: 'refuse' });
});

test('starts on any file, without reading it unless asked', async () => {
	const { outcome, calls } = await deliver(created());
	assert.deepEqual(outcome, { action: 'start', json: created() });
	assert.equal(calls.length, 0);
});

test('Inside a Folder only starts on the files directly in it', async () => {
	const inFolder = settings({ watch: 'folder', folderId: 'invoices' });
	assert.equal(
		(await deliver(created('invoices'), { settings: inFolder })).outcome.action,
		'start',
	);
	const deeper = await deliver(created('2026'), { settings: inFolder });
	assert.deepEqual(deeper.outcome, { action: 'ignore' });
	assert.equal(deeper.calls.length, 0);
});

test('Watch Subfolders reads the paths to find a file deeper in the folder', async () => {
	const withSubfolders = settings({ watch: 'folder', folderId: 'invoices', subfolders: true });
	const deeper = await deliver(created('2026'), { settings: withSubfolders });
	assert.equal(deeper.outcome.action, 'start');
	assert.deepEqual(
		deeper.calls.map((call) => call.url),
		['/files/2026', '/files/invoices'],
	);
	const elsewhere = settings({ watch: 'folder', folderId: 'inv', subfolders: true });
	assert.deepEqual((await deliver(created('2026'), { settings: elsewhere })).outcome, {
		action: 'ignore',
	});
	const gone = settings({ watch: 'folder', folderId: 'deleted', subfolders: true });
	assert.deepEqual((await deliver(created('2026'), { settings: gone })).outcome, {
		action: 'ignore',
	});
});

test('Include File outputs the file, or null when it is out of reach', async () => {
	const withFile = settings({ includeFile: true });
	assert.deepEqual((await deliver(created(), { settings: withFile })).outcome, {
		action: 'start',
		json: { ...created(), file: ENTRIES['file-1'] },
	});
	const forbidden = Object.assign(new Error('Forbidden'), { httpCode: '403' });
	assert.deepEqual((await deliver(created(), { settings: withFile, error: forbidden })).outcome, {
		action: 'start',
		json: { ...created(), file: null },
	});
	const broken = Object.assign(new Error('Bad gateway'), { httpCode: '502' });
	await assert.rejects(deliver(created(), { settings: withFile, error: broken }), /Bad gateway/);
});

test('isInside compares whole folder names', () => {
	assert.equal(isInside('/Invoices/2026', '/Invoices'), true);
	assert.equal(isInside('/Invoices2', '/Invoices'), false);
	assert.equal(isInside('/Invoices', '/'), true);
});

test('refuses to subscribe without an event, or without a folder for Inside a Folder', () => {
	assert.equal(settingsError(settings()), null);
	assert.equal(settingsError(settings({ events: [] })), 'Choose at least one event');
	assert.equal(settingsError(settings({ watch: 'folder' })), 'Choose a folder');
});

test('subscribes to the file events, and replaces a subscription for other events', async () => {
	const calls: IHttpRequestOptions[] = [];
	const answers: (IDataObject | Error)[] = [{ id: 's1', secret: 'whsec_new', owner: me }];
	const gateway: Request = async (options, tolerated) => {
		calls.push(options);
		const answer = answers.shift() ?? {};
		return answer instanceof Error ? fail(answer, tolerated) : answer;
	};
	const state: State = {};
	await subscribe(state, gateway, 'https://n8n.example.com/webhook/x', settings());
	assert.deepEqual(calls[0]?.body, {
		url: 'https://n8n.example.com/webhook/x',
		types: ['com.twake.drive.file.created.v1'],
	});
	assert.deepEqual(state, { subscriptionId: 's1', secret: 'whsec_new', owner: me });
	answers.push(
		{
			id: 's1',
			url: 'https://n8n.example.com/webhook/x',
			types: ['com.twake.drive.file.updated.v1'],
		},
		{},
	);
	assert.equal(
		await subscriptionExists(state, gateway, 'https://n8n.example.com/webhook/x', settings()),
		false,
	);
	assert.deepEqual(state, {});
});

test('starts on the files updated and deleted, in the folder they are or were in', async () => {
	const all = settings({ events: ['created', 'updated', 'deleted'] });
	for (const event of ['updated', 'deleted']) {
		const { outcome } = await deliver(fileEvent(event), { settings: all });
		assert.deepEqual(outcome, { action: 'start', json: fileEvent(event) });
	}
	const inFolder = settings({ events: ['deleted'], watch: 'folder', folderId: 'invoices' });
	assert.equal(
		(await deliver(fileEvent('deleted'), { settings: inFolder })).outcome.action,
		'start',
	);
	assert.deepEqual(
		(await deliver(fileEvent('updated'), { settings: inFolder })).outcome,
		{ action: 'ignore' },
		'an event that is not chosen',
	);
});

test('MIME Types reads the file once, and starts only for a type in the list', async () => {
	const pdf = settings({ mimeTypes: ['application/pdf'], includeFile: true });
	const started = await deliver(created(), { settings: pdf });
	assert.deepEqual(started.outcome, {
		action: 'start',
		json: { ...created(), file: ENTRIES['file-1'] },
	});
	assert.equal(started.calls.length, 1);
	const images = settings({ mimeTypes: ['image/*'] });
	assert.deepEqual((await deliver(created(), { settings: images })).outcome, { action: 'ignore' });
	const gone = settings({ mimeTypes: ['application/pdf'] });
	assert.deepEqual(
		(await deliver(created(), { settings: gone, error: notFound() })).outcome,
		{ action: 'ignore' },
		'a file you cannot see has no type',
	);
});

test('matchesMime and parseMimeTypes', () => {
	assert.deepEqual(parseMimeTypes(' Application/PDF, image/* ,,'), ['application/pdf', 'image/*']);
	assert.equal(matchesMime('image/png', ['image/*']), true);
	assert.equal(matchesMime('application/pdf', ['application/pdf']), true);
	assert.equal(matchesMime('application/pdfx', ['application/pdf']), false);
	assert.equal(matchesMime(undefined, ['image/*']), false);
});

test('Share Received skips the file filters, and outputs the shortcut and the sharing', async () => {
	const filtered = settings({
		events: ['shareReceived'],
		watch: 'folder',
		folderId: 'invoices',
		mimeTypes: ['image/*'],
		includeFile: true,
	});
	const { outcome, calls } = await deliver(shareReceived, { settings: filtered });
	assert.deepEqual(outcome, {
		action: 'start',
		json: { ...shareReceived, file: ENTRIES['shortcut-1'], sharing: null },
	});
	assert.deepEqual(
		calls.map((call) => call.url),
		['/files/shortcut-1', '/sharings/sharing-1'],
	);
});

test('subscribes to the type of each event', async () => {
	const calls: IHttpRequestOptions[] = [];
	const gateway: Request = async (options) => {
		calls.push(options);
		return { id: 's1', secret: 'whsec_new', owner: me };
	};
	const all = settings({ events: ['created', 'updated', 'deleted', 'shareReceived'] });
	await subscribe({}, gateway, 'https://n8n.example.com/webhook/x', all);
	assert.deepEqual((calls[0]?.body as IDataObject).types, [
		'com.twake.drive.file.created.v1',
		'com.twake.drive.file.updated.v1',
		'com.twake.drive.file.deleted.v1',
		'com.twake.drive.share.received.v1',
	]);
});
