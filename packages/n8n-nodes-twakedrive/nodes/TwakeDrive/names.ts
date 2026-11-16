import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

/** Sends a request to the stack, `url` being relative to the instance. */
export type Request = (options: IHttpRequestOptions) => Promise<IDataObject>;

/** Keeps the extension of the source file, whatever the extension of the new name. */
export function withExtensionOf(newName: string, sourceName: string): string {
	const dot = sourceName.lastIndexOf('.');
	const extension = dot > 0 ? sourceName.slice(dot) : '';
	return extension ? `${newName.replace(/\.[^./\\]+$/, '')}${extension}` : newName;
}

/** URL of the Drive app of an instance: alice-drive.example.com or drive.alice.example.com. */
export function driveAppUrl(instanceUrl: string, flatSubdomains: boolean): string {
	const url = new URL(instanceUrl);
	const [slug, ...domain] = url.hostname.split('.');
	url.hostname = flatSubdomains
		? [`${slug}-drive`, ...domain].join('.')
		: ['drive', slug, ...domain].join('.');
	return url.origin;
}

/** URL of the Drive app of the instance, which depends on its subdomain layout. */
export async function fetchDriveAppUrl(request: Request, instanceUrl: string): Promise<string> {
	const { data } = await request({ method: 'GET', url: '/settings/capabilities' });
	const { flat_subdomains: flat } = (data as { attributes: { flat_subdomains: boolean } })
		.attributes;
	return driveAppUrl(instanceUrl, flat);
}

/**
 * Link to the OnlyOffice editor of a file in the Drive app, for the logged-in user. The stack
 * answers 404 when the file is not an office document or the instance has no OnlyOffice. For a
 * file shared from another instance, the response names that instance, and the link on the own
 * Drive redirects there.
 */
export async function fetchEditLink(
	request: Request,
	instanceUrl: string,
	fileId: string,
): Promise<{ editUrl: string; response: IDataObject }> {
	const response = await request({
		method: 'GET',
		url: `/office/${encodeURIComponent(fileId)}/open`,
	});
	// The onlyoffice block holds a signed editor config without expiry and a secret download
	// link: keep them out of the executions n8n saves. The Drive editor fetches its own.
	const data = response.data as { attributes?: IDataObject } | undefined;
	const attributes = { ...data?.attributes };
	delete attributes.onlyoffice;
	const appUrl = await fetchDriveAppUrl(request, instanceUrl);
	return {
		editUrl: `${appUrl}/#/onlyoffice/${encodeURIComponent(fileId)}`,
		response: { ...response, data: { ...data, attributes } },
	};
}
