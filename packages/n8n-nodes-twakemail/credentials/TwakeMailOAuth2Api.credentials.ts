import type { Icon, ICredentialType, INodeProperties } from 'n8n-workflow';

export class TwakeMailOAuth2Api implements ICredentialType {
	displayName = 'Twake Mail OAuth2 API';

	name = 'twakeMailOAuth2Api';

	documentationUrl =
		'https://github.com/linagora/twake-n8n-nodes/tree/main/packages/n8n-nodes-twakemail#credentials';

	extends = ['oAuth2Api'];

	icon: Icon = {
		light: 'file:../nodes/TwakeMail/icon.svg',
		dark: 'file:../nodes/TwakeMail/icon.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'JMAP URL',
			name: 'apiUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'e.g. https://jmap.twake.app',
			hint: 'Base URL of the Twake Mail JMAP server',
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
