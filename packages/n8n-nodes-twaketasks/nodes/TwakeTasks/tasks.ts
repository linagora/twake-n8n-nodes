import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

/** Sends a request to the Tasks backend, `url` being relative to it. */
export type Request = (options: IHttpRequestOptions) => Promise<unknown>;

export interface Section {
	id: string;
	name: string;
	category: string;
}

export interface Board {
	sections: Section[];
	labels: Array<{ id: string; name: string }>;
	members: Array<{ userId: string; name: string | null; email: string }>;
	tasks: Array<{ id: string; sectionId: string | null }>;
}

export interface TaskFields {
	title?: string;
	priority?: number;
	dueDate?: string;
	dueTime?: string;
	dueZone?: string;
	deadline?: string;
	duration?: { value?: { amount: number; unit: string } };
	recurrence?: { value?: { every: number; unit: string; fromCompletion: boolean } };
	description?: string;
	clear?: string[];
}

export type Completion = 'completed' | 'canceled' | 'open';

const taskUrl = (boardId: string, taskId: string, path = '') =>
	`/api/boards/${encodeURIComponent(boardId)}/tasks/${encodeURIComponent(taskId)}${path}`;

const done = (taskId: string): IDataObject => ({ success: true, taskId });

/** `null` for the "No Section" choice, which is empty. */
const sectionOf = (sectionId: string) => sectionId || null;

const day = (value: unknown) => String(value).slice(0, 10);

export async function listBoards(call: Request): Promise<IDataObject[]> {
	const { boards } = (await call({ method: 'GET', url: '/api/boards' })) as {
		boards?: IDataObject[];
	};
	return boards ?? [];
}

export async function listFilters(call: Request): Promise<IDataObject[]> {
	const { filters } = (await call({ method: 'GET', url: '/api/filters' })) as {
		filters?: IDataObject[];
	};
	return filters ?? [];
}

async function listTasks(call: Request, url: string, qs?: IDataObject): Promise<IDataObject[]> {
	const { tasks } = (await call(qs ? { method: 'GET', url, qs } : { method: 'GET', url })) as {
		tasks?: IDataObject[];
	};
	return tasks ?? [];
}

/** The open tasks assigned to the user, on every board. */
export const getMyTasks = async (call: Request) => await listTasks(call, '/api/my-tasks');

/** The open tasks due before today plus `days` in `timeZone`, late ones included. */
export const getAgenda = async (call: Request, timeZone: string, days: number) =>
	await listTasks(call, '/api/agenda', { zone: timeZone, days });

export const getFilteredTasks = async (call: Request, filterId: string, timeZone: string) =>
	await listTasks(call, `/api/filters/${encodeURIComponent(filterId)}/tasks`, { zone: timeZone });

export async function getBoard(call: Request, boardId: string): Promise<Board> {
	return (await call({
		method: 'GET',
		url: `/api/boards/${encodeURIComponent(boardId)}`,
	})) as Board;
}

/** Sends a body only when there is one: the backend refuses an empty JSON body. */
async function send(
	call: Request,
	method: IHttpRequestOptions['method'],
	url: string,
	body?: IDataObject,
) {
	return await call(body ? { method, url, body } : { method, url, json: false });
}

export async function createTask(
	call: Request,
	boardId: string,
	title: string,
	sectionId: string,
	parentId: string,
	fields: TaskFields,
): Promise<IDataObject> {
	const created = (await send(
		call,
		'POST',
		`/api/boards/${encodeURIComponent(boardId)}/tasks`,
		parentId ? { parentId, title } : { sectionId: sectionOf(sectionId), title },
	)) as IDataObject;
	// Creation only takes a title, the other fields follow as an update.
	await updateTask(call, boardId, created.id as string, fields);
	return created;
}

export async function updateTask(
	call: Request,
	boardId: string,
	taskId: string,
	{ description, clear = [], duration, recurrence, ...fields }: TaskFields,
): Promise<IDataObject> {
	// An empty field is left as it is, Clear Fields empties it.
	const changes: IDataObject = Object.fromEntries(
		Object.entries(fields).filter(([, value]) => value !== '' && value !== undefined),
	);
	if (changes.dueDate) changes.dueDate = day(changes.dueDate);
	if (changes.deadline) changes.deadline = day(changes.deadline);
	if (duration?.value) changes.duration = duration.value;
	if (recurrence?.value) changes.recurrence = recurrence.value;
	for (const field of clear) changes[field] = null;
	if (Object.keys(changes).length > 0) {
		await send(call, 'PATCH', taskUrl(boardId, taskId), changes);
	}
	if (description !== undefined) {
		const { version } = (await call({
			method: 'GET',
			url: taskUrl(boardId, taskId, '/description'),
		})) as { version: number };
		await send(call, 'PUT', taskUrl(boardId, taskId, '/description'), {
			markdown: description,
			version,
		});
	}
	return done(taskId);
}

export async function setAssignees(
	call: Request,
	boardId: string,
	taskId: string,
	userIds: string[],
): Promise<IDataObject> {
	await send(call, 'PUT', taskUrl(boardId, taskId, '/assignees'), { userIds });
	return done(taskId);
}

export async function setLabels(
	call: Request,
	boardId: string,
	taskId: string,
	labelIds: string[],
): Promise<IDataObject> {
	await send(call, 'PUT', taskUrl(boardId, taskId, '/labels'), { labelIds });
	return done(taskId);
}

