import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRequire } from 'node:module';

import type { IHttpRequestOptions } from 'n8n-workflow';

import {
	addComment,
	addReminder,
	completeTask,
	createTask,
	getAgenda,
	getFilteredTasks,
	getMyTasks,
	moveTask,
	refusalMessage,
	removeReminder,
	setAssignees,
	setLabels,
	simpleAction,
	transferTask,
	updateTask,
} from '../packages/n8n-nodes-twakeproject/nodes/TwakeProject/tasks.ts';

const task = '/api/boards/b1/tasks/t1';

function makeCall(responses: unknown[] = []) {
	const calls: IHttpRequestOptions[] = [];
	const call = async (options: IHttpRequestOptions) => {
		calls.push(options);
		return responses.shift();
	};
	return { calls, call };
}

const sent = (calls: IHttpRequestOptions[]) =>
	calls.map(({ method, url, body }) => [method, url, body]);

test('creates a task in no section, then sets its other fields and description', async () => {
	const { calls, call } = makeCall([{ id: 't1', key: 'K-1' }, undefined, { version: 3 }]);
	const output = await createTask(call, 'b1', 'Write', '', '', {
		priority: 2,
		dueDate: '2026-11-20T00:00:00',
		description: '# Hi',
	});
	assert.deepEqual(output, { id: 't1', key: 'K-1' });
	assert.deepEqual(sent(calls), [
		['POST', '/api/boards/b1/tasks', { sectionId: null, title: 'Write' }],
		['PATCH', task, { priority: 2, dueDate: '2026-11-20' }],
		['GET', `${task}/description`, undefined],
		['PUT', `${task}/description`, { markdown: '# Hi', version: 3 }],
	]);
});

test('creates a subtask, without update when there is nothing more', async () => {
	const { calls, call } = makeCall([{ id: 't2' }]);
	await createTask(call, 'b1', 'Sub', 's1', 't1', {});
	assert.deepEqual(sent(calls), [
		['POST', '/api/boards/b1/tasks', { parentId: 't1', title: 'Sub' }],
	]);
});

test('updates with nested fields and clears others', async () => {
	const { calls, call } = makeCall();
	const output = await updateTask(call, 'b1', 't1', {
		title: 'New',
		duration: { value: { amount: 30, unit: 'minutes' } },
		recurrence: { value: { every: 1, unit: 'weeks', fromCompletion: false } },
		dueDate: '',
		dueTime: '',
		clear: ['deadline', 'priority'],
	});
	assert.deepEqual(output, { success: true, taskId: 't1' });
	assert.deepEqual(sent(calls), [
		[
			'PATCH',
			task,
			{
				title: 'New',
				duration: { amount: 30, unit: 'minutes' },
				recurrence: { every: 1, unit: 'weeks', fromCompletion: false },
				deadline: null,
				priority: null,
			},
		],
	]);
});

test('replaces assignees and labels, moves next to a task', async () => {
	const { calls, call } = makeCall();
	await setAssignees(call, 'b1', 't1', ['u1']);
	await setLabels(call, 'b1', 't1', []);
	await moveTask(call, 'b1', 't1', 's2', { afterId: 't0', beforeId: '' });
	assert.deepEqual(sent(calls), [
		['PUT', `${task}/assignees`, { userIds: ['u1'] }],
		['PUT', `${task}/labels`, { labelIds: [] }],
		['POST', `${task}/move`, { sectionId: 's2', afterId: 't0' }],
	]);
});

const board = (sectionId: string | null) => ({
	sections: [
		{ id: 's1', name: 'To do', category: 'unstarted' },
		{ id: 's2', name: 'Done', category: 'completed' },
	],
	labels: [],
	members: [],
	tasks: [{ id: 't1', sectionId }],
});

test('completes a task without section through complete', async () => {
	const { calls, call } = makeCall([board(null)]);
	await completeTask(call, 'b1', 't1', 'open');
	assert.deepEqual(sent(calls)[1], ['POST', `${task}/complete`, { state: null }]);
});

