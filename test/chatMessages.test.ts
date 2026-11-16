import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { IHttpRequestOptions } from 'n8n-workflow';

import {
	editMessage,
	react,
	sendFile,
	sendMessage,
} from '../packages/n8n-nodes-twakechat/nodes/TwakeChat/messages.ts';

const room = '!r1:test';
const sendUrl = (type: string) =>
	new RegExp(`^/client/v3/rooms/!r1%3Atest/send/${type}/[0-9a-f-]{36}$`);

function makeCall(responses: unknown[]) {
	const calls: IHttpRequestOptions[] = [];
	const call = async (options: IHttpRequestOptions) => {
		calls.push(options);
		return responses.shift();
	};
	return { calls, call };
}

test('sends a text message, with HTML when given', async () => {
	const { calls, call } = makeCall([{ event_id: '$e1' }, { event_id: '$e2' }]);
	assert.deepEqual(await sendMessage(call, room, 'Hi'), { event_id: '$e1' });
	await sendMessage(call, room, 'Hi', '<b>Hi</b>');
	assert.equal(calls[0].method, 'PUT');
	assert.match(calls[0].url, sendUrl('m.room.message'));
	assert.deepEqual(calls[0].body, { msgtype: 'm.text', body: 'Hi' });
	assert.deepEqual(calls[1].body, {
		msgtype: 'm.text',
		body: 'Hi',
		format: 'org.matrix.custom.html',
		formatted_body: '<b>Hi</b>',
	});
	assert.notEqual(calls[0].url, calls[1].url, 'each request has its own transaction ID');
});

test('uploads a file then sends it with a msgtype from its MIME type', async () => {
	const content = Buffer.from('png');
	const { calls, call } = makeCall([{ content_uri: 'mxc://test/m1' }, { event_id: '$e1' }]);
	await sendFile(call, room, { name: 'a.png', mimeType: 'image/png', content });
	assert.deepEqual(calls[0], {
		method: 'POST',
		url: '/media/v3/upload',
		qs: { filename: 'a.png' },
		headers: { 'Content-Type': 'image/png' },
		body: content,
	});
	assert.match(calls[1].url, sendUrl('m.room.message'));
	assert.deepEqual(calls[1].body, {
		msgtype: 'm.image',
		body: 'a.png',
		filename: 'a.png',
		url: 'mxc://test/m1',
		info: { mimetype: 'image/png', size: 3 },
	});

	const other = makeCall([{ content_uri: 'mxc://test/m2' }, {}]);
	await sendFile(other.call, room, { name: 'a.pdf', mimeType: 'application/pdf', content });
	assert.equal((other.calls[1].body as { msgtype: string }).msgtype, 'm.file');
});

test('reacts to a message', async () => {
	const { calls, call } = makeCall([{}]);
	await react(call, room, '$e1', '👍');
	assert.match(calls[0].url, sendUrl('m.reaction'));
	assert.deepEqual(calls[0].body, {
		'm.relates_to': { rel_type: 'm.annotation', event_id: '$e1', key: '👍' },
	});
});

test('edits a message', async () => {
	const { calls, call } = makeCall([{}]);
	await editMessage(call, room, '$e1', 'Fixed');
	assert.match(calls[0].url, sendUrl('m.room.message'));
	assert.deepEqual(calls[0].body, {
		msgtype: 'm.text',
		body: '* Fixed',
		'm.new_content': { msgtype: 'm.text', body: 'Fixed' },
		'm.relates_to': { rel_type: 'm.replace', event_id: '$e1' },
	});
});
