import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INode,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import { taskProperties } from './taskProperties';
import {
	addComment,
	addReminder,
	apiErrorCode,
	completeTask,
	createTask,
	getBoard,
	listBoards,
	moveTask,
	removeReminder,
	setAssignees,
	setLabels,
	simpleAction,
	simpleActions,
	transferTask,
	updateTask,
	type Completion,
	type Request,
	type TaskFields,
} from './tasks';

const CREDENTIAL_TYPE = 'twakeTasksOAuth2Api';

async function caller(context: IExecuteFunctions | ILoadOptionsFunctions): Promise<Request> {
	const { apiUrl } = await context.getCredentials<{ apiUrl: string }>(CREDENTIAL_TYPE);
	const baseUrl = apiUrl.replace(/\/+$/, '');
	return async (options) =>
		await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL_TYPE, {
			json: true,
			...options,
			url: `${baseUrl}${options.url}`,
		});
}

async function sectionOptions(
	context: ILoadOptionsFunctions,
	parameter: string,
): Promise<INodePropertyOptions[]> {
	const boardId = context.getCurrentNodeParameter(parameter) as string;
	if (!boardId) return [];
	const { sections } = await getBoard(await caller(context), boardId);
	return [
		{ name: 'No Section', value: '' },
		...sections.map(({ id, name }) => ({ name, value: id })),
	];
}

async function boardOf(context: ILoadOptionsFunctions) {
	const boardId = context.getCurrentNodeParameter('boardId') as string;
	return boardId ? await getBoard(await caller(context), boardId) : null;
}

/** An API error carries the backend's code, any other error is the node's own, such as a missing section. */
function nodeError(node: INode, error: unknown, itemIndex: number) {
	if (error instanceof NodeOperationError) return error;
	if (!(error as { httpCode?: string }).httpCode) {
		return new NodeOperationError(node, error as Error, { itemIndex });
	}
	const code = apiErrorCode(error);
	return new NodeApiError(node, error as JsonObject, {
		itemIndex,
		...(code ? { message: `Twake Tasks refused the request: ${code}` } : {}),
	});
}

export class TwakeTasksNode implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Twake Tasks',
		name: 'twakeTasksNode',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		icon: { light: 'file:icon.svg', dark: 'file:icon.svg' },
		description: 'Read the projects and manage the tasks of a Twake user',
		defaults: { name: 'Twake Tasks' },
		credentials: [{ name: CREDENTIAL_TYPE, required: true }],
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'project',
				options: [
					{ name: 'Project', value: 'project' },
					{ name: 'Task', value: 'task' },
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'getAll',
				displayOptions: { show: { resource: ['project'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List the projects the connected user is a member of',
						action: 'Get many projects',
					},
				],
			},
			...taskProperties,
		],
	};

	methods = {
		loadOptions: {
			async getBoards(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return (await listBoards(await caller(this)))
					.filter((board) => !board.archived)
					.map((board) => ({ name: String(board.name), value: String(board.id) }));
			},
			async getSections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await sectionOptions(this, 'boardId');
			},
			async getTargetSections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return await sectionOptions(this, 'targetBoardId');
			},
			async getMembers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return ((await boardOf(this))?.members ?? []).map(({ userId, name, email }) => ({
					name: name || email,
					value: userId,
				}));
			},
			async getLabels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return ((await boardOf(this))?.labels ?? []).map(({ id, name }) => ({
					name,
					value: id,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const call = await caller(this);
		const timeZone = this.getTimezone();
		const out: INodeExecutionData[] = [];

		for (const [itemIndex] of this.getInputData().entries()) {
			const pairedItem = { item: itemIndex };
			try {
				const param = (name: string) => this.getNodeParameter(name, itemIndex);
				if (param('resource') === 'project') {
					const { projects } = (await call({ method: 'GET', url: '/api/projects' })) as {
						projects?: IDataObject[];
					};
					for (const json of projects ?? []) out.push({ json, pairedItem });
					continue;
				}

				const operation = param('operation') as string;
				const boardId = param('boardId') as string;
				const taskId = operation === 'create' ? '' : (param('taskId') as string);
				let json: IDataObject;
				if (operation === 'create') {
					const { parentId = '', ...fields } = param('additionalFields') as TaskFields & {
						parentId?: string;
					};
					json = await createTask(
						call,
						boardId,
						param('title') as string,
						param('sectionId') as string,
						parentId,
						fields,
					);
				} else if (operation === 'update') {
					json = await updateTask(call, boardId, taskId, param('updateFields') as TaskFields);
				} else if (operation === 'assign') {
					json = await setAssignees(call, boardId, taskId, param('userIds') as string[]);
				} else if (operation === 'setLabels') {
					json = await setLabels(call, boardId, taskId, param('labelIds') as string[]);
				} else if (operation === 'move') {
					json = await moveTask(
						call,
						boardId,
						taskId,
						param('sectionId') as string,
						param('moveOptions') as IDataObject,
					);
				} else if (operation === 'complete') {
					json = await completeTask(call, boardId, taskId, param('state') as Completion);
				} else if (operation === 'comment') {
					json = await addComment(call, boardId, taskId, param('body') as string);
				} else if (operation === 'transfer') {
					json = await transferTask(
						call,
						boardId,
						taskId,
						param('targetBoardId') as string,
						param('targetSectionId') as string,
					);
				} else if (operation === 'addReminder') {
					const reminder =
						param('remind') === 'at'
							? { at: String(param('at')) }
							: { beforeMinutes: param('beforeMinutes') as number };
					json = await addReminder(call, boardId, taskId, reminder, timeZone);
				} else if (operation === 'removeReminder') {
					json = await removeReminder(call, boardId, taskId, param('reminderId') as string);
				} else if (operation in simpleActions) {
					json = await simpleAction(call, boardId, taskId, operation as keyof typeof simpleActions);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
						itemIndex,
					});
				}
				out.push({ json, pairedItem });
			} catch (error) {
				const failure = nodeError(this.getNode(), error, itemIndex);
				if (!this.continueOnFail()) throw failure;
				out.push({ json: { error: failure.message }, pairedItem });
			}
		}

		return [out];
	}
}
