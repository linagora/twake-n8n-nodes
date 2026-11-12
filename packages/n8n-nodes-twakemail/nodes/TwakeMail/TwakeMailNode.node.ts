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
	downloadUrl,
	emailFilter,
	getAttachments,
	getEmail,
	getSession,
	getThread,
	listMailboxes,
	mailAccount,
	searchEmails,
	type Account,
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
		description: 'Read the mail account of a Twake user',
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
						name: 'Search',
						value: 'search',
						description: 'Search emails, newest first',
						action: 'Search emails',
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
			{ ...emailId, displayOptions: showFor('email', ['get', 'getAttachments']) },
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
				const param = (name: string) => this.getNodeParameter(name, itemIndex);
				const resource = param('resource') as string;
				const operation = param('operation') as string;
				session ??= await getSession(call, baseUrl);
				if (resource === 'session') {
					out.push({ json: session, pairedItem });
					continue;
				}
				account ??= mailAccount(session, baseUrl);

				if (resource === 'thread') {
					for (const json of await getThread(call, account, param('threadId') as string))
						out.push({ json, pairedItem });
				} else if (operation === 'search') {
					const filter = emailFilter(param('filters') as SearchFilter);
					const limit = param('returnAll') ? Infinity : (param('limit') as number);
					for (const json of await searchEmails(call, account, filter, limit))
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
