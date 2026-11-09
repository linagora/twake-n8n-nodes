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

const CREDENTIAL_TYPE = 'twakeHomeOAuth2Api';

export class TwakeHomeNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Home',
		name: 'twakeHomeNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Read the apps of a Twake instance',
		defaults: { name: 'Twake Home' },
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
				options: [{ name: 'App', value: 'app' }],
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const { instanceUrl } = await this.getCredentials<{ instanceUrl: string }>(CREDENTIAL_TYPE);
		const baseUrl = instanceUrl.replace(/\/+$/, '');
		const out: INodeExecutionData[] = [];

		for (const [itemIndex] of this.getInputData().entries()) {
			try {
				// The first page holds 100 apps, more than an instance has
				const { data } = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					CREDENTIAL_TYPE,
					{
						method: 'GET',
						url: `${baseUrl}/apps/`,
						headers: { Accept: 'application/vnd.api+json' },
						json: true,
					},
					{
						oauth2: {
							// The token signing this request comes from the stack, n8n can't refresh it
							skipTokenRefresh: true,
						},
					},
				)) as { data?: IDataObject[] };
				for (const json of data ?? []) {
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
