import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import { listSearch } from './listSearch';
import { operations } from './operations';
import { fileFolderProps } from './properties/fileFolder.properties';
import { fileProps } from './properties/file.properties';
import { folderProps } from './properties/folder.properties';
import { shareProps } from './properties/share.properties';

export class TwakeDriveNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Drive',
		name: 'twakeDriveNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Manage files, folders and share links in Twake Drive',
		defaults: { name: 'Twake Drive' },
		credentials: [{ name: 'twakeDriveOAuth2Api', required: true }],
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'file',
				options: [
					{ name: 'File', value: 'file' },
					{ name: 'File/Folder', value: 'fileFolder' },
					{ name: 'Folder', value: 'folder' },
					{ name: 'Share', value: 'share' },
				],
			},
			...fileFolderProps,
			...fileProps,
			...folderProps,
			...shareProps,
		],
	};

	methods = { listSearch };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (const [itemIndex, item] of items.entries()) {
			const pairedItem = { item: itemIndex };
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const { json, binary } = await operations[operation].call(this, itemIndex);
				const merged = { ...item.binary, ...binary };
				out.push({ json, pairedItem, ...(Object.keys(merged).length ? { binary: merged } : {}) });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem });
					continue;
				}
				throw error instanceof NodeOperationError
					? error
					: new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
			}
		}

		return [out];
	}
}
