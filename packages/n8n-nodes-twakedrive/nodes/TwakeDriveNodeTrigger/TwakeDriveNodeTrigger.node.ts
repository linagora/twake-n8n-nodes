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

import { driveRequest } from '../TwakeDrive/api';
import { listSearch } from '../TwakeDrive/listSearch';
import { folderLocator } from '../TwakeDrive/properties/locators';
import {
	handleCall,
	settingsError,
	subscribe,
	subscriptionExists,
	unsubscribe,
	type Delivery,
	type Request,
	type Settings,
	type State,
	type Watch,
} from './trigger';

const CREDENTIAL_TYPE = 'twakeDriveOAuth2Api';

type Context = IHookFunctions | IWebhookFunctions;

const statusOf = (error: unknown) =>
	Number((error as { httpCode?: string }).httpCode ?? (error as { status?: number }).status);

interface CachedToken {
	accessToken: string;
	expiresAt: number;
}

// The credential swaps the SSO token for a stack token on each request, so the token the gateway
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

/** Calls your Twake instance, with the stack token of the credential. */
function instanceOf(context: IWebhookFunctions): Request {
	return async (options, tolerated = []) => {
		try {
			return await driveRequest.call(context, options);
		} catch (error) {
			if (tolerated.includes(statusOf(error))) return null;
			throw new NodeApiError(context.getNode(), error as JsonObject);
		}
	};
}

function settingsOf(context: Context): Settings {
	const watch = context.getNodeParameter('watch', 'anyFile') as Watch;
	return {
		events: context.getNodeParameter('events') as string[],
		watch,
		folderId:
			watch === 'folder'
				? (context.getNodeParameter('sourceFolder', '', { extractValue: true }) as string)
				: '',
		subfolders: watch === 'folder' && (context.getNodeParameter('subfolders', false) as boolean),
		includeFile: context.getNodeParameter('includeFile', true) as boolean,
	};
}

const stateOf = (context: Context) => context.getWorkflowStaticData('node') as State;

export class TwakeDriveNodeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Drive Trigger',
		// The action node's name plus Trigger, so that n8n shows both under one app (D18).
		name: 'twakeDriveNodeTrigger',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when a file is added to your Twake Drive',
		defaults: { name: 'Twake Drive Trigger' },
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
						name: 'File Created',
						value: 'created',
						description:
							'A file is added to your drive, by you or through one of your sharing links',
					},
				],
			},
			{
				displayName: 'Watch',
				name: 'watch',
				type: 'options',
				default: 'anyFile',
				options: [
					{ name: 'Any File', value: 'anyFile' },
					{ name: 'Inside a Folder', value: 'folder' },
				],
			},
			folderLocator({ watch: ['folder'] }),
			{
				displayName: 'Watch Subfolders',
				name: 'subfolders',
				type: 'boolean',
				default: false,
				description:
					'Whether a file added to a subfolder of the folder, at any depth, starts the workflow too',
				displayOptions: { show: { watch: ['folder'] } },
			},
			{
				displayName: 'Include File',
				name: 'includeFile',
				type: 'boolean',
				default: true,
				description:
					'Whether to read the file from your drive and output it as `file`, null when you cannot see it anymore',
			},
		],
	};

	methods = { listSearch: { searchFolders: listSearch.searchFolders } };

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
		const outcome = await handleCall(stateOf(this), settingsOf(this), call, instanceOf(this));
		if (outcome.action === 'refuse') {
			this.getResponseObject().status(401).json({ error: 'invalid_signature' });
			return { noWebhookResponse: true };
		}
		if (outcome.action === 'ignore') return {};
		return { workflowData: [[{ json: outcome.json }]] };
	}
}