export async function moveTask(
	call: Request,
	boardId: string,
	taskId: string,
	sectionId: string,
	neighbours: { afterId?: string; beforeId?: string } = {},
): Promise<IDataObject> {
	const body: IDataObject = { sectionId: sectionOf(sectionId) };
	if (neighbours.afterId) body.afterId = neighbours.afterId;
	if (neighbours.beforeId) body.beforeId = neighbours.beforeId;
	await send(call, 'POST', taskUrl(boardId, taskId, '/move'), body);
	return done(taskId);
}

/** The code of the backend's `{ "error": "<code>" }` answer, wherever n8n keeps it. */
function apiErrorCode(error: unknown): string | undefined {
	const { context, cause } = error as {
		context?: { data?: unknown };
		cause?: { response?: { data?: unknown } };
	};
	for (const data of [context?.data, cause?.response?.data]) {
		let body = data;
		if (typeof body === 'string') {
			try {
				body = JSON.parse(body);
			} catch {
				continue;
			}
		}
		const code = (body as { error?: unknown } | undefined)?.error;
		if (typeof code === 'string') return code;
	}
	return undefined;
}

/** The message for a refusal of the backend, undefined for an error without its code. */
export function refusalMessage(error: unknown): string | undefined {
	const code = apiErrorCode(error);
	return code ? `Twake Tasks refused the request: ${code}` : undefined;
}

const DONE_CATEGORIES = ['completed', 'canceled'];

/**
 * A task in a section is completed, canceled or reopened by moving it to a section of that kind.
 * A recurring task completed this way stays where it is, with its next due date.
 */
export async function completeTask(
	call: Request,
	boardId: string,
	taskId: string,
	state: Completion,
): Promise<IDataObject> {
	const board = await getBoard(call, boardId);
	const task = board.tasks.find(({ id }) => id === taskId);
	if (!task) throw new Error(`The task ${taskId} is not on this board`);
	if (task.sectionId === null) {
		await send(call, 'POST', taskUrl(boardId, taskId, '/complete'), {
			state: state === 'open' ? null : state,
		});
		return done(taskId);
	}
	const section = board.sections.find(({ category }) =>
		state === 'open' ? !DONE_CATEGORIES.includes(category) : category === state,
	);
	if (!section) {
		const kind = state === 'open' ? 'open' : state;
		throw new Error(`The board has no ${kind} section to move the task to`);
	}
	return await moveTask(call, boardId, taskId, section.id);
}

export async function addComment(
	call: Request,
	boardId: string,
	taskId: string,
	body: string,
): Promise<IDataObject> {
	const comment = (await send(call, 'POST', taskUrl(boardId, taskId, '/comments'), {
		body,
	})) as IDataObject;
	return { taskId, ...comment };
}

/** Follow, unfollow, archive and restore: one call without a body. */
export const simpleActions = {
	follow: ['PUT', '/follow'],
	unfollow: ['DELETE', '/follow'],
	archive: ['POST', '/archive'],
	restore: ['POST', '/restore'],
} as const;

export async function simpleAction(
	call: Request,
	boardId: string,
	taskId: string,
	action: keyof typeof simpleActions,
): Promise<IDataObject> {
	const [method, path] = simpleActions[action];
	await send(call, method, taskUrl(boardId, taskId, path));
	return done(taskId);
}

export async function transferTask(
	call: Request,
	boardId: string,
	taskId: string,
	targetBoardId: string,
	targetSectionId: string,
): Promise<IDataObject> {
	const result = (await send(call, 'POST', taskUrl(boardId, taskId, '/transfer'), {
		boardId: targetBoardId,
		sectionId: sectionOf(targetSectionId),
	})) as IDataObject;
	return { taskId, ...result };
}

export async function addReminder(
	call: Request,
	boardId: string,
	taskId: string,
	reminder: { at: string } | { beforeMinutes: number },
	timeZone: string,
): Promise<IDataObject> {
	const body =
		'at' in reminder
			? { at: toUtc(reminder.at, timeZone).toISOString() }
			: { beforeMinutes: reminder.beforeMinutes, zone: timeZone };
	const created = (await send(
		call,
		'POST',
		taskUrl(boardId, taskId, '/reminders'),
		body,
	)) as IDataObject;
	return { taskId, ...created };
}

export async function removeReminder(
	call: Request,
	boardId: string,
	taskId: string,
	reminderId: string,
): Promise<IDataObject> {
	await send(
		call,
		'DELETE',
		taskUrl(boardId, taskId, `/reminders/${encodeURIComponent(reminderId)}`),
	);
	return { ...done(taskId), reminderId };
}

function zoneOffset(date: Date, timeZone: string): number {
	const parts: Record<string, number> = {};
	const format = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric',
	});
	for (const { type, value } of format.formatToParts(date)) parts[type] = Number(value);
	const local = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
	return local - Math.floor(date.getTime() / 1000) * 1000;
}

/** A date with an offset is exact, a date without one is a local time of `timeZone`. */
export function toUtc(value: string, timeZone: string): Date {
	const exact = /(z|[+-]\d\d:?\d\d)$/i.test(value);
	const date = new Date(exact || value.includes('T') ? value : `${value}T00:00:00`);
	if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
	if (exact) return date;
	const local = new Date(`${value.includes('T') ? value : `${value}T00:00:00`}Z`);
	const guess = new Date(local.getTime() - zoneOffset(local, timeZone));
	return new Date(local.getTime() - zoneOffset(guess, timeZone));
}
