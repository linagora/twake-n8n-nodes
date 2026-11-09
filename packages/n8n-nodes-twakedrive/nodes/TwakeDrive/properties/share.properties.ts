import type { INodeProperties } from 'n8n-workflow';

import { fileLocator, folderLocator, shareLocator } from './locators';

export const shareProps: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		default: 'shareByLink',
		displayOptions: { show: { resource: ['share'] } },
		options: [
			{
				name: 'Delete',
				value: 'deleteShare',
				description: 'Remove a share link',
				action: 'Delete share',
			},
			{
				name: 'Create',
				value: 'shareByLink',
				description: 'Create a share link for a file or a folder',
				action: 'Create share',
			},
		],
	},

	{
		displayName: 'Target Type',
		name: 'shareTargetType',
		type: 'options',
		default: 'folder',
		options: [
			{ name: 'Folder', value: 'folder' },
			{ name: 'File', value: 'file' },
		],
		displayOptions: { show: { operation: ['shareByLink'] } },
		description: 'Choose whether to share a file or a folder',
	},

	folderLocator({ operation: ['shareByLink'], shareTargetType: ['folder'] }),
	fileLocator({ operation: ['shareByLink'], shareTargetType: ['file'] }),
	shareLocator({ operation: ['deleteShare'] }),

	{
		displayName: 'Access Level',
		name: 'accessLevel',
		type: 'options',
		default: 'read',
		options: [
			{ name: 'Read-Only', value: 'read' },
			{ name: 'Can Edit', value: 'write' },
		],
		displayOptions: { show: { operation: ['shareByLink'] } },
	},

	{
		displayName: 'Use Expiry',
		name: 'useTtl',
		type: 'boolean',
		default: false,
		description: 'Whether to set an expiry for the share',
		displayOptions: { show: { operation: ['shareByLink'] } },
	},

	{
		displayName: 'Expiry (Duration)',
		name: 'expiryDuration',
		type: 'fixedCollection',
		default: {},
		typeOptions: { multipleValues: false },
		displayOptions: { show: { operation: ['shareByLink'], useTtl: [true] } },
		options: [
			{
				displayName: 'Duration',
				name: 'duration',
				values: [
					{
						displayName: 'Amount',
						name: 'amount',
						type: 'number',
						default: 1,
						typeOptions: { minValue: 1 },
					},
					{
						displayName: 'Unit',
						name: 'unit',
						type: 'options',
						default: 's',
						options: [
							{ name: 'Days', value: 'D' },
							{ name: 'Hours', value: 'h' },
							{ name: 'Minutes', value: 'm' },
							{ name: 'Months', value: 'M' },
							{ name: 'Seconds', value: 's' },
							{ name: 'Years', value: 'Y' },
						],
					},
				],
			},
		],
	},

	{
		displayName: 'Protect with Password',
		name: 'usePassword',
		type: 'boolean',
		default: false,
		description: 'Whether to protect the share with a password',
		displayOptions: { show: { operation: ['shareByLink'] } },
	},

	{
		displayName: 'Password',
		name: 'sharePassword',
		type: 'string',
		typeOptions: { password: true },
		default: '',
		displayOptions: { show: { operation: ['shareByLink'], usePassword: [true] } },
	},
];
