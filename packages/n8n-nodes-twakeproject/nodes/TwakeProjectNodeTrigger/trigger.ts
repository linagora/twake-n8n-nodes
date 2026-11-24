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

export const typeOf = (event: string) => `com.twake.tasks.task.${event}.v1`;

export const ASSIGNMENT_EVENTS = ['assigned', 'unassigned'];

export type AssignedTo = 'me' | 'anyone' | 'people';

/** Who made a change: only you, as Twake Project tells you about your own creations and deletions. */
export type MadeBy = 'me';

/** The parameters of the node, read once per call. */
export interface Settings {
	events: string[];
	createdBy: MadeBy;
	deletedBy: MadeBy;
	/** `anyone` when no assignment event is chosen. */
	assignedTo: AssignedTo;
	/** The emails of Specific People, lowercased. */
	emails: string[];
	includeTask: boolean;
}

/** The subscription, kept in the node's static data. */
export interface State {
	subscriptionId?: string;
	secret?: string;
	/** Your uuid, for the Me choices. */
	owner?: string;
}

/**
 * A call to the gateway or to Twake Project, its URL relative to the credential's. It answers null
 * when the call fails with one of the `tolerated` statuses, and throws on any other failure.
 */
export type Request = (
	options: IHttpRequestOptions,
	tolerated?: readonly number[],
) => Promise<IDataObject | null>;

/** The emails of a list separated by commas, spaces or lines, lowercased. */
export function parseEmails(list: string): string[] {
	return list
		.split(/[\s,;]+/)
		.map((email) => email.trim().toLowerCase())
		.filter((email) => email.length > 0);
}

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Whether a creation or deletion passes its By choice. `me` is your uuid. */
export function isWantedActor(
	_choice: MadeBy,
	actorId: string | undefined,
	me: string | undefined,
) {
	return actorId !== undefined && me !== undefined && sameId(actorId, me);
}

/**
 * Whether the person an assignment event names passes the Assigned To choice. `me` is your uuid,
 * `email` the email of the assignee, when it was looked up.
 */
export function isWantedAssignee(
	choice: AssignedTo,
	assigneeId: string | undefined,
	{ me, email, emails }: { me?: string; email?: string; emails: readonly string[] },
): boolean {
	if (choice === 'anyone') return true;
	if (!assigneeId) return false;
	if (choice === 'me') return me !== undefined && sameId(assigneeId, me);
	return email !== undefined && emails.includes(email.toLowerCase());
}

/** Why the node cannot subscribe with these settings, or null. */
export function settingsError(settings: Settings): string | null {
	if (settings.events.length === 0) return 'Choose at least one event';
	if (settings.assignedTo === 'people' && settings.emails.length === 0) {
		return 'Enter at least one email in Emails';
	}
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
	twakeactorid?: string;
	data?: {
		object?: { id?: string; board?: { id?: string } };
		assignee?: { id?: string };
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

/** The task's board as you see it, or null when you cannot see it anymore. */
async function readBoard(api: Request, boardId: string | undefined) {
	if (!boardId) return null;
	return api({ method: 'GET', url: `/api/boards/${encodeURIComponent(boardId)}` }, [403, 404]);
}

const taskIn = (board: IDataObject | null, taskId: string | undefined) =>
	((board?.tasks ?? []) as IDataObject[]).find((task) => task.id === taskId) ?? null;

// A person removed from the project is no longer a member: their email is unknown.
const memberEmail = (board: IDataObject | null, userId: string | undefined) => {
	if (userId === undefined) return undefined;
	const members = (board?.members ?? []) as IDataObject[];
	const email = members.find(
		(member) => typeof member.userId === 'string' && sameId(member.userId, userId),
	)?.email;
	return typeof email === 'string' ? email : undefined;
};

export async function handleCall(
	state: State,
	settings: Settings,
	call: Call,
	api: Request,
): Promise<Outcome> {
	const { secret, owner: me } = state;
	if (typeof secret !== 'string' || !isSignedBy(secret, call.signature, call.rawBody, call.now)) {
		return { action: 'refuse' };
	}
	const { delivery } = call;
	const event = settings.events.find((chosen) => typeOf(chosen) === delivery.type);
	if (event === undefined) return { action: 'ignore' };
	const madeBy =
		event === 'created' ? settings.createdBy : event === 'deleted' ? settings.deletedBy : undefined;
	if (madeBy !== undefined && !isWantedActor(madeBy, delivery.twakeactorid, me)) {
		return { action: 'ignore' };
	}
	const choice = ASSIGNMENT_EVENTS.includes(event) ? settings.assignedTo : 'anyone';
	const board =
		settings.includeTask || choice === 'people'
			? await readBoard(api, delivery.data?.object?.board?.id)
			: null;
	const assigneeId = delivery.data?.assignee?.id;
	const wanted = isWantedAssignee(choice, assigneeId, {
		me,
		email: memberEmail(board, assigneeId),
		emails: settings.emails,
	});
	if (!wanted) return { action: 'ignore' };
	const json: IDataObject = { ...delivery };
	if (settings.includeTask) json.task = taskIn(board, delivery.data?.object?.id);
	return { action: 'start', json };
}
