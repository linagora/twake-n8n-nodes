import { randomUUID } from 'node:crypto';

import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

/** Sends a request to the calendar side service, `url` being relative to it. */
export type Request = (options: IHttpRequestOptions) => Promise<unknown>;

type Property = [string, IDataObject, string, ...unknown[]];
type Component = [string, Property[], Component[]];

export interface User {
	id: string;
	email: string;
}

export interface EventFields {
	title?: string;
	start?: string;
	end?: string;
	allDay?: boolean;
	description?: string;
	location?: string;
	attendees?: string;
	rooms?: string;
	alarms?: { alarm?: Array<{ minutesBefore: number; type: string }> };
}

const JCAL = { Accept: 'application/calendar+json' };

export async function getUser(call: Request): Promise<User> {
	const user = (await call({ method: 'GET', url: '/api/user' })) as {
		id?: string;
		_id?: string;
		preferredEmail?: string;
		emails?: string[];
	};
	const id = user.id ?? user._id;
	if (!id) throw new Error('The calendar service did not return a user ID');
	return { id, email: user.preferredEmail ?? user.emails?.[0] ?? '' };
}

export async function listCalendars(call: Request, userId: string): Promise<IDataObject[]> {
	const list = (await call({
		method: 'GET',
		url: `/dav/calendars/${encodeURIComponent(userId)}.json`,
		headers: JCAL,
		qs: {
			personal: true,
			sharedDelegationStatus: 'accepted',
			sharedPublicSubscription: true,
			withRights: true,
		},
	})) as { _embedded?: { 'dav:calendar'?: IDataObject[] } };
	return list._embedded?.['dav:calendar'] ?? [];
}

/** The DAV path of a calendar, from its `/calendars/…` link or the ID of one of the user's. */
export function calendarPath(calendar: string, userId: string): string {
	const path = calendar.trim().replace(/\.json$/, '');
	return path.startsWith('/calendars/')
		? path
		: `/calendars/${encodeURIComponent(userId)}/${encodeURIComponent(path)}`;
}

const eventUrl = (calendar: string, uid: string) =>
	`/dav${calendar}/${encodeURIComponent(uid)}.ics`;

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
	const local = new Date(value.includes('T') ? `${value}Z` : `${value}T00:00:00Z`);
	const guess = new Date(local.getTime() - zoneOffset(local, timeZone));
	return new Date(local.getTime() - zoneOffset(guess, timeZone));
}

const utc = (date: Date) => date.toISOString().replace(/\.\d+Z$/, 'Z');

function nextDay(date: string): string {
	const day = new Date(`${date.slice(0, 10)}T00:00:00Z`);
	day.setUTCDate(day.getUTCDate() + 1);
	return day.toISOString().slice(0, 10);
}

function dateProp(name: string, value: string, allDay: boolean, timeZone: string): Property {
	return allDay
		? [name, {}, 'date', value.slice(0, 10)]
		: [name, {}, 'date-time', utc(toUtc(value, timeZone))];
}

function readDate(prop: Property | undefined, timeZone: string): string | undefined {
	if (!prop) return undefined;
	const value = String(prop[3]);
	return prop[2] === 'date' ? value : toUtc(value, String(prop[1].tzid ?? timeZone)).toISOString();
}

/**
 * Sabre writes a DATE-TIME with a TZID as UTC in jCal, adding a "Z" that RFC 5545 forbids. Written
 * back as is, the time changes, so the "Z" is dropped, as the Twake Calendar frontend does.
 */
function dropUtcSuffixOfZonedTimes(component: Component): Component {
	const [name, props, children] = component;
	return [
		name,
		props.map(
			([propName, params, type, ...values]): Property =>
				type === 'date-time' && params.tzid
					? [
							propName,
							params,
							type,
							...values.map((v) => (typeof v === 'string' ? v.replace(/Z$/i, '') : v)),
						]
					: [propName, params, type, ...values],
		),
		(children ?? []).map(dropUtcSuffixOfZonedTimes),
	];
}

const address = (prop: Property) =>
	String(prop[3])
		.replace(/^mailto:/i, '')
		.toLowerCase();
const isRoom = (prop: Property) =>
	['RESOURCE', 'ROOM'].includes(String(prop[1].cutype ?? '').toUpperCase());
const emails = (list?: string) =>
	(list ?? '')
		.split(',')
		.map((email) => email.trim())
		.filter(Boolean);

