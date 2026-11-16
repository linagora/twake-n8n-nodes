import type { ICredentialDataDecryptedObject, IDataObject, IHttpRequestHelper } from 'n8n-workflow';

interface SsoTokenData extends IDataObject {
	refresh_token?: string;
	id_token?: string;
}

// One Matrix device per user for n8n: a new login replaces the token of that device instead of
// adding a device. Two n8n processes or credentials of one user therefore replace each other's token,
// and each recovers on its next 401 with one more login.
const DEVICE_ID = 'N8N';

// Per process, keyed by refresh token. The cached token stays while n8n holds the same id_token:
// n8n refreshes the SSO login on a 401, which changes it, so a revoked Matrix token leads to a new login.
const cache = new Map<string, { idToken: string; accessToken: string }>();

// A credential has no node to build a NodeApiError with.
function refusal(message: string, cause: unknown): Error {
	return new Error(message, { cause });
}

export function clearMatrixTokenCache(): void {
	cache.clear();
}

/**
 * Swaps the SSO tokens n8n holds for a Matrix access token, through Synapse's JWT login with the
 * SSO id_token. n8n doesn't save what this returns, so it has to work from the stored refresh token.
 */
export async function loginToMatrix(
	this: IHttpRequestHelper,
	credentials: ICredentialDataDecryptedObject,
): Promise<IDataObject> {
	const tokenData = credentials.oauthTokenData as SsoTokenData | undefined;
	const refreshToken = tokenData?.refresh_token;
	if (!refreshToken) {
		throw new Error('This credential has no refresh token, connect it again');
	}

	const idToken = tokenData.id_token ?? '';
	const cached = cache.get(refreshToken);
	if (cached?.idToken === idToken) {
		return { oauthTokenData: { ...tokenData, access_token: cached.accessToken } };
	}

	// Synapse rejects an expired id_token, and refreshing is the only way to get a new one.
	let refreshed: { id_token?: string };
	try {
		refreshed = (await this.helpers.httpRequest({
			method: 'POST',
			url: credentials.accessTokenUrl as string,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: credentials.clientId as string,
				client_secret: credentials.clientSecret as string,
			}).toString(),
			json: true,
		})) as { id_token?: string };
	} catch (error: unknown) {
		throw refusal(
			'The SSO refused to refresh this credential, it may be revoked. Connect it again',
			error,
		);
	}
	if (!refreshed.id_token) {
		throw new Error('The SSO did not return an id_token when refreshing this credential');
	}

	const homeserverUrl = String(credentials.apiUrl).replace(/\/+$/, '');
	let login: { access_token?: string };
	try {
		login = (await this.helpers.httpRequest({
			method: 'POST',
			url: `${homeserverUrl}/_matrix/client/v3/login`,
			body: {
				type: 'org.matrix.login.jwt',
				token: refreshed.id_token,
				device_id: DEVICE_ID,
				initial_device_display_name: 'n8n',
			},
			json: true,
		})) as { access_token?: string };
	} catch (error: unknown) {
		// Matrix answers { errcode, error }, which says why, such as an audience the JWT login refuses
		const reason = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
		throw refusal(
			`The homeserver refused the SSO login${reason ? ` (${reason})` : ''}. Check the homeserver URL, and that its JWT login accepts this SSO client`,
			error,
		);
	}
	if (!login.access_token) {
		throw new Error('The homeserver did not return an access token');
	}

	cache.set(refreshToken, { idToken, accessToken: login.access_token });
	return { oauthTokenData: { ...tokenData, access_token: login.access_token } };
}
