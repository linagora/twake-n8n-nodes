import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { IHttpRequestOptions } from 'n8n-workflow';

import {
	calendarPath,
	createEvent,
	createVideoConference,
	deleteEvent,
	toUtc,
	updateEvent,
	videoConferenceFailure,
} from '../packages/n8n-nodes-twakecalendar/nodes/TwakeCalendar/events.ts';

const user = { id: 'u1', email: 'alice@test' };
const calendar = '/calendars/u1/c1';
const url = '/dav/calendars/u1/c1/ev%201.ics';

function makeCall(responses: unknown[]) {
	const calls: IHttpRequestOptions[] = [];
	const call = async (options: IHttpRequestOptions) => {
		calls.push(options);
		return responses.shift();
	};
	return { calls, call };
}

// The props of the first VEVENT of a jCal body, without the ones that change at each run.
const veventOf = (body: unknown) => {
	const vevent = JSON.parse(body as string)[2].find(([name]: [string]) => name === 'vevent');
	return [vevent[1].filter(([name]: [string]) => name !== 'dtstamp'), vevent[2]];
};

test('creates an event with attendees, a room and an alarm, then reads it back', async () => {
	const { calls, call } = makeCall([undefined, ['vcalendar', [], []]]);
	const output = await createEvent(
		call,
		user,
		calendar,
		{
			title: 'Review',
			start: '2026-11-10T09:00:00',
			end: '2026-11-10T10:00:00+01:00',
			location: 'Paris',
			attendees: 'bob@test, Bob@test,carol@test',
			rooms: 'room@test',
			alarms: { alarm: [{ minutesBefore: 10, type: 'EMAIL' }] },
		},
		'Europe/Paris',
		'ev 1',
	);

	assert.equal(calls[0].method, 'PUT');
	assert.equal(calls[0].url, url);
	assert.equal(calls[0].headers?.['Content-Type'], 'text/calendar; charset=utf-8');
	const invited = { partstat: 'NEEDS-ACTION', rsvp: 'TRUE', role: 'REQ-PARTICIPANT' };
	assert.deepEqual(veventOf(calls[0].body), [
		[
			['uid', {}, 'text', 'ev 1'],
			['sequence', {}, 'integer', 0],
			['summary', {}, 'text', 'Review'],
			['location', {}, 'text', 'Paris'],
			['dtstart', {}, 'date-time', '2026-11-10T08:00:00Z'],
			['dtend', {}, 'date-time', '2026-11-10T09:00:00Z'],
			['organizer', {}, 'cal-address', 'mailto:alice@test'],
			[
				'attendee',
				{ partstat: 'ACCEPTED', rsvp: 'FALSE', role: 'CHAIR', cutype: 'INDIVIDUAL' },
				'cal-address',
				'mailto:alice@test',
			],
			['attendee', { ...invited, cutype: 'INDIVIDUAL' }, 'cal-address', 'mailto:bob@test'],
			['attendee', { ...invited, cutype: 'INDIVIDUAL' }, 'cal-address', 'mailto:carol@test'],
			['attendee', { ...invited, cutype: 'RESOURCE' }, 'cal-address', 'mailto:room@test'],
		],
		[
			[
				'valarm',
				[
					['trigger', {}, 'duration', '-PT10M'],
					['action', {}, 'text', 'EMAIL'],
					['description', {}, 'text', 'Review'],
					['summary', {}, 'text', 'Review'],
					['attendee', {}, 'cal-address', 'mailto:alice@test'],
				],
				[],
			],
		],
	]);
	assert.deepEqual(calls[1], {
		method: 'GET',
		url,
		headers: { Accept: 'application/calendar+json' },
	});
	assert.deepEqual(output, { uid: 'ev 1', event: ['vcalendar', [], []] });
});

test('creates an all-day event on a single day', async () => {
	const { calls, call } = makeCall([undefined, ['vcalendar', [], []]]);
	await createEvent(
		call,
		user,
		calendar,
		{ title: 'Off', start: '2026-11-10T00:00:00', end: '2026-11-10T00:00:00', allDay: true },
		'UTC',
		'ev 1',
	);
	const [props] = veventOf(calls[0].body);
	assert.deepEqual(
		props.filter(([name]: [string]) => name.startsWith('dt')),
		[
			['dtstart', {}, 'date', '2026-11-10'],
			['dtend', {}, 'date', '2026-11-11'],
		],
	);
});

