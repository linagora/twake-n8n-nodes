import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IHookFunctions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type JsonObject,
} from 'n8n-workflow';

import {
	ASSIGNMENT_EVENTS,
	handleCall,
	parseEmails,
	settingsError,
	subscribe,
	subscriptionExists,
	unsubscribe,
	type AssignedTo,
	type Delivery,
	type MadeBy,
	type Request,
	type Settings,
	type State,
} from './trigger';

const CREDENTIAL_TYPE = 'twakeProjectOAuth2Api';

const EVENTS = [
	['Task Assigned', 'assigned', 'Someone is assigned to a task'],
	['Task Created', 'created', 'You create a task'],
	['Task Deleted', 'deleted', 'You move a task to the trash'],
	['Task Unassigned', 'unassigned', 'Someone is removed from a task'],
] as const;

interface Credentials {
	apiUrl: string;
	gatewayUrl?: string;
}

type Context = IHookFunctions | IWebhookFunctions;

const statusOf = (error: unknown) =>
	Number((error as { httpCode?: string }).httpCode ?? (error as { status?: number }).status);

/** Calls the gateway or Twake Project, at the URL of the credential, with the user's token. */
function requestOf(context: Context, base: 'apiUrl' | 'gatewayUrl'): Request {
	return async (options, tolerated = []) => {
		const credentials = await context.getCredentials<Credentials>(CREDENTIAL_TYPE);
		const url = credentials[base];
		if (!url) {
			throw new NodeOperationError(
				context.getNode(),
				'The credential has no Webhook Gateway URL: ask your n8n admin to set it',
			);
		}
		try {
			return (await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL_TYPE, {
				json: true,
				...options,
				url: `${url.replace(/\/+$/, '')}${options.url}`,
			})) as IDataObject;
		} catch (error) {
			if (tolerated.includes(statusOf(error))) return null;
			throw new NodeApiError(context.getNode(), error as JsonObject);
		}
	};
}

function settingsOf(context: Context): Settings {
	const events = context.getNodeParameter('events') as string[];
	const assignedTo = ASSIGNMENT_EVENTS.some((event) => events.includes(event))
		? (context.getNodeParameter('assignedTo', 'me') as AssignedTo)
		: 'anyone';
	return {
		events,
		createdBy: context.getNodeParameter('createdBy', 'me') as MadeBy,
		deletedBy: context.getNodeParameter('deletedBy', 'me') as MadeBy,
		assignedTo,
		emails:
			assignedTo === 'people'
				? parseEmails(context.getNodeParameter('assigneeEmails', '') as string)
				: [],
		includeTask: context.getNodeParameter('includeTask', true) as boolean,
	};
}

const stateOf = (context: Context) => context.getWorkflowStaticData('node') as State;

export class TwakeProjectNodeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Project Trigger',
		// The action node's name plus Trigger, so that n8n shows both under one app.
		name: 'twakeProjectNodeTrigger',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when one of your tasks changes in Twake Project',
		defaults: { name: 'Twake Project Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL_TYPE, required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description:
					'The changes that start the workflow: those you make, and the assignments to you',
				options: EVENTS.map(([name, value, description]) => ({ name, value, description })),
			},
			{
				displayName: 'Created By',
				name: 'createdBy',
				type: 'options',
				default: 'me',
				description: 'Who creates the task. Twake Project only tells you about your own.',
				displayOptions: { show: { events: ['created'] } },
				options: [{ name: 'Me', value: 'me' }],
			},
			{
				displayName: 'Deleted By',
				name: 'deletedBy',
				type: 'options',
				default: 'me',
				description:
					'Who moves the task to the trash. Twake Project only tells you about your own.',
				displayOptions: { show: { events: ['deleted'] } },
				options: [{ name: 'Me', value: 'me' }],
			},
			{
				displayName: 'Assigned To',
				name: 'assignedTo',
				type: 'options',
				default: 'me',
				description:
					'Who is assigned or removed. Twake Project only tells you when you assign or remove someone, and when someone assigns you.',
				displayOptions: { show: { events: ASSIGNMENT_EVENTS } },
				// Me first: the choice most workflows want.
				options: [
					{
						name: 'Me',
						value: 'me',
						description: 'You. An unassignment only reaches you when you remove yourself.',
					},
					{
						name: 'Anyone',
						value: 'anyone',
						description: 'Whoever you assign or remove, and you when someone assigns you',
					},
					{ name: 'Specific People', value: 'people' },
				],
			},
			{
				displayName: 'Emails',
				name: 'assigneeEmails',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'alice@example.com, bob@example.com',
				description:
					'The emails of the people, separated by commas. A person who left the project is not recognised.',
				displayOptions: { show: { events: ASSIGNMENT_EVENTS, assignedTo: ['people'] } },
			},
			{
				displayName: 'Include Task',
				name: 'includeTask',
				type: 'boolean',
				default: true,
				description:
					'Whether to read the task from its board and output it as `task`, null when you cannot see it anymore',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return subscriptionExists(
					stateOf(this),
					requestOf(this, 'gatewayUrl'),
					this.getNodeWebhookUrl('default') ?? '',
					settingsOf(this),
				);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const settings = settingsOf(this);
				const error = settingsError(settings);
				if (error) throw new NodeOperationError(this.getNode(), error);
				const webhookUrl = this.getNodeWebhookUrl('default') ?? '';
				await subscribe(stateOf(this), requestOf(this, 'gatewayUrl'), webhookUrl, settings);
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				return unsubscribe(stateOf(this), requestOf(this, 'gatewayUrl'));
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const call = {
			signature: this.getHeaderData()['twake-signature'] as string | undefined,
			rawBody: this.getRequestObject().rawBody,
			delivery: this.getBodyData() as Delivery,
			now: Math.floor(Date.now() / 1000),
		};
		const outcome = await handleCall(
			stateOf(this),
			settingsOf(this),
			call,
			requestOf(this, 'apiUrl'),
		);
		if (outcome.action === 'refuse') {
			this.getResponseObject().status(401).json({ error: 'invalid_signature' });
			return { noWebhookResponse: true };
		}
		if (outcome.action === 'ignore') return {};
		return { workflowData: [[{ json: outcome.json }]] };
	}
}
