import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

import { loginToMatrix } from './matrixToken';

export class TwakeChatOAuth2Api implements ICredentialType {
	displayName = 'Twake Chat OAuth2 API';

	name = 'twakeChatOAuth2Api';

	documentationUrl =
		'https://github.com/linagora/twake-n8n-nodes/tree/main/packages/n8n-nodes-twakechat#credentials';

	extends = ['oAuth2Api'];

	icon: Icon = {
		light: 'file:../nodes/TwakeChat/icon.svg',
		dark: 'file:../nodes/TwakeChat/icon.svg',
	};

	preAuthentication = loginToMatrix;

	properties: INodeProperties[] = [
		{
			displayName: 'Homeserver URL',
			name: 'apiUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'e.g. https://matrix.twake.app',
			hint: 'Base URL of the Matrix homeserver',
		},
		{
			displayName: 'SSO URL',
			name: 'ssoUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'e.g. https://sign-up.twake.app',
			hint: 'Base URL of the Twake SSO',
		},
		{
			displayName: 'Webhook Gateway URL',
			name: 'gatewayUrl',
			type: 'string',
			default: '',
			placeholder: 'e.g. https://webhooks.twake.app',
			hint: 'Base URL of the Twake webhook gateway, needed by the Twake Chat Trigger only',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: '={{$self["ssoUrl"].replace(/\\/+$/, "")}}/oauth2/authorize',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: '={{$self["ssoUrl"].replace(/\\/+$/, "")}}/oauth2/token',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{ displayName: 'Grant Type', name: 'grantType', type: 'hidden', default: 'authorizationCode' },
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: 'openid profile email offline_access',
		},
		{ displayName: 'Authentication', name: 'authentication', type: 'hidden', default: 'body' },
	];
}
