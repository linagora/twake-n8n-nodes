import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestOptions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

const CREDENTIAL_TYPE = 'twakeCalendarOAuth2Api';

interface CalendarUser {
	id?: string;
	_id?: string;
}

interface CalendarList {
	_embedded?: { 'dav:calendar'?: IDataObject[] };
}

async function request<T>(
	this: IExecuteFunctions,
	options: Pick<IHttpRequestOptions, 'url' | 'headers' | 'qs'>,
): Promise<T> {
	return (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, {
		method: 'GET',
		json: true,
		...options,
	})) as T;
}

export class TwakeCalendarNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Calendar',
		name: 'twakeCalendarNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Read the calendars of a Twake user',
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
				options: [{ name: 'Calendar', value: 'calendar' }],
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const { apiUrl } = await this.getCredentials<{ apiUrl: string }>(CREDENTIAL_TYPE);
		const baseUrl = apiUrl.replace(/\/+$/, '');
		const out: INodeExecutionData[] = [];

		for (const [itemIndex] of this.getInputData().entries()) {
			try {
				const user = await (request<CalendarUser>).call(this, { url: `${baseUrl}/api/user` });
				const userId = user.id ?? user._id;
				if (!userId) {
					throw new NodeOperationError(
						this.getNode(),
						'The calendar service did not return a user ID',
						{ itemIndex },
					);
				}
				const list = await (request<CalendarList>).call(this, {
					url: `${baseUrl}/dav/calendars/${encodeURIComponent(userId)}.json`,
					headers: { Accept: 'application/calendar+json' },
					qs: {
						personal: true,
						sharedDelegationStatus: 'accepted',
						sharedPublicSubscription: true,
						withRights: true,
					},
				});
				for (const json of list._embedded?.['dav:calendar'] ?? []) {
					out.push({ json, pairedItem: { item: itemIndex } });
				}
			} catch (error) {
				if (!this.continueOnFail()) {
					throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
				}
				out.push({ json: { error: (error as Error).message }, pairedItem: { item: itemIndex } });
			}
		}

		return [out];
	}
}
