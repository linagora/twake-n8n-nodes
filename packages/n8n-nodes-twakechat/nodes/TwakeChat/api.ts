import type { IExecuteFunctions, IWebhookFunctions } from 'n8n-workflow';

import { retryWithNewLogin } from '../../credentials/matrixToken';
import type { Request } from './messages';

export const CREDENTIAL_TYPE = 'twakeChatOAuth2Api';

/** Calls the homeserver with the Matrix token of the credential. */
export async function homeserverOf(
	context: IExecuteFunctions | IWebhookFunctions,
): Promise<Request> {
	const credentials = await context.getCredentials(CREDENTIAL_TYPE);
	const baseUrl = `${String(credentials.apiUrl).replace(/\/+$/, '')}/_matrix`;
	const request: Request = async (options) =>
		await context.helpers.httpRequestWithAuthentication.call(
			context,
			CREDENTIAL_TYPE,
			{ json: true, ...options, url: `${baseUrl}${options.url}` },
			// On a 401, n8n would retry with the stored SSO token, which must not reach the homeserver
			{ oauth2: { skipTokenRefresh: true } },
		);
	return async (options) =>
		await retryWithNewLogin(credentials, async () => await request(options));
}
