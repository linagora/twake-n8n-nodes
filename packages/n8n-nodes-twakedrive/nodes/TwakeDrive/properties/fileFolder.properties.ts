import type { INodeProperties } from 'n8n-workflow';

import { fileLocator, folderLocator } from './locators';

export const fileFolderProps: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'getFileFolder',
		displayOptions: { show: { resource: ['fileFolder'] } },
		options: [
			{
				name: 'Get',
				value: 'getFileFolder',
				description: 'List the content of a folder or download a file',
				action: 'Get file or folder',
			},
		],
	},

	{
		displayName: 'Target',
		name: 'targetType',
		type: 'options',
		options: [
			{ name: 'Folder', value: 'folder' },
			{ name: 'File', value: 'file' },
		],
		default: 'folder',
		description: 'Choose whether to list a folder (its contents) or fetch a single file',
		displayOptions: { show: { resource: ['fileFolder'], operation: ['getFileFolder'] } },
	},

	folderLocator(
		{ resource: ['fileFolder'], operation: ['getFileFolder'], targetType: ['folder'] },
		true,
	),
	fileLocator({ resource: ['fileFolder'], operation: ['getFileFolder'], targetType: ['file'] }),
];
