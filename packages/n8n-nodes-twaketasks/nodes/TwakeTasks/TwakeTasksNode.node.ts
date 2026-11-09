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

const CREDENTIAL_TYPE = 'twakeTasksOAuth2Api';

export class TwakeTasksNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Tasks',
		name: 'twakeTasksNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Read the projects of a Twake user',
		defaults: { name: 'Twake Tasks' },
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
				default: 'project',
				options: [{ name: 'Project', value: 'project' }],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'getAll',
				displayOptions: { show: { resource: ['project'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List the projects the connected user is a member of',
						action: 'Get many projects',
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
				const { projects } = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					CREDENTIAL_TYPE,
					{
						method: 'GET',
						url: `${baseUrl}/api/projects`,
						headers: { Accept: 'application/json' },
						json: true,
					},
				)) as { projects?: IDataObject[] };
				for (const json of projects ?? []) {
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
