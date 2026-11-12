import type { IDataObject } from 'n8n-workflow';

type Page = { data?: IDataObject[]; links?: { next?: string } };

/**
 * Reads every page of a list of the stack. `fetchPage` gets the `start_key` of the page to read,
 * taken from the `next` link of the previous one, and nothing for the first page.
 */
export async function listAll(
	fetchPage: (startKey?: string) => Promise<Page>,
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	let startKey: string | undefined;
	do {
		const page = await fetchPage(startKey);
		items.push(...(page.data ?? []));
		startKey = page.links?.next
			? (new URL(page.links.next, 'http://stack').searchParams.get('start_key') ?? undefined)
			: undefined;
	} while (startKey);
	return items;
}
