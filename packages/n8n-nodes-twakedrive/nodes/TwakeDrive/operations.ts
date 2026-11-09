import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
} from 'n8n-workflow';

import {
	driveRequest,
	fetchEntry,
	getInstanceUrl,
	listDirectory,
	ROOT_DIR_ID,
	type DriveEntry,
} from './api';
import { driveAppUrl, withExtensionOf } from './names';

type OperationResult = Pick<INodeExecutionData, 'json' | 'binary'>;
type Operation = (this: IExecuteFunctions, itemIndex: number) => Promise<OperationResult>;

const JSON_API = 'application/vnd.api+json';

function stringParameter(context: IExecuteFunctions, name: string, itemIndex: number): string {
	return String(context.getNodeParameter(name, itemIndex, '')).trim();
}

function requireValue(
	context: IExecuteFunctions,
	value: string,
	label: string,
	itemIndex: number,
): string {
	if (!value) {
		throw new NodeOperationError(context.getNode(), `'${label}' is empty, fill it in the node`, {
			itemIndex,
		});
	}
	return value;
}

function locatorValue(context: IExecuteFunctions, name: string, itemIndex: number): string {
	return String(context.getNodeParameter(name, itemIndex, '', { extractValue: true })).trim();
}

function sourceFileId(context: IExecuteFunctions, itemIndex: number): string {
	return requireValue(context, locatorValue(context, 'sourceFile', itemIndex), 'File', itemIndex);
}

function sourceFolderId(context: IExecuteFunctions, itemIndex: number): string {
	const id = requireValue(
		context,
		locatorValue(context, 'sourceFolder', itemIndex),
		'Folder',
		itemIndex,
	);
	if (id === ROOT_DIR_ID) {
		throw new NodeOperationError(
			context.getNode(),
			'The root folder cannot be changed, pick another folder',
			{
				itemIndex,
			},
		);
	}
	return id;
}

function destinationDirId(context: IExecuteFunctions, itemIndex: number): string {
	return locatorValue(context, 'destinationFolder', itemIndex) || ROOT_DIR_ID;
}

async function patchEntry(
	this: IExecuteFunctions,
	id: string,
	attributes: IDataObject,
): Promise<IDataObject> {
	return await driveRequest.call(this, {
		method: 'PATCH',
		url: `/files/${encodeURIComponent(id)}`,
		headers: { 'Content-Type': JSON_API },
		body: { data: { type: 'io.cozy.files', id, attributes } },
	});
}

async function deleteEntry(this: IExecuteFunctions, id: string): Promise<IDataObject> {
	return await driveRequest.call(this, {
		method: 'DELETE',
		url: `/files/${encodeURIComponent(id)}`,
	});
}

/** Creates the file, or replaces the content of `name` in `dirId` when `overwrite` is set. */
async function saveFile(
	this: IExecuteFunctions,
	options: { dirId: string; name: string; mime: string; content: Buffer; overwrite: boolean },
): Promise<IDataObject> {
	const { dirId, name, mime, content, overwrite } = options;
	const headers = { 'Content-Type': mime };

	if (overwrite) {
		const { data } = await driveRequest.call(this, {
			method: 'POST',
			url: '/files/_find',
			headers: { 'Content-Type': 'application/json' },
			body: { selector: { dir_id: dirId, name, type: 'file', trashed: false }, limit: 1 },
		});
		const existing = (data as DriveEntry[] | undefined)?.[0];
		if (existing) {
			return await driveRequest.call(this, {
				method: 'PUT',
				url: `/files/${encodeURIComponent(existing.id)}`,
				headers,
				body: content,
			});
		}
	}

	return await driveRequest.call(this, {
		method: 'POST',
		url: `/files/${encodeURIComponent(dirId)}`,
		qs: { Type: 'file', Name: name },
		headers,
		body: content,
	});
}

/** The field can be left empty when the item carries a single binary. */
function binaryField(context: IExecuteFunctions, itemIndex: number): string {
	const binary = context.getInputData()[itemIndex].binary ?? {};
	const keys = Object.keys(binary);
	const field = stringParameter(context, 'binaryPropertyName', itemIndex);
	if (field ? !binary[field] : keys.length !== 1) {
		throw new NodeOperationError(
			context.getNode(),
			`Set "Input Binary Field" to one of the binaries of the item: ${keys.join(', ') || 'none'}`,
			{ itemIndex },
		);
	}
	return field || keys[0];
}

// File and folder

