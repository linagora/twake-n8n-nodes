import type { INodeProperties } from 'n8n-workflow';

import { destinationLocator, fileLocator } from './locators';

export const fileProps: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'copyFile',
		displayOptions: { show: { resource: ['file'] } },
		options: [
			{
				name: 'Copy',
				value: 'copyFile',
				description: 'Copy a file into another folder',
				action: 'Copy file',
			},
			{
				name: 'Create From Text',
				value: 'createFileFromText',
				description: 'Create a text file with provided content',
				action: 'Create file from text',
			},
			{
				name: 'Delete',
				value: 'deleteFile',
				description: 'Move a file to the trash',
				action: 'Delete file',
			},
			{
				name: 'Get Edit Link',
				value: 'getEditLink',
				description: 'Get a link to edit an office document in OnlyOffice',
				action: 'Get edit link of file',
			},
			{
				name: 'Move',
				value: 'moveFile',
				description: 'Move a file to another folder',
				action: 'Move file',
			},
			{
				name: 'Rename',
				value: 'renameFile',
				description: 'Give a file a new name',
				action: 'Rename file',
			},
			{
				name: 'Update',
				value: 'updateFile',
				description: 'Replace the content of a file',
				action: 'Update file',
			},
			{
				name: 'Upload',
				value: 'uploadFile',
				description: 'Upload a binary of the item as a new file',
				action: 'Upload file',
			},
		],
	},

	fileLocator({
		operation: ['copyFile', 'deleteFile', 'getEditLink', 'moveFile', 'renameFile', 'updateFile'],
	}),
	destinationLocator({ operation: ['copyFile', 'moveFile', 'createFileFromText', 'uploadFile'] }),

	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: '',
		placeholder: 'e.g. data',
		hint: 'Leave empty when the input item carries a single binary',
		displayOptions: { show: { operation: ['uploadFile', 'updateFile'] } },
	},

	// Optional name overrides
	{
		displayName: 'Name of the New File',
		name: 'customName',
		type: 'boolean',
		default: false,
		description: 'Whether to set a custom name',
		displayOptions: {
			show: {
				operation: ['copyFile', 'updateFile'],
			},
		},
	},

	{
		displayName: 'New Name',
		name: 'newName',
		type: 'string',
		default: '',
		placeholder: 'e.g. myCopy.pdf',
		description: 'New name for the copied file or folder',
		displayOptions: {
			show: {
				operation: ['copyFile', 'updateFile'],
				customName: [true],
			},
		},
	},

	{
		displayName: 'New Name',
		name: 'newName',
		type: 'string',
		default: '',
		placeholder: 'e.g. myNewFile.txt',
		description: 'New name for the created file',
		displayOptions: {
			show: {
				operation: ['createFileFromText', 'renameFile'],
			},
		},
	},

	// Text content and overwrite
	{
		displayName: 'Text',
		name: 'textContent',
		type: 'string',
		default: '',
		description: 'Text content of the new file',
		typeOptions: { rows: 5 },
		displayOptions: { show: { operation: ['createFileFromText'] } },
	},

	{
		displayName: 'Overwrite if Exists',
		name: 'overwriteIfExists',
		type: 'boolean',
		default: false,
		description: 'Whether to overwrite a file with the same name in the destination folder',
		displayOptions: {
			show: { operation: ['uploadFile', 'createFileFromText'] },
		},
	},

	{
		displayName: 'Save as io.cozy.notes',
		name: 'saveAsNote',
		type: 'boolean',
		default: false,
		description: 'Whether to create a note written in Markdown instead of a plain text file',
		displayOptions: {
			show: { operation: ['createFileFromText'] },
		},
	},
];
