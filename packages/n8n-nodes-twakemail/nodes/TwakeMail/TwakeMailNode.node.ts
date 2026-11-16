import {
	NodeApiError,
	NodeConnectionTypes,
	type IBinaryData,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import {
	addresses,
	applyLabel,
	composeContext,
	createEmail,
	createLabel,
	deleteEmail,
	downloadUrl,
	emailFilter,
	forwardDraft,
	getAttachments,
	getEmail,
	getSession,
	getThread,
	listLabels,
	listMailboxes,
	mailAccount,
	replyDraft,
	searchEmails,
	updateEmail,
	type Account,
	type Draft,
	type Request,
	type SearchFilter,
} from './jmap';

const CREDENTIAL_TYPE = 'twakeMailOAuth2Api';

async function connect(context: IExecuteFunctions | ILoadOptionsFunctions) {
	const { apiUrl } = await context.getCredentials<{ apiUrl: string }>(CREDENTIAL_TYPE);
	const baseUrl = apiUrl.replace(/\/+$/, '');
	const call: Request = async (options) =>
		await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL_TYPE, {
			json: true,
			...options,
		});
	return { baseUrl, call };
}

const showFor = (resource: string, operation: string[]) => ({
	show: { resource: [resource], operation },
});

const COMPOSE = ['send', 'createDraft', 'reply', 'forward'];

// The patch of each operation that only changes the keywords of an email.
const KEYWORD_PATCHES: Record<string, IDataObject> = {
	markAsRead: { 'keywords/$seen': true },
	markAsUnread: { 'keywords/$seen': null },
	flag: { 'keywords/$flagged': true },
	unflag: { 'keywords/$flagged': null },
};

const recipients = {
	displayName: 'To',
	name: 'to',
	type: 'string' as const,
	default: '',
	placeholder: 'e.g. alice@example.com, Bob <bob@example.com>',
	description: 'Recipients, separated by commas',
};

const emailId = {
	displayName: 'Email ID',
	name: 'emailId',
	type: 'string' as const,
	required: true,
	default: '',
	description: 'ID of the email, as in the output of Search',
};

