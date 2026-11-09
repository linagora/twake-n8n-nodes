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

const CREDENTIAL_TYPE = 'twakeContactsOAuth2Api';

interface ContactsUser {
	id?: string;
	_id?: string;
}

interface AddressBookList {
	_embedded?: { 'dav:addressbook'?: IDataObject[] };
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

export class TwakeContactsNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Contacts',
		name: 'twakeContactsNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Read the address books of a Twake user',
		defaults: { name: 'Twake Contacts' },
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
				default: 'addressBook',
				options: [{ name: 'Address Book', value: 'addressBook' }],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'getAll',
				displayOptions: { show: { resource: ['addressBook'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List the address books of the connected user',
						action: 'Get many address books',
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
				const user = await (request<ContactsUser>).call(this, { url: `${baseUrl}/api/user` });
				const userId = user.id ?? user._id;
				if (!userId) {
					throw new NodeOperationError(
						this.getNode(),
						'The contacts service did not return a user ID',
						{ itemIndex },
					);
				}
				const list = await (request<AddressBookList>).call(this, {
					url: `${baseUrl}/dav/addressbooks/${encodeURIComponent(userId)}.json`,
					headers: { Accept: 'application/json' },
					qs: {
						contactsCount: true,
						inviteStatus: 2,
						personal: true,
						shared: true,
						subscribed: true,
					},
				});
				for (const json of list._embedded?.['dav:addressbook'] ?? []) {
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
