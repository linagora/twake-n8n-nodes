import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

import { ROOT_DIR_ID } from '../tree';

type Show = NonNullable<IDisplayOptions['show']>;

function locator(
	name: string,
	displayName: string,
	searchListMethod: string,
	placeholder: string,
	show: Show,
	root: boolean,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'resourceLocator',
		default: { mode: 'list', value: root ? ROOT_DIR_ID : '' },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod, searchable: true },
			},
			{ displayName: 'By ID', name: 'id', type: 'string', placeholder },
		],
		displayOptions: { show },
	};
}

export function fileLocator(show: Show): INodeProperties {
	return locator('sourceFile', 'File', 'searchFiles', 'e.g. 3f2a91c07b', show, false);
}

export function folderLocator(show: Show, root = false): INodeProperties {
	return locator('sourceFolder', 'Folder', 'searchFolders', 'e.g. 7c41de02a8', show, root);
}

export function destinationLocator(show: Show): INodeProperties {
	return locator(
		'destinationFolder',
		'Destination Folder',
		'searchFolders',
		'e.g. 7c41de02a8',
		show,
		true,
	);
}

export function shareLocator(show: Show): INodeProperties {
	return locator('permissionsId', 'Share', 'searchShares', 'e.g. 9b07fe13c4', show, false);
}
