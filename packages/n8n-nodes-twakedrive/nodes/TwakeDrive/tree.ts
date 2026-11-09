import type { INodeListSearchItems, INodeListSearchResult } from 'n8n-workflow';

export const ROOT_DIR_ID = 'io.cozy.files.root-dir';
const TRASH_DIR_ID = 'io.cozy.files.trash-dir';

const PAGE_SIZE = 50;
// A search matching little scans at most this many folders per page, then waits for a scroll.
const MAX_FOLDERS_PER_PAGE = 100;

export type TreeEntry = { id: string; attributes: { name: string; type: string } };

type PendingFolder = { id: string; path: string };

/** Walks the Drive breadth first, the pagination token being the folders still to visit. */
export async function walkTree(
	listFolder: (id: string) => Promise<TreeEntry[]>,
	type: 'file' | 'directory',
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const needle = filter?.toLowerCase() ?? '';
	const matches = (path: string): boolean => path.toLowerCase().includes(needle);
	const pending = paginationToken
		? (JSON.parse(paginationToken) as PendingFolder[])
		: [{ id: ROOT_DIR_ID, path: '' }];
	const results: INodeListSearchItems[] =
		!paginationToken && type === 'directory' && matches('/')
			? [{ name: '/', value: ROOT_DIR_ID }]
			: [];

	for (
		let visited = 0;
		pending.length && results.length < PAGE_SIZE && visited < MAX_FOLDERS_PER_PAGE;
		visited++
	) {
		const folder = pending.shift() as PendingFolder;
		const entries = (await listFolder(folder.id)).sort((a, b) =>
			a.attributes.name.localeCompare(b.attributes.name, undefined, { sensitivity: 'base' }),
		);
		for (const { id, attributes } of entries) {
			if (id === TRASH_DIR_ID) continue;
			const path = `${folder.path}/${attributes.name}`;
			if (attributes.type === 'directory') pending.push({ id, path });
			if (attributes.type === type && matches(path)) results.push({ name: path, value: id });
		}
	}

	return { results, paginationToken: pending.length ? JSON.stringify(pending) : undefined };
}
