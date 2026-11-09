import type { ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';

import { driveRequest, listDirectory } from './api';
import { walkTree } from './tree';

type Search = (
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
) => Promise<INodeListSearchResult>;

function treeSearch(type: 'file' | 'directory'): Search {
	return async function (filter, paginationToken) {
		return await walkTree((id) => listDirectory.call(this, id), type, filter, paginationToken);
	};
}

const searchShares: Search = async function (filter) {
	const needle = filter?.toLowerCase() ?? '';
	const results: INodeListSearchResult['results'] = [];
	let url: string | undefined = '/permissions/doctype/io.cozy.files/shared-by-link';
	while (url) {
		const page = (await driveRequest.call(this, { method: 'GET', url })) as {
			data?: Array<{ id: string; attributes?: { shortcodes?: Record<string, string> } }>;
			links?: { next?: string };
		};
		for (const { id, attributes } of page.data ?? []) {
			const labels = Object.keys(attributes?.shortcodes ?? {}).sort();
			const name = labels.length ? `${labels.join(', ')} · ${id}` : id;
			if (name.toLowerCase().includes(needle)) results.push({ name, value: id });
		}
		url = page.links?.next;
	}
	return { results };
};

export const listSearch = {
	searchFiles: treeSearch('file'),
	searchFolders: treeSearch('directory'),
	searchShares,
};
