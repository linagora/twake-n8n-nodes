import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

import { instanceUrlOf } from '../../credentials/stackToken';

export { ROOT_DIR_ID } from './tree';

const CREDENTIAL_TYPE = 'twakeDriveOAuth2Api';
const JSON_API = 'application/vnd.api+json';

export type DriveContext = IExecuteFunctions | ILoadOptionsFunctions;

export type DriveEntry = {
	id: string;
	attributes: { name: string; type: string; dir_id?: string; mime?: string };
};

type DirectoryPage = {
	data: DriveEntry;
	included?: DriveEntry[];
	links?: { next?: string };
};

export async function getInstanceUrl(this: DriveContext): Promise<string> {
	return instanceUrlOf(await this.getCredentials(CREDENTIAL_TYPE));
}

/**
 * Authenticated JSON:API request on the stack, `url` being relative to the instance.
 * The stack answers 400 to an expired token and expects the client credentials in the
 * body of the refresh request.
 */
export async function driveRequest(
	this: DriveContext,
	options: IHttpRequestOptions,
): Promise<IDataObject> {
	const instanceUrl = await getInstanceUrl.call(this);
	return (await this.helpers.httpRequestWithAuthentication.call(
		this,
		CREDENTIAL_TYPE,
		{
			json: true,
			...options,
			url: `${instanceUrl}${options.url}`,
			headers: { Accept: JSON_API, ...options.headers },
		},
		{
			oauth2: {
				// The token signing this request comes from the stack, n8n can't refresh it
				skipTokenRefresh: true,
			},
		},
	)) as IDataObject;
}

export async function fetchEntry(this: DriveContext, id: string): Promise<DriveEntry> {
	const { data } = await driveRequest.call(this, {
		method: 'GET',
		url: `/files/${encodeURIComponent(id)}`,
	});
	return data as DriveEntry;
}

export async function listDirectory(this: DriveContext, dirId: string): Promise<DriveEntry[]> {
	const entries: DriveEntry[] = [];
	let cursor: string | null = null;
	do {
		const page = (await driveRequest.call(this, {
			method: 'GET',
			url: `/files/${encodeURIComponent(dirId)}`,
			qs: { 'page[limit]': 100, ...(cursor ? { 'page[cursor]': cursor } : {}) },
		})) as DirectoryPage;
		entries.push(...(page.included ?? []));
		cursor = page.links?.next
			? new URL(page.links.next, 'http://stack').searchParams.get('page[cursor]')
			: null;
	} while (cursor);
	return entries;
}
