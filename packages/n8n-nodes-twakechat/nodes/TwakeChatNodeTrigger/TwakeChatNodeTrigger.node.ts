import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type ICredentialDataDecryptedObject,
	type IDataObject,
	type IHookFunctions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type JsonObject,
} from 'n8n-workflow';

import { CREDENTIAL_TYPE, homeserverOf } from '../TwakeChat/api';
import {
	handleCall,
	settingsError,
	subscribe,
	subscriptionExists,
	unsubscribe,
	type Delivery,
	type Request,
	type SentBy,
	type Settings,
	type State,
} from './trigger';

type Context = IHookFunctions | IWebhookFunctions;

const statusOf = (error: unknown) =>
	Number((error as { httpCode?: string }).httpCode ?? (error as { status?: number }).status);

interface CachedToken {
	accessToken: string;
	expiresAt: number;
}

// The credential swaps the SSO token for a Matrix token on each request, so the token the gateway
// wants is refreshed here, once per refresh token while it lasts.
const ssoTokens = new Map<string, CachedToken>();

async function ssoAccessToken(context: Context, credentials: ICredentialDataDecryptedObject) {
	const refreshToken = (credentials.oauthTokenData as IDataObject | undefined)?.refresh_token;
	if (typeof refreshToken !== 'string') {
		throw new NodeOperationError(
			context.getNode(),
			'This credential has no refresh token, connect it again',
		);
	}
	const cached = ssoTokens.get(refreshToken);
	if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
	let answer: { access_token?: string; expires_in?: number };
	try {
		answer = (await context.helpers.httpRequest({
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
		})) as { access_token?: string; expires_in?: number };
	} catch (error) {
		throw new NodeApiError(context.getNode(), error as JsonObject, {
			message: 'The SSO refused to refresh this credential, it may be revoked. Connect it again',
		});
	}
	if (!answer.access_token) {
		throw new NodeOperationError(context.getNode(), 'The SSO did not return an access token');
	}
	// A minute of margin, so that a token never expires on its way to the gateway.
	const lifetime = Math.max(0, (answer.expires_in ?? 300) - 60) * 1000;
	ssoTokens.set(refreshToken, {
		accessToken: answer.access_token,
		expiresAt: Date.now() + lifetime,
	});
	return answer.access_token;
}

/** Calls the gateway with your SSO token. */
function gatewayOf(context: Context): Request {
	return async (options, tolerated = []) => {
		const credentials = await context.getCredentials(CREDENTIAL_TYPE);
		const url = String(credentials.gatewayUrl ?? '').replace(/\/+$/, '');
		if (!url) {
			throw new NodeOperationError(
				context.getNode(),
				'The credential has no Webhook Gateway URL: ask your n8n admin to set it',
			);
		}
		const token = await ssoAccessToken(context, credentials);
		try {
			return (await context.helpers.httpRequest({
				json: true,
				...options,
				url: `${url}${options.url}`,
				headers: { Authorization: `Bearer ${token}` },
			})) as IDataObject;
		} catch (error) {
			if (tolerated.includes(statusOf(error))) return null;
			throw new NodeApiError(context.getNode(), error as JsonObject);
		}
	};
}

/** Calls the homeserver, with the Matrix token of the credential. */
function matrixOf(context: IWebhookFunctions): Request {
	return async (options, tolerated = []) => {
		try {
			const call = await homeserverOf(context);
			return (await call(options)) as IDataObject;
		} catch (error) {
			if (tolerated.includes(statusOf(error))) return null;
			throw new NodeApiError(context.getNode(), error as JsonObject);
		}
	};
}

function settingsOf(context: Context): Settings {
	return {
		events: context.getNodeParameter('events') as string[],
		sentBy: context.getNodeParameter('sentBy', 'others') as SentBy,
		includeMessage: context.getNodeParameter('includeMessage', true) as boolean,
	};
}

const stateOf = (context: Context) => context.getWorkflowStaticData('node') as State;

export class TwakeChatNodeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Chat Trigger',
		// The action node's name plus Trigger, so that n8n shows both under one app (D18).
		name: 'twakeChatNodeTrigger',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow on a direct message or a mention in Twake Chat',
		defaults: { name: 'Twake Chat Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL_TYPE, required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['created'],
				options: [
					{
						name: 'Direct Message',
						value: 'created',
						description: 'A message is sent in one of your direct conversations',
					},
					{
						name: 'Mention',
						value: 'mentioned',
						description: 'Someone mentions you in a message, in any room',
					},
				],
			},
			{
				displayName: 'Sent By',
				name: 'sentBy',
				type: 'options',
				default: 'others',
				description: 'Whose direct messages start the workflow',
				displayOptions: { show: { events: ['created'] } },
				options: [
					{ name: 'Anyone', value: 'anyone' },
					{ name: 'Me', value: 'me' },
					{ name: 'Others', value: 'others' },
				],
			},
			{
				displayName: 'Include Message',
				name: 'includeMessage',
				type: 'boolean',
				default: true,
				description:
					'Whether to read the message from Twake Chat and output it as `message`, null when you cannot see it anymore',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return subscriptionExists(
					stateOf(this),
					gatewayOf(this),
					this.getNodeWebhookUrl('default') ?? '',
					settingsOf(this),
				);
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const settings = settingsOf(this);
				const error = settingsError(settings);
				if (error) throw new NodeOperationError(this.getNode(), error);
				const webhookUrl = this.getNodeWebhookUrl('default') ?? '';
				await subscribe(stateOf(this), gatewayOf(this), webhookUrl, settings);
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				return unsubscribe(stateOf(this), gatewayOf(this));
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const call = {
			signature: this.getHeaderData()['twake-signature'] as string | undefined,
			rawBody: this.getRequestObject().rawBody,
			delivery: this.getBodyData() as Delivery,
			now: Math.floor(Date.now() / 1000),
		};
		const outcome = await handleCall(stateOf(this), settingsOf(this), call, matrixOf(this));
		if (outcome.action === 'refuse') {
			this.getResponseObject().status(401).json({ error: 'invalid_signature' });
			return { noWebhookResponse: true };
		}
		if (outcome.action === 'ignore') return {};
		return { workflowData: [[{ json: outcome.json }]] };
	}
}