test('completes a task in a section by moving it, and fails without such a section', async () => {
	const { calls, call } = makeCall([board('s1'), undefined, board('s2')]);
	const output = await completeTask(call, 'b1', 't1', 'completed');
	assert.deepEqual(output, { success: true, taskId: 't1' });
	assert.deepEqual(sent(calls)[1], ['POST', `${task}/move`, { sectionId: 's2' }]);
	await assert.rejects(completeTask(call, 'b1', 't1', 'canceled'), /no canceled section/);
});

test('sends no body, and no JSON, to the actions without one', async () => {
	const { calls, call } = makeCall();
	await simpleAction(call, 'b1', 't1', 'follow');
	await simpleAction(call, 'b1', 't1', 'unfollow');
	await simpleAction(call, 'b1', 't1', 'archive');
	await simpleAction(call, 'b1', 't1', 'restore');
	await removeReminder(call, 'b1', 't1', 'r1');
	assert.deepEqual(
		calls.map(({ method, url, body, json }) => [method, url, body, json]),
		[
			['PUT', `${task}/follow`, undefined, false],
			['DELETE', `${task}/follow`, undefined, false],
			['POST', `${task}/archive`, undefined, false],
			['POST', `${task}/restore`, undefined, false],
			['DELETE', `${task}/reminders/r1`, undefined, false],
		],
	);
});

test('comments, transfers and adds reminders', async () => {
	const { calls, call } = makeCall([{ id: 'c1' }, { key: 'O-1' }, { id: 'r1' }, { id: 'r2' }]);
	assert.deepEqual(await addComment(call, 'b1', 't1', 'Hi'), { taskId: 't1', id: 'c1' });
	assert.deepEqual(await transferTask(call, 'b1', 't1', 'b2', ''), { taskId: 't1', key: 'O-1' });
	await addReminder(call, 'b1', 't1', { at: '2026-07-01T09:00:00' }, 'Europe/Paris');
	await addReminder(call, 'b1', 't1', { beforeMinutes: 30 }, 'Europe/Paris');
	assert.deepEqual(sent(calls), [
		['POST', `${task}/comments`, { body: 'Hi' }],
		['POST', `${task}/transfer`, { boardId: 'b2', sectionId: null }],
		['POST', `${task}/reminders`, { at: '2026-07-01T07:00:00.000Z' }],
		['POST', `${task}/reminders`, { beforeMinutes: 30, zone: 'Europe/Paris' }],
	]);
});

// The ESM build of n8n-workflow does not load in node:test, n8n itself loads the CommonJS one.
const { NodeApiError } = createRequire(import.meta.url)('n8n-workflow');

test('finds the code of the backend in an error n8n wrapped', () => {
	const node = {
		id: '1',
		name: 'Tasks',
		type: 't',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};
	const axiosLike = Object.assign(new Error('Request failed with status code 409'), {
		isAxiosError: true,
		response: { status: 409, data: { error: 'stale_neighbours' } },
	});
	assert.equal(
		refusalMessage(new NodeApiError(node, axiosLike)),
		'Twake Project refused the request: stale_neighbours',
	);
	assert.equal(refusalMessage(new Error('socket hang up')), undefined);
});

test('reads the code of an API error, as an object or as text', () => {
	assert.equal(
		refusalMessage({ cause: { response: { data: '{"error":"invalid_section"}' } } }),
		'Twake Project refused the request: invalid_section',
	);
	assert.equal(refusalMessage({ context: { data: 'Bad Gateway' } }), undefined);
});

test('lists my tasks, the agenda and the tasks of a filter, one item per task', async () => {
	const { calls, call } = makeCall([
		{ tasks: [{ id: 't1' }, { id: 't2' }] },
		{ today: '2026-11-12', tasks: [{ id: 't3' }] },
		{ tasks: [] },
	]);
	assert.deepEqual(await getMyTasks(call), [{ id: 't1' }, { id: 't2' }]);
	assert.deepEqual(await getAgenda(call, 'Europe/Paris', 7), [{ id: 't3' }]);
	assert.deepEqual(await getFilteredTasks(call, 'f 1', 'Europe/Paris'), []);
	assert.deepEqual(
		calls.map(({ method, url, qs }) => [method, url, qs]),
		[
			['GET', '/api/my-tasks', undefined],
			['GET', '/api/agenda', { zone: 'Europe/Paris', days: 7 }],
			['GET', '/api/filters/f%201/tasks', { zone: 'Europe/Paris' }],
		],
	);
});
