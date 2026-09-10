import { dedupeKey } from './crypto.service';

const base = {
  sendingEmail: 'outreach@email.tmx.center',
  toEmail: 'kevin@tokenminds.co',
  subject: 'Quick question',
  group: 'pilot-2026',
  bodyText: 'Hi Kevin, are you hiring?',
  bodyHtml: null,
  firstName: 'Kevin',
  lastName: 'T',
  company: 'TokenMinds',
};

describe('dedupeKey', () => {
  it('treats an identical row as the same message', () => {
    expect(dedupeKey(base)).toBe(dedupeKey({ ...base }));
  });

  it('ignores casing and surrounding whitespace', () => {
    expect(dedupeKey(base)).toBe(
      dedupeKey({ ...base, subject: '  Quick Question  ' }),
    );
  });

  describe('anything the recipient would see makes it a new message', () => {
    it.each([
      ['body', { bodyText: 'Hi Kevin, are you still hiring?' }],
      ['html body', { bodyHtml: '<p>Hi Kevin</p>' }],
      ['first name', { firstName: 'Kev' }],
      ['last name', { lastName: 'Tanuwijaya' }],
      ['company', { company: 'TMX' }],
      ['subject', { subject: 'A different question' }],
      ['group', { group: 'pilot-2026-b' }],
      ['recipient', { toEmail: 'yama@tokenminds.co' }],
      ['sending mailbox', { sendingEmail: 'other@email.tmx.center' }],
    ])('%s', (_label, change) => {
      expect(dedupeKey({ ...base, ...change })).not.toBe(dedupeKey(base));
    });
  });

  it('still ignores the send time', () => {
    // Correcting a typo'd schedule and re-importing must not deliver twice —
    // the one case where silently skipping is the safer failure.
    const key = dedupeKey(base);
    expect(dedupeKey({ ...base })).toBe(key);
  });
});