test('updates the main event, keeping the answers of attendees still invited', async () => {
	const stored = [
		'vcalendar',
		[],
		[
			[
				'vevent',
				[
					['uid', {}, 'text', 'ev 1'],
					['summary', {}, 'text', 'Old'],
					['sequence', {}, 'integer', 2],
					['dtstart', { tzid: 'Europe/Paris' }, 'date-time', '2026-11-10T09:00:00Z'],
					['dtend', { tzid: 'Europe/Paris' }, 'date-time', '2026-11-10T10:00:00Z'],
					['organizer', {}, 'cal-address', 'mailto:alice@test'],
					['attendee', { partstat: 'ACCEPTED' }, 'cal-address', 'mailto:alice@test'],
					['attendee', { partstat: 'ACCEPTED' }, 'cal-address', 'mailto:bob@test'],
					['attendee', { partstat: 'DECLINED' }, 'cal-address', 'mailto:dan@test'],
					['attendee', { cutype: 'RESOURCE' }, 'cal-address', 'mailto:room@test'],
				],
				[['valarm', [['action', {}, 'text', 'DISPLAY']], []]],
			],
			[
				'vevent',
				[
					['uid', {}, 'text', 'ev 1'],
					['recurrence-id', {}, 'date-time', '2026-11-17T08:00:00Z'],
				],
				[],
			],
		],
	];
	const { calls, call } = makeCall([stored, undefined, ['vcalendar', [], []]]);
	await updateEvent(
		call,
		user,
		calendar,
		'ev 1',
		{ title: 'New', end: '2026-11-10T11:30:00', attendees: 'BOB@test, eve@test', alarms: {} },
		'UTC',
	);

	assert.deepEqual(calls[0], {
		method: 'GET',
		url,
		headers: { Accept: 'application/calendar+json' },
	});
	assert.equal(calls[1].method, 'PUT');
	assert.equal(calls[1].url, url);
	const [props, children] = veventOf(calls[1].body);
	assert.deepEqual(props, [
		['uid', {}, 'text', 'ev 1'],
		['organizer', {}, 'cal-address', 'mailto:alice@test'],
		['summary', {}, 'text', 'New'],
		// The stored time was 09:00 in Paris, not in UTC.
		['dtstart', {}, 'date-time', '2026-11-10T08:00:00Z'],
		['dtend', {}, 'date-time', '2026-11-10T11:30:00Z'],
		['attendee', { partstat: 'ACCEPTED' }, 'cal-address', 'mailto:alice@test'],
		['attendee', { cutype: 'RESOURCE' }, 'cal-address', 'mailto:room@test'],
		['attendee', { partstat: 'ACCEPTED' }, 'cal-address', 'mailto:bob@test'],
		[
			'attendee',
			{ partstat: 'NEEDS-ACTION', rsvp: 'TRUE', role: 'REQ-PARTICIPANT', cutype: 'INDIVIDUAL' },
			'cal-address',
			'mailto:eve@test',
		],
		['sequence', {}, 'integer', 3],
	]);
	assert.deepEqual(children, []);
	assert.equal(JSON.parse(calls[1].body as string)[2].length, 2);
});

test('deletes an event', async () => {
	const { calls, call } = makeCall([undefined]);
	assert.deepEqual(await deleteEvent(call, calendar, 'ev 1'), { deleted: true, uid: 'ev 1' });
	assert.deepEqual(calls, [{ method: 'DELETE', url }]);
});

test('reads local times in the time zone of the workflow, across daylight saving', () => {
	assert.equal(
		toUtc('2026-07-01T09:00:00', 'Europe/Paris').toISOString(),
		'2026-07-01T07:00:00.000Z',
	);
	assert.equal(
		toUtc('2026-12-01T09:00:00', 'Europe/Paris').toISOString(),
		'2026-12-01T08:00:00.000Z',
	);
	assert.equal(
		toUtc('2026-12-01T09:00:00-05:00', 'Europe/Paris').toISOString(),
		'2026-12-01T14:00:00.000Z',
	);
	assert.throws(() => toUtc('tomorrow', 'UTC'), /Invalid date/);
});

test('takes a calendar link or the ID of a calendar of the user', () => {
	assert.equal(calendarPath('/calendars/u2/c2.json', 'u1'), '/calendars/u2/c2');
	assert.equal(calendarPath('c1', 'u1'), '/calendars/u1/c1');
});

test('creates a video conference room and returns its URL', async () => {
	const { calls, call } = makeCall([{ url: 'https://meet.test/abc-defg-hij' }]);
	assert.deepEqual(await createVideoConference(call), { url: 'https://meet.test/abc-defg-hij' });
	assert.deepEqual(calls, [{ method: 'POST', url: '/api/videoconference' }]);
});

test('explains the empty 404 and 502 answers of the video conference route', () => {
	assert.match(videoConferenceFailure({ httpCode: '404' }) ?? '', /not enabled/);
	assert.match(videoConferenceFailure({ response: { status: 502 } }) ?? '', /cannot be reached/);
	assert.equal(videoConferenceFailure({ httpCode: '500' }), undefined);
});
