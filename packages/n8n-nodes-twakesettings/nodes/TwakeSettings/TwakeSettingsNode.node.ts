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

const CREDENTIAL_TYPE = 'twakeSettingsOAuth2Api';

export class TwakeSettingsNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Settings',
		name: 'twakeSettingsNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Read the settings of a Twake instance',
		defaults: { name: 'Twake Settings' },
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
				default: 'diskUsage',
				options: [{ name: 'Disk Usage', value: 'diskUsage' }],
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
				const json = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					CREDENTIAL_TYPE,
					{
						method: 'GET',
						url: `${instanceUrl}/settings/disk-usage`,
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
				out.push({ json, pairedItem: { item: itemIndex } });
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
