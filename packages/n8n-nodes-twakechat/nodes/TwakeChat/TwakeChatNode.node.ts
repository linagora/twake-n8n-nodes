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

const CREDENTIAL_TYPE = 'twakeChatApi';

export class TwakeChatNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Chat',
		name: 'twakeChatNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Read the Matrix account of a Twake user',
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
				default: 'account',
				options: [{ name: 'Account', value: 'account' }],
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const { homeserverUrl } = await this.getCredentials<{ homeserverUrl: string }>(CREDENTIAL_TYPE);
		const baseUrl = homeserverUrl.replace(/\/+$/, '');
		const out: INodeExecutionData[] = [];

		for (const [itemIndex] of this.getInputData().entries()) {
			try {
				const json = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, {
					method: 'GET',
					url: `${baseUrl}/_matrix/client/v3/account/whoami`,
					headers: { Accept: 'application/json' },
					json: true,
				})) as IDataObject;
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
