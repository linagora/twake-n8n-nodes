import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import { editMessage, react, sendFile, sendMessage, type Request } from './messages';

const CREDENTIAL_TYPE = 'twakeChatOAuth2Api';

async function caller(context: IExecuteFunctions): Promise<Request> {
	const { apiUrl: homeserverUrl } = await context.getCredentials<{ apiUrl: string }>(
		CREDENTIAL_TYPE,
	);
	const baseUrl = `${homeserverUrl.replace(/\/+$/, '')}/_matrix`;
	return async (options) =>
		await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL_TYPE, {
			json: true,
			...options,
			url: `${baseUrl}${options.url}`,
		});
}

const showFor = (operation: string[]) => ({ show: { resource: ['message'], operation } });

const messageFields: INodeProperties[] = [
	{
		displayName: 'Room ID',
		name: 'roomId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. !abcdefgh:example.com',
		hint: 'In Twake Chat, the room settings show it',
		displayOptions: { show: { resource: ['message'] } },
	},
	{
		displayName: 'Message ID',
		name: 'eventId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. $abcdefgh',
		hint: 'The event_id output by Send',
		displayOptions: showFor(['react', 'edit']),
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		displayOptions: showFor(['send', 'edit']),
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['send']),
		options: [
			{
				displayName: 'HTML',
				name: 'html',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'The message formatted in HTML, shown instead of Text by clients that can',
			},
		],
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the input binary field holding the file',
		displayOptions: showFor(['sendFile']),
	},
	{
		displayName: 'Reaction',
		name: 'reaction',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 👍',
		displayOptions: showFor(['react']),
	},
];

export class TwakeChatNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Chat',
		name: 'twakeChatNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Send, edit and react to messages in Twake Chat',
		defaults: { name: 'Twake Chat' },
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
				// Saved workflows omit default values, so changing it would turn their Account node into Message.
				default: 'account',
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Message', value: 'message' },
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'get',
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get the Matrix ID of the connected account',
						action: 'Get account',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'send',
				displayOptions: { show: { resource: ['message'] } },
				options: [
					{
						name: 'Edit',
						value: 'edit',
						description: 'Replace the text of a message you sent',
						action: 'Edit a message',
					},
					{
						name: 'React',
						value: 'react',
						description: 'Add a reaction to a message',
						action: 'React to a message',
					},
					{
						name: 'Send',
						value: 'send',
						description: 'Send a text message to a room',
						action: 'Send a message',
					},
					{
						name: 'Send File',
						value: 'sendFile',
						description: 'Send a file to a room',
						action: 'Send a file',
					},
				],
			},
			...messageFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const call = await caller(this);
		const out: INodeExecutionData[] = [];

		for (const [itemIndex] of this.getInputData().entries()) {
			const pairedItem = { item: itemIndex };
			try {
				const param = (name: string) => this.getNodeParameter(name, itemIndex) as string;
				let json: IDataObject;
				if (param('resource') === 'account') {
					json = (await call({ method: 'GET', url: '/client/v3/account/whoami' })) as IDataObject;
				} else {
					const operation = param('operation');
					const roomId = param('roomId').trim();
					if (operation === 'send') {
						const { html } = this.getNodeParameter('options', itemIndex) as { html?: string };
						json = await sendMessage(call, roomId, param('text'), html);
					} else if (operation === 'sendFile') {
						const field = param('binaryPropertyName');
						const binary = this.helpers.assertBinaryData(itemIndex, field);
						json = await sendFile(call, roomId, {
							name: binary.fileName ?? 'file',
							mimeType: binary.mimeType || 'application/octet-stream',
							// Loads the whole file in memory, stream it if large uploads matter
							content: await this.helpers.getBinaryDataBuffer(itemIndex, field),
						});
					} else if (operation === 'react') {
						json = await react(call, roomId, param('eventId').trim(), param('reaction'));
					} else {
						json = await editMessage(call, roomId, param('eventId').trim(), param('text'));
					}
				}
				out.push({ json, pairedItem });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem });
					continue;
				}
				throw error instanceof NodeOperationError
					? error
					: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
			}
		}

		return [out];
	}
}
