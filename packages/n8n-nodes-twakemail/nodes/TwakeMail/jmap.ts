import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

/** Sends an authenticated request to an absolute URL. */
export type Request = (options: IHttpRequestOptions) => Promise<unknown>;

export type MethodCall = [string, IDataObject, string];

export interface Account {
	accountId: string;
	apiUrl: string;
	downloadUrl: string;
}

export const MAIL = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'];

const ACCEPT = { Accept: 'application/json;jmapVersion=rfc-8621' };

// James caps the limit of Email/query at 256.
const PAGE = 256;

export const EMAIL_PROPERTIES = [
	'id',
	'threadId',
	'mailboxIds',
	'keywords',
	'from',
	'to',
	'cc',
	'subject',
	'receivedAt',
	'preview',
	'hasAttachment',
	'size',
];

const FULL_EMAIL_PROPERTIES = [
	...EMAIL_PROPERTIES,
	'textBody',
	'htmlBody',
	'bodyValues',
	'attachments',
	'messageId',
	'inReplyTo',
	'references',
	'replyTo',
	'bcc',
	'sentAt',
];

export interface SearchFilter {
	inMailbox?: string;
	from?: string;
	to?: string;
	subject?: string;
	text?: string;
	after?: string;
	before?: string;
	hasKeyword?: string;
	notKeyword?: string;
	hasAttachment?: boolean;
}

export type Attachment = {
	blobId: string;
	name?: string | null;
	type?: string;
	size?: number;
};

export async function getSession(call: Request, baseUrl: string): Promise<IDataObject> {
	return (await call({
		method: 'GET',
		url: `${baseUrl}/jmap/session`,
		headers: ACCEPT,
	})) as IDataObject;
}

/**
 * The mail account of a session. Its URLs come from the `url.prefix` setting of the server, which may
 * not be the address n8n reaches, so they keep their path on the origin of the credential's URL.
 */
export function mailAccount(session: IDataObject, baseUrl: string): Account {
	const accountId = (session.primaryAccounts as IDataObject | undefined)?.[MAIL[1]];
	if (typeof accountId !== 'string') throw new Error('The JMAP session has no mail account');
	const origin = new URL(baseUrl).origin;
	const rebase = (url: unknown) =>
		String(url ?? '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, origin);
	return { accountId, apiUrl: rebase(session.apiUrl), downloadUrl: rebase(session.downloadUrl) };
}

/** Sends method calls and returns the arguments of each response by call ID. */
export async function jmap(
	call: Request,
	account: Account,
	methodCalls: MethodCall[],
	using: string[] = MAIL,
): Promise<Record<string, IDataObject>> {
	const response = (await call({
		method: 'POST',
		url: account.apiUrl,
		headers: ACCEPT,
		body: { using, methodCalls },
	})) as { methodResponses?: MethodCall[] };
	const results: Record<string, IDataObject> = {};
	// A method error comes with HTTP 200, in place of the response.
	for (const [name, args, id] of response.methodResponses ?? []) {
		if (name === 'error') {
			const description = args.description ? `: ${String(args.description)}` : '';
			throw new Error(`JMAP error ${String(args.type)}${description}`);
		}
		results[id] = args;
	}
	return results;
}

const list = (result: IDataObject | undefined) => (result?.list ?? []) as IDataObject[];

function requireFound(result: IDataObject, what: string, id: string) {
	if ((result.notFound as string[] | undefined)?.length)
		throw new Error(`No ${what} with the ID ${id}`);
}

/** The JMAP filter of the fields that are set. Several fields are ANDed. */
export function emailFilter(fields: SearchFilter): IDataObject {
	const filter: IDataObject = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined || value === '') continue;
		filter[key] = key === 'after' || key === 'before' ? utcDate(String(value)) : value;
	}
	return filter;
}

/** A JMAP UTCDate. A date without an offset is in UTC. */
function utcDate(value: string): string {
	const exact = /(z|[+-]\d\d:?\d\d)$/i.test(value);
	const date = new Date(exact ? value : `${value.includes('T') ? value : `${value}T00:00:00`}Z`);
	if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
	return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

/** The newest emails first, without their bodies, up to `limit`. */
export async function searchEmails(
	call: Request,
	account: Account,
	filter: IDataObject,
	limit = Infinity,
): Promise<IDataObject[]> {
	const emails: IDataObject[] = [];
	// James has no `anchor`: pages until one is short.
	while (emails.length < limit) {
		const size = Math.min(PAGE, limit - emails.length);
		const { accountId } = account;
		const results = await jmap(call, account, [
			[
				'Email/query',
				{
					accountId,
					filter,
					sort: [{ property: 'receivedAt', isAscending: false }],
					position: emails.length,
					limit: size,
				},
				'q',
			],
			[
				'Email/get',
				{
					accountId,
					'#ids': { resultOf: 'q', name: 'Email/query', path: '/ids/*' },
					properties: EMAIL_PROPERTIES,
				},
				'g',
			],
		]);
		const page = list(results.g);
		emails.push(...page);
		if (((results.q?.ids as unknown[] | undefined)?.length ?? 0) < size) break;
	}
	return emails;
}

async function fetchEmail(call: Request, account: Account, emailId: string, args: IDataObject) {
	const { g } = await jmap(call, account, [
		['Email/get', { accountId: account.accountId, ids: [emailId], ...args }, 'g'],
	]);
	requireFound(g, 'email', emailId);
	const [email] = list(g);
	if (!email) throw new Error(`No email with the ID ${emailId}`);
	return email;
}

/** An email with its bodies. */
export async function getEmail(call: Request, account: Account, emailId: string) {
	return await fetchEmail(call, account, emailId, {
		properties: FULL_EMAIL_PROPERTIES,
		fetchTextBodyValues: true,
		fetchHTMLBodyValues: true,
	});
}

/** The emails of a thread, without their bodies, oldest first as JMAP sorts them. */
export async function getThread(
	call: Request,
	account: Account,
	threadId: string,
): Promise<IDataObject[]> {
	const { accountId } = account;
	const { t, g } = await jmap(call, account, [
		['Thread/get', { accountId, ids: [threadId] }, 't'],
		[
			'Email/get',
			{
				accountId,
				'#ids': { resultOf: 't', name: 'Thread/get', path: '/list/*/emailIds' },
				properties: EMAIL_PROPERTIES,
			},
			'g',
		],
	]);
	requireFound(t, 'thread', threadId);
	return list(g);
}

export async function getAttachments(call: Request, account: Account, emailId: string) {
	const email = await fetchEmail(call, account, emailId, { properties: ['id', 'attachments'] });
	return (email.attachments ?? []) as Attachment[];
}

/** The download URL of a blob, from the RFC 6570 template of the session. */
export function downloadUrl(account: Account, attachment: Attachment): string {
	const values: Record<string, string> = {
		accountId: account.accountId,
		blobId: attachment.blobId,
		type: attachment.type || 'application/octet-stream',
		name: attachment.name || 'attachment',
	};
	return account.downloadUrl.replace(/\{(\w+)\}/g, (_, key: string) =>
		encodeURIComponent(values[key] ?? ''),
	);
}

export async function listMailboxes(call: Request, account: Account): Promise<IDataObject[]> {
	const { m } = await jmap(call, account, [
		[
			'Mailbox/get',
			{ accountId: account.accountId, ids: null, properties: ['id', 'name', 'role'] },
			'm',
		],
	]);
	return list(m);
}