export class TwakeMailNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Mail',
		name: 'twakeMailNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Read and send the emails of a Twake user',
		defaults: { name: 'Twake Mail' },
		credentials: [{ name: CREDENTIAL_TYPE, required: true }],
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'session',
				options: [
					{ name: 'Email', value: 'email' },
					{ name: 'Label', value: 'label' },
					{ name: 'Session', value: 'session' },
					{ name: 'Thread', value: 'thread' },
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'search',
				displayOptions: { show: { resource: ['email'] } },
				options: [
					{
						name: 'Create Draft',
						value: 'createDraft',
						description: 'Save an email in Drafts without sending it',
						action: 'Create a draft',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Move an email to Trash, or delete it permanently',
						action: 'Delete an email',
					},
					{
						name: 'Flag',
						value: 'flag',
						description: 'Flag an email',
						action: 'Flag an email',
					},
					{
						name: 'Forward',
						value: 'forward',
						description: 'Forward an email with its attachments',
						action: 'Forward an email',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Get an email with its bodies',
						action: 'Get an email',
					},
					{
						name: 'Get Attachments',
						value: 'getAttachments',
						description: 'List the attachments of an email, and download them',
						action: 'Get the attachments of an email',
					},
					{
						name: 'Mark as Read',
						value: 'markAsRead',
						description: 'Mark an email as read',
						action: 'Mark an email as read',
					},
					{
						name: 'Mark as Unread',
						value: 'markAsUnread',
						description: 'Mark an email as unread',
						action: 'Mark an email as unread',
					},
					{
						name: 'Move',
						value: 'move',
						description: 'Move an email to a mailbox',
						action: 'Move an email',
					},
					{
						name: 'Reply',
						value: 'reply',
						description: 'Reply to the sender of an email',
						action: 'Reply to an email',
					},
					{
						name: 'Search',
						value: 'search',
						description: 'Search emails, newest first',
						action: 'Search emails',
					},
					{
						name: 'Send',
						value: 'send',
						description: 'Send an email',
						action: 'Send an email',
					},
					{
						name: 'Unflag',
						value: 'unflag',
						description: 'Remove the flag of an email',
						action: 'Unflag an email',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'getAll',
				displayOptions: { show: { resource: ['label'] } },
				options: [
					{
						name: 'Apply',
						value: 'apply',
						description: 'Apply a label to an email',
						action: 'Apply a label to an email',
					},
					{
						name: 'Create',
						value: 'create',
						description: 'Create a label',
						action: 'Create a label',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List the labels',
						action: 'Get many labels',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'get',
				displayOptions: { show: { resource: ['session'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get the JMAP session of the connected user',
						action: 'Get session',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'get',
				displayOptions: { show: { resource: ['thread'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get the emails of a thread',
						action: 'Get a thread',
					},
				],
			},
			{
				...emailId,
				displayOptions: showFor('email', [
					'get',
					'getAttachments',
					'reply',
					'forward',
					'move',
					'delete',
					...Object.keys(KEYWORD_PATCHES),
				]),
			},
			{
				displayName: 'Mailbox Name or ID',
				name: 'mailboxId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getMailboxes' },
				required: true,
				default: '',
				description:
					'Mailbox to move the email to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: showFor('email', ['move']),
			},
			{
				displayName: 'Permanently',
				name: 'permanently',
				type: 'boolean',
				default: false,
				description: 'Whether to delete the email for good instead of moving it to Trash',
				displayOptions: showFor('email', ['delete']),
			},
			{ ...emailId, displayOptions: showFor('label', ['apply']) },
			{
				displayName: 'Label Name or ID',
				name: 'labelId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLabels' },
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: showFor('label', ['apply']),
			},
			{
				displayName: 'Name',
				name: 'displayName',
				type: 'string',
				required: true,
				default: '',
				displayOptions: showFor('label', ['create']),
			},
			{
				displayName: 'Options',
				name: 'labelOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: showFor('label', ['create']),
				options: [
					{ displayName: 'Color', name: 'color', type: 'color', default: '' },
					{ displayName: 'Description', name: 'description', type: 'string', default: '' },
				],
			},
			{ ...recipients, required: true, displayOptions: showFor('email', ['send', 'forward']) },
			{ ...recipients, displayOptions: showFor('email', ['createDraft']) },
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				default: '',
				displayOptions: showFor('email', ['send', 'createDraft']),
			},
			{
				displayName: 'Email Type',
				name: 'emailType',
				type: 'options',
				default: 'text',
				options: [
					{ name: 'Text', value: 'text' },
					{ name: 'HTML', value: 'html' },
				],
				displayOptions: showFor('email', COMPOSE),
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 5 },
				default: '',
				displayOptions: showFor('email', COMPOSE),
			},
			{
				displayName: 'Reply to All',
				name: 'replyAll',
				type: 'boolean',
				default: false,
				description: 'Whether to also reply to the other recipients of the email',
				displayOptions: showFor('email', ['reply']),
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: showFor('email', ['send', 'createDraft', 'forward']),
				options: [
					{
						...recipients,
						displayName: 'Bcc',
						name: 'bcc',
						description: 'Hidden recipients, separated by commas',
					},
					{
						...recipients,
						displayName: 'Cc',
						name: 'cc',
						description: 'Copy recipients, separated by commas',
					},
				],
			},
			{
				displayName: 'Download',
				name: 'download',
				type: 'boolean',
				default: true,
				description:
					'Whether to download the attachments as binaries "attachment_0", "attachment_1"…',
				displayOptions: showFor('email', ['getAttachments']),
			},
			{
				displayName: 'Thread ID',
				name: 'threadId',
				type: 'string',
				required: true,
				default: '',
				description: 'The "threadId" of any email of the thread',
				displayOptions: showFor('thread', ['get']),
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: showFor('email', ['search']),
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['email'], operation: ['search'], returnAll: [false] },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: showFor('email', ['search']),
				options: [
					{
						displayName: 'After',
						name: 'after',
						type: 'dateTime',
						default: '',
						description: 'Received at or after this date',
						hint: 'Without a time zone, UTC applies',
					},
					{
						displayName: 'Before',
						name: 'before',
						type: 'dateTime',
						default: '',
						description: 'Received before this date',
						hint: 'Without a time zone, UTC applies',
					},
					{
						displayName: 'From',
						name: 'from',
						type: 'string',
						default: '',
						description: 'Text in the sender address or name',
					},
					{
						displayName: 'Has Attachment',
						name: 'hasAttachment',
						type: 'boolean',
						default: true,
						description: 'Whether the email has attachments',
					},
					{
						displayName: 'Has Keyword',
						name: 'hasKeyword',
						type: 'string',
						default: '',
						placeholder: 'e.g. $flagged',
						description: 'Keyword the email has, such as $seen, $flagged or $answered',
					},
					{
						displayName: 'Mailbox Name or ID',
						name: 'inMailbox',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getMailboxes' },
						default: '',
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{
						displayName: 'Not Keyword',
						name: 'notKeyword',
						type: 'string',
						default: '',
						placeholder: 'e.g. $seen',
						description: 'Keyword the email does not have, such as $seen to find unread emails',
					},
					{
						displayName: 'Subject',
						name: 'subject',
						type: 'string',
						default: '',
						description: 'Text in the subject',
					},
					{
						displayName: 'Text',
						name: 'text',
						type: 'string',
						default: '',
						description: 'Text in the addresses, subject or bodies',
					},
					{
						displayName: 'To',
						name: 'to',
						type: 'string',
						default: '',
						description: 'Text in the recipient addresses or names',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getLabels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const { baseUrl, call } = await connect(this);
				const account = mailAccount(await getSession(call, baseUrl), baseUrl);
				return (await listLabels(call, account)).map((label) => ({
					name: String(label.displayName ?? label.id),
					value: String(label.id),
				}));
			},
			async getMailboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const { baseUrl, call } = await connect(this);
				const account = mailAccount(await getSession(call, baseUrl), baseUrl);
				return (await listMailboxes(call, account)).map((mailbox) => ({
					name: String(mailbox.name ?? mailbox.id),
					value: String(mailbox.id),
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const { baseUrl, call } = await connect(this);
		const out: INodeExecutionData[] = [];
		let session: IDataObject | undefined;
		let account: Account | undefined;

		for (const [itemIndex] of this.getInputData().entries()) {
			const pairedItem = { item: itemIndex };
			try {
				const param = (name: string, fallback?: unknown) =>
					this.getNodeParameter(name, itemIndex, fallback);
				const resource = param('resource') as string;
				const operation = param('operation') as string;
				session ??= await getSession(call, baseUrl);
				if (resource === 'session') {
					out.push({ json: session, pairedItem });
					continue;
				}
				account ??= mailAccount(session, baseUrl);

				if (resource === 'label') {
					if (operation === 'getAll') {
						for (const json of await listLabels(call, account)) out.push({ json, pairedItem });
					} else if (operation === 'create') {
						const label = {
							displayName: param('displayName'),
							...(param('labelOptions') as IDataObject),
						};
						out.push({ json: await createLabel(call, account, label), pairedItem });
					} else {
						const id = param('emailId') as string;
						const json = await applyLabel(call, account, id, param('labelId') as string);
						out.push({ json, pairedItem });
					}
				} else if (resource === 'thread') {
					for (const json of await getThread(call, account, param('threadId') as string))
						out.push({ json, pairedItem });
				} else if (operation === 'search') {
					const filter = emailFilter(param('filters') as SearchFilter);
					const limit = param('returnAll') ? Infinity : (param('limit') as number);
					for (const json of await searchEmails(call, account, filter, limit))
						out.push({ json, pairedItem });
				} else if (operation in KEYWORD_PATCHES || operation === 'move') {
					const id = param('emailId') as string;
					const patch = KEYWORD_PATCHES[operation] ?? {
						mailboxIds: { [param('mailboxId') as string]: true },
					};
					out.push({ json: await updateEmail(call, account, id, patch), pairedItem });
				} else if (operation === 'delete') {
					const id = param('emailId') as string;
					const json = await deleteEmail(call, account, id, param('permanently') as boolean);
					out.push({ json, pairedItem });
				} else if (COMPOSE.includes(operation)) {
					const options = param('options', {}) as IDataObject;
					const message = {
						body: param('message') as string,
						html: param('emailType') === 'html',
					};
					const originalId = ['reply', 'forward'].includes(operation)
						? (param('emailId') as string)
						: undefined;
					const context = await composeContext(call, account, originalId);
					let draft: Draft = {
						...message,
						to: addresses(param('to', '') as string),
						cc: addresses(options.cc as string),
						bcc: addresses(options.bcc as string),
						subject: param('subject', '') as string,
					};
					const { original: email = {}, identity } = context;
					if (operation === 'reply') {
						const all = param('replyAll') as boolean;
						draft = replyDraft(email, String(identity.email), all, message.body, message.html);
					} else if (operation === 'forward') {
						draft = forwardDraft(email, draft);
					}
					const json = await createEmail(
						call,
						account,
						context,
						draft,
						operation !== 'createDraft',
					);
					out.push({ json, pairedItem });
				} else if (operation === 'get') {
					out.push({ json: await getEmail(call, account, param('emailId') as string), pairedItem });
				} else {
					const id = param('emailId') as string;
					const attachments = await getAttachments(call, account, id);
					const binary: Record<string, IBinaryData> = {};
					if (param('download')) {
						for (const [index, attachment] of attachments.entries()) {
							// Loads each attachment in memory, stream them if large ones matter
							const content = (await call({
								method: 'GET',
								url: downloadUrl(account, attachment),
								encoding: 'arraybuffer',
								json: false,
							})) as ArrayBuffer;
							binary[`attachment_${index}`] = await this.helpers.prepareBinaryData(
								Buffer.from(content),
								attachment.name ?? undefined,
								attachment.type,
							);
						}
					}
					out.push({
						json: { id, attachments },
						binary,
						pairedItem,
					});
				}
			} catch (error) {
				if (!this.continueOnFail()) {
					throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
				}
				out.push({ json: { error: (error as Error).message }, pairedItem });
			}
		}

		return [out];
	}
}