const getFileFolder: Operation = async function (itemIndex) {
	if (stringParameter(this, 'targetType', itemIndex) !== 'file') {
		const dirId = locatorValue(this, 'sourceFolder', itemIndex);
		return { json: { data: await listDirectory.call(this, dirId || ROOT_DIR_ID) } };
	}

	const fileId = requireValue(this, locatorValue(this, 'sourceFile', itemIndex), 'File', itemIndex);
	const file = await fetchEntry.call(this, fileId);
	const instanceUrl = await getInstanceUrl.call(this);
	const content = (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'twakeDriveOAuth2Api',
		{
			method: 'GET',
			url: `${instanceUrl}/files/download/${encodeURIComponent(fileId)}`,
			encoding: 'arraybuffer',
		},
		{ oauth2: { skipTokenRefresh: true } },
	)) as Buffer;
	const data = await this.helpers.prepareBinaryData(
		Buffer.from(content),
		file.attributes.name,
		file.attributes.mime,
	);
	return { json: { data: [file] }, binary: { data } };
};

// Files

const uploadFile: Operation = async function (itemIndex) {
	const field = binaryField(this, itemIndex);
	const { fileName, mimeType } = this.getInputData()[itemIndex].binary![field];
	const name = requireValue(this, fileName ?? '', 'Binary file name', itemIndex);
	const json = await saveFile.call(this, {
		dirId: destinationDirId(this, itemIndex),
		name,
		mime: mimeType || 'application/octet-stream',
		// Loads the whole file in memory, stream it if large uploads matter
		content: await this.helpers.getBinaryDataBuffer(itemIndex, field),
		overwrite: this.getNodeParameter('overwriteIfExists', itemIndex, false) as boolean,
	});
	return { json };
};

const updateFile: Operation = async function (itemIndex) {
	const fileId = sourceFileId(this, itemIndex);
	const field = binaryField(this, itemIndex);
	const { mimeType } = this.getInputData()[itemIndex].binary![field];

	let json = await driveRequest.call(this, {
		method: 'PUT',
		url: `/files/${encodeURIComponent(fileId)}`,
		headers: { 'Content-Type': mimeType || 'application/octet-stream' },
		body: await this.helpers.getBinaryDataBuffer(itemIndex, field),
	});

	if (this.getNodeParameter('customName', itemIndex, false)) {
		const { attributes } = await fetchEntry.call(this, fileId);
		const newName = requireValue(
			this,
			stringParameter(this, 'newName', itemIndex),
			'New Name',
			itemIndex,
		);
		const name = withExtensionOf(newName, attributes.name);
		if (name !== attributes.name) json = await patchEntry.call(this, fileId, { name });
	}
	return { json };
};

const copyFile: Operation = async function (itemIndex) {
	const fileId = sourceFileId(this, itemIndex);
	const qs: IDataObject = { DirID: destinationDirId(this, itemIndex) };
	const newName = stringParameter(this, 'newName', itemIndex);
	if (this.getNodeParameter('customName', itemIndex, false) && newName) {
		const { attributes } = await fetchEntry.call(this, fileId);
		qs.Name = withExtensionOf(newName, attributes.name);
	}
	const json = await driveRequest.call(this, {
		method: 'POST',
		url: `/files/${encodeURIComponent(fileId)}/copy`,
		qs,
	});
	return { json };
};

const createFileFromText: Operation = async function (itemIndex) {
	const title = (stringParameter(this, 'newName', itemIndex) || 'untitled').replace(
		/\.[^./\\]+$/,
		'',
	);
	const saveAsNote = this.getNodeParameter('saveAsNote', itemIndex, false) as boolean;
	const json = await saveFile.call(this, {
		dirId: destinationDirId(this, itemIndex),
		// The stack imports the markdown of a .cozy-note upload as a real note
		name: `${title}${saveAsNote ? '.cozy-note' : '.txt'}`,
		mime: 'text/plain; charset=utf-8',
		content: Buffer.from(String(this.getNodeParameter('textContent', itemIndex, '')), 'utf8'),
		overwrite: this.getNodeParameter('overwriteIfExists', itemIndex, false) as boolean,
	});
	return { json };
};

const deleteFile: Operation = async function (itemIndex) {
	await deleteEntry.call(this, sourceFileId(this, itemIndex));
	return { json: { deleted: true } };
};

const moveFile: Operation = async function (itemIndex) {
	const json = await patchEntry.call(this, sourceFileId(this, itemIndex), {
		dir_id: destinationDirId(this, itemIndex),
	});
	return { json };
};

const renameFile: Operation = async function (itemIndex) {
	const fileId = sourceFileId(this, itemIndex);
	const newName = requireValue(
		this,
		stringParameter(this, 'newName', itemIndex),
		'New Name',
		itemIndex,
	);
	const { attributes } = await fetchEntry.call(this, fileId);
	const name = withExtensionOf(newName, attributes.name);
	return { json: await patchEntry.call(this, fileId, { name }) };
};

// Folders

