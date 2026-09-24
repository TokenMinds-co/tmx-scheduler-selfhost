import { dedupeKey } from './crypto.service';

const base = {
  sendingEmail: 'outreach@mail.example.com',
  toEmail: 'ada@example.com',
  subject: 'Quick question',
  group: 'pilot-2026',
  bodyText: 'Hi Ada, are you hiring?',
  bodyHtml: null,
  firstName: 'Ada',
  lastName: 'T',
  company: 'Example Ltd',
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
      ['body', { bodyText: 'Hi Ada, are you still hiring?' }],
      ['html body', { bodyHtml: '<p>Hi Ada</p>' }],
      ['first name', { firstName: 'Adah' }],
      ['last name', { lastName: 'Lovelace' }],
      ['company', { company: 'Example' }],
      ['subject', { subject: 'A different question' }],
      ['group', { group: 'pilot-2026-b' }],
      ['recipient', { toEmail: 'grace@example.com' }],
      ['sending mailbox', { sendingEmail: 'other@mail.example.com' }],
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
