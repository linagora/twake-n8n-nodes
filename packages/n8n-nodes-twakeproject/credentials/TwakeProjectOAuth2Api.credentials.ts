import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

export class TwakeProjectOAuth2Api implements ICredentialType {
	displayName = 'Twake Project OAuth2 API';

	name = 'twakeProjectOAuth2Api';

	documentationUrl =
		'https://github.com/linagora/twake-n8n-nodes/tree/main/packages/n8n-nodes-twakeproject#credentials';

	extends = ['oAuth2Api'];

	icon: Icon = {
		light: 'file:../nodes/TwakeProject/icon.svg',
		dark: 'file:../nodes/TwakeProject/icon.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'Project URL',
			name: 'apiUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'e.g. https://tasks.twake.app',
			hint: 'Base URL of Twake Project',
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
			hint: 'Base URL of the Twake webhook gateway, needed by the Twake Project Trigger only',
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
		{ displayName: 'Authentication', name: 'authentication', type: 'hidden', default: 'header' },
	];
}
