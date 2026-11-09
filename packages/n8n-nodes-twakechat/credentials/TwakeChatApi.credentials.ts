import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class TwakeChatApi implements ICredentialType {
	displayName = 'Twake Chat API';

	name = 'twakeChatApi';

	documentationUrl =
		'https://github.com/linagora/twake-n8n-nodes/tree/main/packages/n8n-nodes-twakechat#credentials';

	icon: Icon = {
		light: 'file:../nodes/TwakeChat/icon.svg',
		dark: 'file:../nodes/TwakeChat/icon.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Homeserver URL',
			name: 'homeserverUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'e.g. https://matrix.twake.app',
			hint: 'Base URL of the Matrix homeserver',
		},
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			hint: 'Matrix access token of the account the node acts as',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.accessToken}}' } },
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.homeserverUrl.replace(/\\/+$/, "")}}',
			url: '/_matrix/client/v3/account/whoami',
		},
	};
}
