import { randomUUID } from 'node:crypto';

import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

/** Sends a request to the homeserver, `url` being relative to its `/_matrix`. */
export type Request = (options: IHttpRequestOptions) => Promise<unknown>;

export interface File {
	name: string;
	mimeType: string;
	content: Buffer;
}

async function send(
	call: Request,
	roomId: string,
	type: string,
	content: IDataObject,
): Promise<IDataObject> {
	return (await call({
		method: 'PUT',
		url: `/client/v3/rooms/${encodeURIComponent(roomId)}/send/${type}/${randomUUID()}`,
		body: content,
	})) as IDataObject;
}

export async function sendMessage(
	call: Request,
	roomId: string,
	text: string,
	html?: string,
): Promise<IDataObject> {
	const content: IDataObject = { msgtype: 'm.text', body: text };
	if (html) Object.assign(content, { format: 'org.matrix.custom.html', formatted_body: html });
	return await send(call, roomId, 'm.room.message', content);
}

export async function sendFile(call: Request, roomId: string, file: File): Promise<IDataObject> {
	const { content_uri: url } = (await call({
		method: 'POST',
		url: '/media/v3/upload',
		qs: { filename: file.name },
		headers: { 'Content-Type': file.mimeType },
		body: file.content,
	})) as { content_uri: string };
	const kind = file.mimeType.split('/')[0];
	const msgtype = ['image', 'audio', 'video'].includes(kind) ? `m.${kind}` : 'm.file';
	return await send(call, roomId, 'm.room.message', {
		msgtype,
		body: file.name,
		filename: file.name,
		url,
		info: { mimetype: file.mimeType, size: file.content.length },
	});
}

export async function react(
	call: Request,
	roomId: string,
	eventId: string,
	key: string,
): Promise<IDataObject> {
	return await send(call, roomId, 'm.reaction', {
		'm.relates_to': { rel_type: 'm.annotation', event_id: eventId, key },
	});
}

export async function editMessage(
	call: Request,
	roomId: string,
	eventId: string,
	text: string,
): Promise<IDataObject> {
	return await send(call, roomId, 'm.room.message', {
		msgtype: 'm.text',
		body: `* ${text}`,
		'm.new_content': { msgtype: 'm.text', body: text },
		'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
	});
}
