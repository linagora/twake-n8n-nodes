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

const CREDENTIAL_TYPE = 'twakeMailOAuth2Api';

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
				options: [{ name: 'Session', value: 'session' }],
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const { apiUrl } = await this.getCredentials<{ apiUrl: string }>(CREDENTIAL_TYPE);
		const baseUrl = apiUrl.replace(/\/+$/, '');
		const out: INodeExecutionData[] = [];

		for (const [itemIndex] of this.getInputData().entries()) {
			try {
				const json = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, {
					method: 'GET',
					url: `${baseUrl}/jmap/session`,
					headers: { Accept: 'application/json;jmapVersion=rfc-8621' },
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
