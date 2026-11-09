import type { INodeProperties } from 'n8n-workflow';

import { destinationLocator, folderLocator } from './locators';

export const folderProps: INodeProperties[] = [
	// Operation — FOLDER
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'createFolder',
		displayOptions: { show: { resource: ['folder'] } },
		options: [
			{
				name: 'Create',
				value: 'createFolder',
				description: 'Create a new folder',
				action: 'Create folder',
			},
			{
				name: 'Delete',
				value: 'deleteFolder',
				description: 'Move a folder to the trash',
				action: 'Delete folder',
			},
			{
				name: 'Move',
				value: 'moveFolder',
				description: 'Move a folder inside another one',
				action: 'Move folder',
			},
			{
				name: 'Rename',
				value: 'renameFolder',
				description: 'Give a folder a new name',
				action: 'Rename folder',
			},
		],
	},

	folderLocator({ operation: ['moveFolder', 'deleteFolder', 'renameFolder'] }),
	destinationLocator({ operation: ['createFolder', 'moveFolder'] }),

	{
		displayName: 'Folder Name',
		name: 'dirName',
		type: 'string',
		default: '',
		placeholder: 'e.g. myNewFolder',
		description: 'Name of the folder to create',
		displayOptions: { show: { operation: ['createFolder'] } },
	},

	{
		displayName: 'New Folder Name',
		name: 'newFolderName',
		type: 'string',
		default: '',
		placeholder: 'e.g. myRenamedFolder',
		description: 'New name for the folder',
		displayOptions: { show: { operation: ['renameFolder'] } },
	},
];
