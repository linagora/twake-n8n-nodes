import type { ICredentialDataDecryptedObject, IDataObject, IHttpRequestHelper } from 'n8n-workflow';

interface SsoTokenData extends IDataObject {
	refresh_token?: string;
	id_token?: string;
}

interface CachedToken {
	accessToken: string;
	expiresAt: number;
}

// The stack's access tokens last 7 days, this bounds how long a revoked one keeps being sent.
const CACHE_DURATION_MS = 60 * 60 * 1000;

// Per-process cache, so each queue worker exchanges on its own. Fine at one exchange per hour.
const cache = new Map<string, CachedToken>();

// A credential has no node to build a NodeApiError with.
function refusal(message: string, cause: unknown): Error {
	return new Error(message, { cause });
}

export function clearStackTokenCache(): void {
	cache.clear();
}

// The stack matches this claim of the id_token with the instance, its instance_claim setting
const INSTANCE_CLAIM = 'workplaceFqdn';

function idTokenClaims(idToken: unknown): IDataObject {
	const payload = typeof idToken === 'string' ? idToken.split('.')[1] : undefined;
	if (!payload) {
		return {};
	}
	try {
		return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as IDataObject;
	} catch {
		return {};
	}
}

/**
 * The instance URL filled in the credential, or else the user's instance as the SSO gives it in
 * an id_token. The token's signature isn't checked here, the stack checks it on each exchange.
 */
export function instanceUrlOf(
	credentials: ICredentialDataDecryptedObject,
	idToken?: string,
): string {
	const filled = String(credentials.instanceUrl ?? '').trim();
	const tokenData = credentials.oauthTokenData as SsoTokenData | undefined;
	const claim = idTokenClaims(idToken ?? tokenData?.id_token)[INSTANCE_CLAIM];
	const url = filled || (typeof claim === 'string' ? claim.trim() : '');
	if (!url) {
		throw new Error('The SSO did not give an instance for this login, fill in the instance URL');
	}
	return (/^https?:\/\//.test(url) ? url : `https://${url}`).replace(/\/+$/, '');
}

/**
 * Swaps the SSO tokens n8n holds for a Twake stack token, for each request.
 * n8n doesn't save what this returns, so it has to work from the stored refresh token.
 */
export async function exchangeForStackToken(
	this: IHttpRequestHelper,
	credentials: ICredentialDataDecryptedObject,
): Promise<IDataObject> {
	const tokenData = credentials.oauthTokenData as SsoTokenData | undefined;
	const refreshToken = tokenData?.refresh_token;
	if (!refreshToken) {
		throw new Error('This credential has no refresh token, connect it again');
	}

	const cached = cache.get(refreshToken);
	if (cached && cached.expiresAt > Date.now()) {
		return { oauthTokenData: { ...tokenData, access_token: cached.accessToken } };
	}

	// The stack rejects an expired id_token, and refreshing is the only way to get a new one.
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

	const instanceUrl = instanceUrlOf(credentials, refreshed.id_token);
	let exchanged: { access_token: string };
	try {
		exchanged = (await this.helpers.httpRequest({
			method: 'POST',
			url: `${instanceUrl}/auth/token_exchange`,
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
			body: { id_token: refreshed.id_token, exchange_type: 'app' },
			json: true,
		})) as { access_token: string };
	} catch (error: unknown) {
		throw refusal(
			'The instance refused the token exchange. Check the instance URL, that the n8n app is installed on it, and that this SSO client is mapped to that app in app_token_exchange',
			error,
		);
	}

	cache.set(refreshToken, {
		accessToken: exchanged.access_token,
		expiresAt: Date.now() + CACHE_DURATION_MS,
	});
	return { oauthTokenData: { ...tokenData, access_token: exchanged.access_token } };
}
