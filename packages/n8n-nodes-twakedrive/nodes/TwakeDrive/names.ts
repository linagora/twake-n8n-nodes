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
