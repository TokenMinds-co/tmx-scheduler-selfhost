import { DateTime } from 'luxon';

export type ParsedSchedule =
  { ok: true; utc: Date } | { ok: false; reason: string };

/**
 * Timezone abbreviations that appear in the sheets, mapped to IANA zones.
 *
 * This map is deliberately small and deliberately unambiguous. Abbreviations
 * are not a real standard — "CST" is three different zones, "IST" is four —
 * so anything not listed here is rejected rather than guessed. A guess here
 * sends a campaign at the wrong hour in someone else's country, and nothing
 * downstream would notice.
 */
const ZONE_ALIASES: Record<string, string> = {
  UTC: 'UTC',
  GMT: 'UTC',
  Z: 'UTC',
  SGT: 'Asia/Singapore',
  SST: 'Asia/Singapore',
  WIB: 'Asia/Jakarta',
  JST: 'Asia/Tokyo',
  KST: 'Asia/Seoul',
  HKT: 'Asia/Hong_Kong',
  MYT: 'Asia/Kuala_Lumpur',
  PHT: 'Asia/Manila',
  ICT: 'Asia/Bangkok',
  AEST: 'Australia/Sydney',
  AEDT: 'Australia/Sydney',
  IST: 'Asia/Kolkata',
  CET: 'Europe/Paris',
  CEST: 'Europe/Paris',
  BST: 'Europe/London',
  ET: 'America/New_York',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  CT: 'America/Chicago',
  MT: 'America/Denver',
  PT: 'America/Los_Angeles',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
};

/** Formats accepted for the date-and-time half, tried in order. */
const FORMATS = [
  'LLL d yyyy h:mm a',
  // Dot-separated variants of each: 11.10 AM is how a lot of the world writes
  // it, and Luxon needs the separator spelled out rather than inferred.
  'LLL d yyyy h.mm a',
  'LLL d yyyy H.mm',
  'LLLL d yyyy h.mm a',
  'yyyy-LL-dd h.mm a',
  'd LLL yyyy h.mm a',
  'LL/dd/yyyy h.mm a',
  'LLL d yyyy H:mm',
  'LLLL d yyyy h:mm a',
  'LLLL d yyyy H:mm',
  'yyyy-LL-dd h:mm a',
  'yyyy-LL-dd HH:mm',
  'yyyy-LL-dd HH:mm:ss',
  'd LLL yyyy h:mm a',
  'd LLL yyyy H:mm',
  'LL/dd/yyyy h:mm a',
  'LL/dd/yyyy HH:mm',
];

/**
 * Parses a `Schedule` cell into a UTC instant.
 *
 * A cell may carry its own zone — `Sep 10 2026 12:03 AM SGT` — and that always
 * wins. Sheets exported from most tools do not, so the importer lets the
 * operator name the zone the whole file was written in.
 *
 * The original rule was that a bare local time is an error, because assuming
 * the server's clock is how a campaign goes out seven hours early in someone
 * else’s country. That reasoning still holds; what changed is where the zone
 * comes from. `fallbackZone` is a deliberate choice made on the import screen,
 * not an assumption, so it is safe to apply — and with no fallback supplied
 * the old behaviour stands and the row is rejected.
 *
 * A zone token that is present but unrecognised is a different case: the
 * author meant a zone and mistyped it. That still fails rather than falling
 * back, because silently overriding what someone wrote is worse than saying so.
 *
 * @param fallbackZone Zone for cells with no zone of their own. `null` rejects
 *   them instead.
 */
export function parseSchedule(
  raw: string,
  fallbackZone: string | null = null,
): ParsedSchedule {
  const input = raw?.trim();
  if (!input) return { ok: false, reason: 'Schedule is empty' };

  // ISO 8601 with an offset or a Z is already unambiguous.
  const iso = DateTime.fromISO(input, { setZone: true });
  if (iso.isValid && /([+-]\d{2}:?\d{2}|Z)$/i.test(input)) {
    return { ok: true, utc: iso.toUTC().toJSDate() };
  }

  const { body, zone, zoneToken } = splitZone(input);

  // No token at all means a bare local time, which the chosen fallback
  // covers. A token that failed to resolve is a typo and is never papered
  // over.
  const effectiveZone = zone ?? (zoneToken === null ? fallbackZone : null);

  if (!effectiveZone) {
    return {
      ok: false,
      reason: zoneToken
        ? `Unknown timezone "${zoneToken}". Use an IANA zone (Asia/Singapore), a UTC offset (+08:00), or one of: ${Object.keys(ZONE_ALIASES).join(', ')}`
        : 'This cell has no timezone. Choose the timezone your sheet was written in on the import screen, or write it into the cell as "Sep 10 2026 12:03 AM SGT".',
    };
  }

  const normalisedBody = body.replace(/\s+/g, ' ').replace(/,/g, '').trim();

  for (const format of FORMATS) {
    const parsed = DateTime.fromFormat(normalisedBody, format, {
      zone: effectiveZone,
    });
    if (parsed.isValid) return { ok: true, utc: parsed.toUTC().toJSDate() };
  }

  const relaxed = DateTime.fromISO(normalisedBody.replace(' ', 'T'), {
    zone: effectiveZone,
  });
  if (relaxed.isValid) return { ok: true, utc: relaxed.toUTC().toJSDate() };

  // Name the zone only when the caller has not supplied one, so the advice
  // matches what this particular import actually needs.
  const example = fallbackZone
    ? '"Sep 10 2026 12:03 AM" or "2026-09-10 00:03"'
    : '"Sep 10 2026 12:03 AM SGT"';
  return {
    ok: false,
    reason: `Could not read the date and time in "${input}". Expected something like ${example}. Use a colon between hours and minutes.`,
  };
}

/**
 * Splits the trailing zone token off the cell.
 *
 * Returns `zoneToken` even when the zone is unresolvable, so the caller can say
 * *which* abbreviation it rejected instead of a generic parse failure.
 */
function splitZone(input: string): {
  body: string;
  zone: string | null;
  zoneToken: string | null;
} {
  // Trailing UTC offset: "... +08:00" / "... GMT+8".
  const offset = /(?:GMT|UTC)?\s*([+-]\d{1,2}:?\d{2})$/i.exec(input);
  if (offset) {
    const raw = offset[1].replace(':', '');
    const sign = raw[0];
    const hours = raw.slice(1, 3);
    const minutes = raw.slice(3, 5) || '00';
    return {
      body: input.slice(0, offset.index).trim(),
      zone: `UTC${sign}${hours}:${minutes}`,
      zoneToken: offset[1],
    };
  }

  // Trailing IANA zone: "... Asia/Singapore".
  const iana = /([A-Za-z]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)$/.exec(input);
  if (iana) {
    const candidate = iana[1];
    const valid = DateTime.local().setZone(candidate).isValid;
    return {
      body: input.slice(0, iana.index).trim(),
      zone: valid ? candidate : null,
      zoneToken: candidate,
    };
  }

  // Trailing abbreviation: "... SGT". Guarded against swallowing "AM"/"PM".
  const abbrev = /\b([A-Za-z]{1,5})$/.exec(input);
  if (abbrev && !/^(AM|PM)$/i.test(abbrev[1])) {
    const token = abbrev[1].toUpperCase();
    return {
      body: input.slice(0, abbrev.index).trim(),
      zone: ZONE_ALIASES[token] ?? null,
      zoneToken: abbrev[1],
    };
  }

  return { body: input, zone: null, zoneToken: null };
}

export const SUPPORTED_ZONE_ABBREVIATIONS = Object.keys(ZONE_ALIASES);
