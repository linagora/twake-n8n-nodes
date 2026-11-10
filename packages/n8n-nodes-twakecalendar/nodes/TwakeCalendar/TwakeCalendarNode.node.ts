import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import {
	calendarPath,
	createEvent,
	createVideoConference,
	deleteEvent,
	getUser,
	listCalendars,
	updateEvent,
	videoConferenceFailure,
	type EventFields,
	type Request,
	type User,
} from './events';

const CREDENTIAL_TYPE = 'twakeCalendarOAuth2Api';

async function caller(context: IExecuteFunctions | ILoadOptionsFunctions): Promise<Request> {
	const { apiUrl } = await context.getCredentials<{ apiUrl: string }>(CREDENTIAL_TYPE);
	const baseUrl = apiUrl.replace(/\/+$/, '');
	return async (options) =>
		await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL_TYPE, {
			json: true,
			...options,
			url: `${baseUrl}${options.url}`,
		});
}

const showFor = (operation: string[]) => ({ show: { resource: ['event'], operation } });

const title: INodeProperties = { displayName: 'Title', name: 'title', type: 'string', default: '' };
const start: INodeProperties = {
	displayName: 'Start',
	name: 'start',
	type: 'dateTime',
	default: '',
	hint: 'Without a time zone, the time zone of the workflow applies',
};
const end: INodeProperties = {
	displayName: 'End',
	name: 'end',
	type: 'dateTime',
	default: '',
	hint: 'For an all-day event, the day after the last day',
};

const optionalFields: INodeProperties[] = [
	{
		displayName: 'Alarms',
		name: 'alarms',
		type: 'fixedCollection',
		placeholder: 'Add Alarm',
		default: {},
		typeOptions: { multipleValues: true },
		description: 'Replace the alarms of the event',
		options: [
			{
				displayName: 'Alarm',
				name: 'alarm',
				values: [
					{
						displayName: 'Minutes Before',
						name: 'minutesBefore',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: 15,
					},
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						default: 'EMAIL',
						options: [
							{ name: 'Email', value: 'EMAIL', description: 'Send an email to the user' },
							{
								name: 'Notification',
								value: 'DISPLAY',
								description: 'Show a notification in the apps',
							},
						],
					},
				],
			},
		],
	},
	{ displayName: 'All Day', name: 'allDay', type: 'boolean', default: false },
	{
		displayName: 'Attendees',
		name: 'attendees',
		type: 'string',
		default: '',
		placeholder: 'e.g. alice@example.com, bob@example.com',
		description:
			'Comma-separated emails of the people to invite. Replaces the attendees of the event, and makes the user its organizer.',
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
	},
	{ displayName: 'Location', name: 'location', type: 'string', default: '' },
	{
		displayName: 'Rooms',
		name: 'rooms',
		type: 'string',
		default: '',
		placeholder: 'e.g. room-1@example.com',
		description:
			'Comma-separated emails of the rooms or equipment to book. Replaces the rooms of the event.',
	},
];

export class TwakeCalendarNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Calendar',
		name: 'twakeCalendarNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Manage the calendars, events and video conferences of a Twake user',
		defaults: { name: 'Twake Calendar' },
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
				default: 'calendar',
				options: [
					{ name: 'Calendar', value: 'calendar' },
					{ name: 'Event', value: 'event' },
					{ name: 'Video Conference', value: 'videoConference' },
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'getAll',
				displayOptions: { show: { resource: ['calendar'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List the calendars of the connected user',
						action: 'Get many calendars',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'create',
				displayOptions: { show: { resource: ['event'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create an event, and invite its attendees and rooms',
						action: 'Create an event',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete an event',
						action: 'Delete an event',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Change the fields of an event',
						action: 'Update an event',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'create',
				displayOptions: { show: { resource: ['videoConference'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a video conference room, not attached to any event',
						action: 'Create a video conference',
					},
				],
			},
			{
				displayName: 'Calendar Name or ID',
				name: 'calendar',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getCalendars' },
				required: true,
				default: '',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: showFor(['create', 'update', 'delete']),
			},
			{
				displayName: 'Event ID',
				name: 'eventId',
				type: 'string',
				required: true,
				default: '',
				description: 'UID of the event, as in the output of Create',
				displayOptions: showFor(['update', 'delete']),
			},
			{ ...title, required: true, displayOptions: showFor(['create']) },
			{ ...start, required: true, displayOptions: showFor(['create']) },
			{ ...end, required: true, displayOptions: showFor(['create']) },
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: showFor(['create']),
				options: optionalFields,
			},
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: showFor(['update']),
				options: [...optionalFields, end, start, title].sort((a, b) =>
					a.displayName.localeCompare(b.displayName),
				),
			},
		],
	};

	methods = {
		loadOptions: {
			async getCalendars(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const call = await caller(this);
				const user = await getUser(call);
				return (await listCalendars(call, user.id)).flatMap((calendar) => {
					const href = (calendar._links as { self?: { href?: string } } | undefined)?.self?.href;
					if (!href) return [];
					const value = href.replace(/\.json$/, '');
					// The service names the main calendar of a user `#default`.
					const name =
						calendar['dav:name'] === '#default' ? 'Default Calendar' : calendar['dav:name'];
					return [{ name: String(name || value), value }];
				});
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const call = await caller(this);
		const timeZone = this.getTimezone();
		const out: INodeExecutionData[] = [];
		let user: User | undefined;

		for (const [itemIndex] of this.getInputData().entries()) {
			const pairedItem = { item: itemIndex };
			try {
				const param = (name: string) => this.getNodeParameter(name, itemIndex);
				const resource = param('resource') as string;
				const operation = param('operation') as string;

				if (resource === 'videoConference') {
					let json: IDataObject;
					try {
						json = await createVideoConference(call);
					} catch (error) {
						const message = videoConferenceFailure(error);
						throw message
							? new NodeOperationError(this.getNode(), message, { itemIndex })
							: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
					}
					out.push({ json, pairedItem });
					continue;
				}
				user ??= await getUser(call);
				if (resource === 'calendar') {
					for (const json of await listCalendars(call, user.id)) out.push({ json, pairedItem });
					continue;
				}

				const calendar = calendarPath(param('calendar') as string, user.id);
				let json: IDataObject;
				if (operation === 'create') {
					const fields: EventFields = {
						...(param('additionalFields') as EventFields),
						title: param('title') as string,
						start: String(param('start')),
						end: String(param('end')),
					};
					json = await createEvent(call, user, calendar, fields, timeZone);
				} else if (operation === 'update') {
					const fields = { ...(param('updateFields') as EventFields) };
					// An expression can give a DateTime object.
					if (fields.start) fields.start = String(fields.start);
					if (fields.end) fields.end = String(fields.end);
					json = await updateEvent(
						call,
						user,
						calendar,
						param('eventId') as string,
						fields,
						timeZone,
					);
				} else {
					json = await deleteEvent(call, calendar, param('eventId') as string);
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