const createFolder: Operation = async function (itemIndex) {
	const json = await driveRequest.call(this, {
		method: 'POST',
		url: `/files/${encodeURIComponent(destinationDirId(this, itemIndex))}`,
		qs: {
			Type: 'directory',
			Name: requireValue(
				this,
				stringParameter(this, 'dirName', itemIndex),
				'Folder Name',
				itemIndex,
			),
		},
	});
	return { json };
};

const deleteFolder: Operation = async function (itemIndex) {
	await deleteEntry.call(this, sourceFolderId(this, itemIndex));
	return { json: { deleted: true } };
};

const moveFolder: Operation = async function (itemIndex) {
	const folderId = sourceFolderId(this, itemIndex);
	const destination = destinationDirId(this, itemIndex);
	if (folderId === destination) {
		throw new NodeOperationError(this.getNode(), 'A folder cannot be moved into itself', {
			itemIndex,
		});
	}
	return { json: await patchEntry.call(this, folderId, { dir_id: destination }) };
};

const renameFolder: Operation = async function (itemIndex) {
	const name = requireValue(
		this,
		stringParameter(this, 'newFolderName', itemIndex),
		'New Folder Name',
		itemIndex,
	);
	return { json: await patchEntry.call(this, sourceFolderId(this, itemIndex), { name }) };
};

// Shares

function shareTargetId(context: IExecuteFunctions, itemIndex: number): string {
	const isFile = stringParameter(context, 'shareTargetType', itemIndex) === 'file';
	const parameter = isFile ? 'sourceFile' : 'sourceFolder';
	// No fallback on the root folder: an empty field must not share the whole Drive
	return requireValue(
		context,
		locatorValue(context, parameter, itemIndex),
		isFile ? 'File' : 'Folder',
		itemIndex,
	);
}

const shareByLink: Operation = async function (itemIndex) {
	const targetId = shareTargetId(this, itemIndex);
	const canEdit = this.getNodeParameter('accessLevel', itemIndex, 'read') === 'write';
	const qs: IDataObject = { codes: 'code' };

	if (this.getNodeParameter('useTtl', itemIndex, false)) {
		const amount = this.getNodeParameter('expiryDuration.duration.amount', itemIndex, 0);
		const unit = this.getNodeParameter('expiryDuration.duration.unit', itemIndex, '');
		if (!amount || !unit) {
			throw new NodeOperationError(this.getNode(), 'Duration amount and unit are required', {
				itemIndex,
			});
		}
		qs.ttl = `${amount}${unit}`;
	}

	const attributes: IDataObject = {
		permissions: {
			files: {
				type: 'io.cozy.files',
				values: [targetId],
				verbs: canEdit ? ['GET', 'POST', 'PATCH', 'DELETE'] : ['GET'],
			},
		},
	};
	if (this.getNodeParameter('usePassword', itemIndex, false)) {
		attributes.password = requireValue(
			this,
			String(this.getNodeParameter('sharePassword', itemIndex, '')),
			'Password',
			itemIndex,
		);
	}

	const response = await driveRequest.call(this, {
		method: 'POST',
		url: '/permissions',
		qs,
		headers: { 'Content-Type': JSON_API },
		body: { data: { type: 'io.cozy.permissions', attributes } },
	});
	const { id, attributes: created } = response.data as {
		id: string;
		attributes: { shortcodes?: Record<string, string> };
	};
	const shortcodes = created.shortcodes ?? {};

	const capabilities = await driveRequest.call(this, {
		method: 'GET',
		url: '/settings/capabilities',
	});
	const { flat_subdomains: flat } = (
		capabilities.data as { attributes: { flat_subdomains: boolean } }
	).attributes;
	const appUrl = driveAppUrl(await getInstanceUrl.call(this), flat);

	const shareUrls = Object.fromEntries(
		Object.entries(shortcodes).map(([label, code]) => [
			label,
			`${appUrl}/public?sharecode=${encodeURIComponent(code)}`,
		]),
	);
	return {
		json: { shareByLink: { targetId, permissionsId: id, shortcodes, shareUrls, response } },
	};
};

const deleteShare: Operation = async function (itemIndex) {
	const raw = requireValue(
		this,
		locatorValue(this, 'permissionsId', itemIndex),
		'Share',
		itemIndex,
	);
	// Workflows saved with n8n-nodes-twakedrive < 1.7 hold a JSON payload instead of the ID
	const permissionsId = raw.startsWith('{') ? String(JSON.parse(raw).id) : raw;
	await driveRequest.call(this, {
		method: 'DELETE',
		url: `/permissions/${encodeURIComponent(permissionsId)}`,
	});
	return { json: { deleted: true } };
};

export const operations: Record<string, Operation> = {
	getFileFolder,
	uploadFile,
	updateFile,
	copyFile,
	createFileFromText,
	deleteFile,
	moveFile,
	renameFile,
	createFolder,
	deleteFolder,
	moveFolder,
	renameFolder,
	shareByLink,
	deleteShare,
};
