import {
	NodeApiError,
	NodeConnectionTypes,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import { instanceUrlOf } from '../../credentials/stackToken';

const CREDENTIAL_TYPE = 'twakeAccountOAuth2Api';

export class TwakeAccountNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Account',
		name: 'twakeAccountNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Read the apps and the disk usage of a Twake instance',
		defaults: { name: 'Twake Account' },
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
				default: 'app',
				options: [
					{ name: 'App', value: 'app' },
					{ name: 'Disk Usage', value: 'diskUsage' },
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'getAll',
				displayOptions: { show: { resource: ['app'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List the apps installed on the instance',
						action: 'Get many apps',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'get',
				displayOptions: { show: { resource: ['diskUsage'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'Get the bytes used and the quota of the instance',
						action: 'Get disk usage',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const instanceUrl = instanceUrlOf(await this.getCredentials(CREDENTIAL_TYPE));
		const out: INodeExecutionData[] = [];

		for (const [itemIndex] of this.getInputData().entries()) {
			try {
				const isApp = this.getNodeParameter('resource', itemIndex) === 'app';
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					CREDENTIAL_TYPE,
					{
						method: 'GET',
						url: `${instanceUrl}${isApp ? '/apps/' : '/settings/disk-usage'}`,
						headers: { Accept: 'application/vnd.api+json' },
						json: true,
					},
					{
						oauth2: {
							// The token signing this request comes from the stack, n8n can't refresh it
							skipTokenRefresh: true,
						},
					},
				)) as IDataObject;
				// One item per app: the first page holds 100 apps, more than an instance has
				const items = isApp ? ((response.data as IDataObject[] | undefined) ?? []) : [response];
				for (const json of items) {
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
