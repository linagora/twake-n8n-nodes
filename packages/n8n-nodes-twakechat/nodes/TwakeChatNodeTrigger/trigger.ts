import { createHmac, timingSafeEqual } from 'node:crypto';

import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

// What the trigger decides, apart from n8n, so that tests can call it with plain functions.

/** The gateway signs a delivery at most this long before the call reaches n8n. */
export const MAX_AGE_SECONDS = 300;

/**
 * Checks the `Twake-Signature: t=<timestamp>,v1=<hex>` header of a delivery of the Twake webhook
 * gateway: an HMAC-SHA256 of `<timestamp>.<body>` with the subscription's secret, signed less than
 * five minutes ago. `now` is in seconds.
 */
export function isSignedBy(
	secret: string,
	header: string | undefined,
	body: Buffer,
	now: number,
): boolean {
	const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
	if (!match) return false;
	const [, timestamp = '', given = ''] = match;
	if (Math.abs(now - Number(timestamp)) > MAX_AGE_SECONDS) return false;
	const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest();
	return timingSafeEqual(expected, Buffer.from(given, 'hex'));
}

/** `created` is a message of a direct conversation, `mentioned` a message that mentions you. */
export const typeOf = (event: string) => `com.twake.chat.message.${event}.v1`;

/** Who sent the direct messages that start the workflow. */
export type SentBy = 'others' | 'me' | 'anyone';

/** The parameters of the node, read once per call. */
export interface Settings {
	events: string[];
	sentBy: SentBy;
	includeMessage: boolean;
}

/** The subscription, kept in the node's static data. */
export interface State {
	subscriptionId?: string;
	secret?: string;
	/** Your uuid, to tell your messages from those of the others. */
	owner?: string;
}

/**
 * A call to the gateway or to the homeserver, its URL relative to theirs. It answers null when the
 * call fails with one of the `tolerated` statuses, and throws on any other failure.
 */
export type Request = (
	options: IHttpRequestOptions,
	tolerated?: readonly number[],
) => Promise<IDataObject | null>;

/** Why the node cannot subscribe with these settings, or null. */
export function settingsError(settings: Settings): string | null {
	if (settings.events.length === 0) return 'Choose at least one event';
	return null;
}

const subscriptionUrl = (id: string) => `/subscriptions/${encodeURIComponent(id)}`;

function forget(state: State) {
	delete state.subscriptionId;
	delete state.secret;
	delete state.owner;
}

const sameTypes = (given: unknown, wanted: string[]) =>
	Array.isArray(given) &&
	given.length === wanted.length &&
	wanted.every((type) => given.includes(type));

/**
 * Whether the subscription in `state` still exists at the gateway, for this webhook URL and these
 * events. A subscription for another URL, such as after n8n moved, or for other events, is deleted so
 * that n8n subscribes again; one the gateway does not know anymore is forgotten.
 */
export async function subscriptionExists(
	state: State,
	gateway: Request,
	webhookUrl: string,
	settings: Settings,
): Promise<boolean> {
	if (typeof state.subscriptionId !== 'string') return false;
	const url = subscriptionUrl(state.subscriptionId);
	const existing = await gateway({ method: 'GET', url }, [404]);
	if (
		existing !== null &&
		existing.url === webhookUrl &&
		sameTypes(existing.types, settings.events.map(typeOf))
	) {
		state.owner = existing.owner as string;
		return true;
	}
	if (existing !== null) await gateway({ method: 'DELETE', url }, [404]);
	forget(state);
	return false;
}

export async function subscribe(
	state: State,
	gateway: Request,
	webhookUrl: string,
	settings: Settings,
): Promise<void> {
	const created = await gateway({
		method: 'POST',
		url: '/subscriptions',
		body: { url: webhookUrl, types: settings.events.map(typeOf) },
	});
	state.subscriptionId = created?.id as string;
	state.secret = created?.secret as string;
	state.owner = created?.owner as string;
}

/** Deletes the subscription. False when the gateway could not, so that n8n tries again. */
export async function unsubscribe(state: State, gateway: Request): Promise<boolean> {
	if (typeof state.subscriptionId === 'string') {
		try {
			await gateway({ method: 'DELETE', url: subscriptionUrl(state.subscriptionId) }, [404]);
		} catch {
			return false;
		}
	}
	forget(state);
	return true;
}

export interface Delivery extends IDataObject {
	type?: string;
	/** The uuid of the sender, absent when Twake does not know them, such as a bot. */
	twakeactorid?: string;
	data?: {
		/** The Matrix event. */
		object?: { id?: string };
		/** The room: `direct` for a conversation of two people. */
		container?: { id?: string; kind?: string };
	};
}

/** A call of the gateway to the webhook. `now` is in seconds. */
export interface Call {
	signature: string | undefined;
	rawBody: Buffer;
	delivery: Delivery;
	now: number;
}

/**
 * What n8n does with a call: refuse it with a 401, or answer 200 and start the workflow or not. An
 * event filtered out is answered 200 all the same, so that the gateway does not deliver it again.
 */
export type Outcome =
	| { action: 'refuse' }
	| { action: 'ignore' }
	| { action: 'start'; json: IDataObject };

/** The message as the homeserver shows it to you, or null when you cannot see it anymore. */
async function readMessage(
	api: Request,
	roomId: string | undefined,
	eventId: string | undefined,
): Promise<IDataObject | null> {
	if (!roomId || !eventId) return null;
	return await api(
		{
			method: 'GET',
			url: `/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
		},
		[403, 404],
	);
}

export async function handleCall(
	state: State,
	settings: Settings,
	call: Call,
	api: Request,
): Promise<Outcome> {
	const { secret, owner } = state;
	if (typeof secret !== 'string' || !isSignedBy(secret, call.signature, call.rawBody, call.now)) {
		return { action: 'refuse' };
	}
	const { delivery } = call;
	const event = settings.events.find((chosen) => typeOf(chosen) === delivery.type);
	if (event === undefined) return { action: 'ignore' };

	const actor = delivery.twakeactorid;
	const isMine =
		actor !== undefined && owner !== undefined && actor.toLowerCase() === owner.toLowerCase();
	const room = delivery.data?.container;
	if (event === 'created') {
		// The same type may tell of the other rooms one day: only a direct conversation starts here.
		if (room?.kind !== 'direct') return { action: 'ignore' };
		if (settings.sentBy === 'others' && isMine) return { action: 'ignore' };
		if (settings.sentBy === 'me' && !isMine) return { action: 'ignore' };
	} else if (isMine) {
		// The gateway also tells you of the mentions you make.
		return { action: 'ignore' };
	}

	const json: IDataObject = { ...delivery };
	if (settings.includeMessage) {
		json.message = await readMessage(api, room?.id, delivery.data?.object?.id);
	}
	return { action: 'start', json };
}