/** Writes the fields that are set into a VEVENT. A list of attendees or rooms replaces the previous one. */
export function applyFields(
	vevent: Component,
	fields: EventFields,
	user: User,
	timeZone: string,
): void {
	const props = vevent[1];
	const find = (name: string) => props.find((prop) => prop[0] === name);
	const set = (name: string, ...added: Property[]) => {
		for (let i = props.length - 1; i >= 0; i--) if (props[i][0] === name) props.splice(i, 1);
		props.push(...added);
	};
	const text = (name: string, value?: string) => {
		if (value !== undefined) set(name, ...(value ? [[name, {}, 'text', value] as Property] : []));
	};

	text('summary', fields.title);
	text('description', fields.description);
	text('location', fields.location);

	if (fields.start !== undefined || fields.end !== undefined || fields.allDay !== undefined) {
		const allDay = fields.allDay ?? find('dtstart')?.[2] === 'date';
		const start = fields.start || readDate(find('dtstart'), timeZone);
		let end = fields.end || readDate(find('dtend'), timeZone);
		if (!start) throw new Error('The event needs a start');
		if (allDay && (!end || end.slice(0, 10) <= start.slice(0, 10))) end = nextDay(start);
		set('dtstart', dateProp('dtstart', start, allDay, timeZone));
		if (end) {
			set('duration');
			set('dtend', dateProp('dtend', end, allDay, timeZone));
		}
	}

	if ((emails(fields.attendees).length || emails(fields.rooms).length) && !find('organizer')) {
		if (!user.email) throw new Error('The calendar service did not return an email for the user');
		const organizer = `mailto:${user.email}`;
		props.push(['organizer', {}, 'cal-address', organizer]);
		if (
			!props.some((prop) => prop[0] === 'attendee' && address(prop) === user.email.toLowerCase())
		) {
			const chair = { partstat: 'ACCEPTED', rsvp: 'FALSE', role: 'CHAIR', cutype: 'INDIVIDUAL' };
			props.push(['attendee', chair, 'cal-address', organizer]);
		}
	}
	for (const [list, rooms] of [
		[fields.attendees, false],
		[fields.rooms, true],
	] as const) {
		if (list === undefined) continue;
		const organizer = find('organizer');
		const current = props.filter((prop) => prop[0] === 'attendee');
		const kept = current.filter(
			(prop) => isRoom(prop) !== rooms || (organizer && address(prop) === address(organizer)),
		);
		const seen = new Set(kept.map(address));
		const added: Property[] = [];
		for (const email of emails(list)) {
			if (seen.has(email.toLowerCase())) continue;
			seen.add(email.toLowerCase());
			const params = {
				partstat: 'NEEDS-ACTION',
				rsvp: 'TRUE',
				role: 'REQ-PARTICIPANT',
				cutype: rooms ? 'RESOURCE' : 'INDIVIDUAL',
			};
			// An attendee already invited keeps their answer.
			added.push(
				current.find((prop) => address(prop) === email.toLowerCase()) ?? [
					'attendee',
					params,
					'cal-address',
					`mailto:${email}`,
				],
			);
		}
		set('attendee', ...kept, ...added);
	}

	if (fields.alarms !== undefined) {
		const summary = String(find('summary')?.[3] ?? '');
		const alarms = (fields.alarms.alarm ?? []).map(({ minutesBefore, type: action }): Component => {
			const alarm: Property[] = [
				['trigger', {}, 'duration', `-PT${Math.max(0, Math.round(minutesBefore))}M`],
				['action', {}, 'text', action],
				['description', {}, 'text', summary],
			];
			if (action === 'EMAIL') {
				if (!user.email)
					throw new Error('The calendar service did not return an email for the user');
				alarm.push(
					['summary', {}, 'text', summary],
					['attendee', {}, 'cal-address', `mailto:${user.email}`],
				);
			}
			return ['valarm', alarm, []];
		});
		vevent[2] = [...(vevent[2] ?? []).filter(([name]) => name !== 'valarm'), ...alarms];
	}
}

async function save(call: Request, url: string, uid: string, vcalendar: Component) {
	// The Twake Calendar frontend sends jCal with this content type, which the side service accepts.
	await call({
		method: 'PUT',
		url,
		headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
		body: JSON.stringify(vcalendar),
	});
	const event = await call({ method: 'GET', url, headers: JCAL });
	return { uid, event: dropUtcSuffixOfZonedTimes(event as Component) } as IDataObject;
}

export async function createEvent(
	call: Request,
	user: User,
	calendar: string,
	fields: EventFields,
	timeZone: string,
	uid: string = randomUUID(),
): Promise<IDataObject> {
	const vevent: Component = [
		'vevent',
		[
			['uid', {}, 'text', uid],
			['dtstamp', {}, 'date-time', utc(new Date())],
			['sequence', {}, 'integer', 0],
		],
		[],
	];
	applyFields(vevent, fields, user, timeZone);
	const vcalendar: Component = [
		'vcalendar',
		[
			['prodid', {}, 'text', '-//Linagora//Twake n8n nodes//EN'],
			['version', {}, 'text', '2.0'],
		],
		[vevent],
	];
	return await save(call, eventUrl(calendar, uid), uid, vcalendar);
}

/** Updates the event, or the main event of a recurring series, leaving its exceptions as they are. */
export async function updateEvent(
	call: Request,
	user: User,
	calendar: string,
	uid: string,
	fields: EventFields,
	timeZone: string,
): Promise<IDataObject> {
	const url = eventUrl(calendar, uid);
	const vcalendar = dropUtcSuffixOfZonedTimes(
		(await call({ method: 'GET', url, headers: JCAL })) as Component,
	);
	const master = vcalendar[2].find(
		([name, props]) => name === 'vevent' && !props.some(([prop]) => prop === 'recurrence-id'),
	);
	if (!master) throw new Error(`The event ${uid} has no main event to update`);
	applyFields(master, fields, user, timeZone);
	const props = master[1].filter(([name]) => name !== 'sequence' && name !== 'dtstamp');
	const sequence = Number(master[1].find(([name]) => name === 'sequence')?.[3] ?? 0);
	props.push(
		['sequence', {}, 'integer', sequence + 1],
		['dtstamp', {}, 'date-time', utc(new Date())],
	);
	master[1] = props;
	return await save(call, url, uid, vcalendar);
}

export async function deleteEvent(
	call: Request,
	calendar: string,
	uid: string,
): Promise<IDataObject> {
	await call({ method: 'DELETE', url: eventUrl(calendar, uid) });
	return { deleted: true, uid };
}
