/**
 * Settings read back out of `localStorage`, on either page. Stored JSON is
 * untrusted: an older build wrote it, or someone edited it, or the browser
 * handed back something else entirely. Every field is checked against the
 * values the page still understands, one at a time, so a mode renamed in a
 * later build resets that one setting and nothing else.
 *
 * In `shared/` because both the host (`host/ui/settings.ts`) and the phone
 * (`controller/main.ts`) keep settings, and neither touches the other.
 */

type Value = string | number | boolean;

export function parsePrefs<T extends { [K in keyof T]: Value }>(
	raw: string | null,
	defaults: T,
	allowed: { readonly [K in keyof T]: readonly T[K][] },
): T {
	let stored: unknown = null;
	try {
		stored = raw === null ? null : JSON.parse(raw);
	} catch {
		return { ...defaults };
	}
	if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
		return { ...defaults };
	}
	const record = stored as Record<string, unknown>;
	const out = { ...defaults };
	for (const key of Object.keys(defaults) as (keyof T)[]) {
		const value = record[key as string];
		if ((allowed[key] as readonly unknown[]).includes(value)) {
			out[key] = value as T[keyof T];
		}
	}
	return out;
}
