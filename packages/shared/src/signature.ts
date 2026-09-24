/**
 * Signature templates.
 *
 * SMTP sends exactly the bytes we hand it: a mailbox's web-UI signature exists
 * only inside that web UI, so every sender configured here has to carry its own
 * signature HTML. Asking an operator to hand-write email HTML is how you get
 * signatures that look right in the compose box and collapse in Outlook, so the
 * admin UI fills in a template instead and this module renders it.
 *
 * Everything here is a pure function over plain values — no DOM, no deps — so
 * the browser can render a live preview and the API can re-render or verify the
 * same markup from the same fields.
 *
 * The markup deliberately looks a decade out of date: nested tables,
 * presentational attributes, inline styles only. Outlook renders HTML through
 * Word, which has no flexbox, no grid, and no usable `<style>` block.
 */

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export interface SignatureFields {
  fullName: string;
  jobTitle: string;
  company: string;
  /** Headshot, https only. Most clients block remote images until asked. */
  photoUrl: string;
  logoUrl: string;
  websiteUrl: string;
  /** Display text for the website link. Falls back to the bare host. */
  websiteLabel: string;
  email: string;
  phone: string;
  address: string;
  /** The "P.s." line under the signature — a demo link, a booking page. */
  ctaText: string;
  ctaUrl: string;
  /** Heading and link colour. */
  accentColor: string;
}

export const EMPTY_SIGNATURE_FIELDS: SignatureFields = {
  fullName: '',
  jobTitle: '',
  company: '',
  photoUrl: '',
  logoUrl: '',
  websiteUrl: '',
  websiteLabel: '',
  email: '',
  phone: '',
  address: '',
  ctaText: '',
  ctaUrl: '',
  accentColor: '#1d4ed8',
};

export type SignatureTemplateId =
  | 'photo-card'
  | 'logo-left'
  | 'stacked'
  | 'minimal';

export interface SignatureTemplate {
  id: SignatureTemplateId;
  label: string;
  /** One line describing who the layout suits, shown in the picker. */
  description: string;
  /** Fields the layout actually renders — the form hides the rest. */
  fields: Array<keyof SignatureFields>;
}

const CONTACT_FIELDS: Array<keyof SignatureFields> = [
  'websiteUrl',
  'websiteLabel',
  'email',
  'phone',
  'address',
  'ctaText',
  'ctaUrl',
  'accentColor',
];

export const SIGNATURE_TEMPLATES: SignatureTemplate[] = [
  {
    id: 'photo-card',
    label: 'Photo card',
    description:
      'Headshot and logo on the left, details on the right. The most personal, and the heaviest on images.',
    fields: [
      'fullName',
      'jobTitle',
      'company',
      'photoUrl',
      'logoUrl',
      ...CONTACT_FIELDS,
    ],
  },
  {
    id: 'logo-left',
    label: 'Logo left',
    description:
      'Company logo beside the details. For when the brand matters more than the face.',
    fields: ['fullName', 'jobTitle', 'company', 'logoUrl', ...CONTACT_FIELDS],
  },
  {
    id: 'stacked',
    label: 'Stacked',
    description:
      'One column, logo underneath. Never reflows on a narrow phone screen.',
    fields: ['fullName', 'jobTitle', 'company', 'logoUrl', ...CONTACT_FIELDS],
  },
  {
    id: 'minimal',
    label: 'Text only',
    description:
      'No images at all. Renders identically everywhere and never looks broken in an image-blocking client.',
    fields: ['fullName', 'jobTitle', 'company', ...CONTACT_FIELDS],
  },
];

export function signatureTemplate(id: string): SignatureTemplate {
  return (
    SIGNATURE_TEMPLATES.find((template) => template.id === id) ??
    SIGNATURE_TEMPLATES[0]
  );
}

// ---------------------------------------------------------------------------
// Escaping and URL handling
// ---------------------------------------------------------------------------

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Operators type `example.com`, not `https://example.com`. Assume https for
 * a bare host and drop anything that is neither https nor a mail/phone link —
 * an `http://` logo turns the whole message into mixed content, and the server
 * sanitiser would strip a `javascript:` href anyway.
 */
export function normaliseSignatureUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (/^https:\/\//i.test(value)) return value;
  if (/^(mailto|tel):/i.test(value)) return value;
  // A scheme we will not emit — including http, which mail clients flag.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';
  return `https://${value.replace(/^\/+/, '')}`;
}

/** `https://www.example.com/` becomes `www.example.com`. */
export function prettyUrl(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value.trim());
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * Matches the message body, which uses Gmail's compose font. A signature in a
 * different face from the text above it is the first thing that makes a mail
 * look templated.
 */
const FONT = 'Arial, Helvetica, sans-serif';

/**
 * Every text line of the signature: the body's `small/1.5`, as longhand
 * because Outlook is unreliable with the `font` shorthand. The name stands out
 * by weight, case and colour rather than by size.
 */
const TEXT = `font-family:${FONT};font-size:small;line-height:1.5`;

const INK = '#111827';
const MUTED = '#4b5563';
const RULE = '#d1d5db';

interface Resolved {
  accent: string;
  fullName: string;
  role: string;
  /** Kept apart from `role` because it is also the logo's alt text. */
  company: string;
  website: { href: string; label: string } | null;
  email: string;
  phone: string;
  address: string;
  cta: { text: string; href: string } | null;
  photoUrl: string;
  logoUrl: string;
}

function resolve(fields: SignatureFields): Resolved {
  const websiteHref = normaliseSignatureUrl(fields.websiteUrl);
  // "Chief Executive Officer, Example Ltd" on one line: a job title without the company
  // reads as unfinished, and a second line makes the block taller than the photo.
  const role = [fields.jobTitle.trim(), fields.company.trim()]
    .filter(Boolean)
    .join(', ');
  const ctaHref = normaliseSignatureUrl(fields.ctaUrl);

  return {
    accent: isHexColor(fields.accentColor)
      ? fields.accentColor.trim()
      : EMPTY_SIGNATURE_FIELDS.accentColor,
    fullName: fields.fullName.trim(),
    role,
    company: fields.company.trim(),
    website: websiteHref
      ? {
          href: websiteHref,
          label: fields.websiteLabel.trim() || prettyUrl(websiteHref),
        }
      : null,
    email: fields.email.trim(),
    phone: fields.phone.trim(),
    address: fields.address.trim(),
    cta:
      fields.ctaText.trim() && ctaHref
        ? { text: fields.ctaText.trim(), href: ctaHref }
        : null,
    photoUrl: normaliseSignatureUrl(fields.photoUrl),
    logoUrl: normaliseSignatureUrl(fields.logoUrl),
  };
}

/**
 * `target`/`rel` are emitted rather than left to the server sanitiser, which
 * adds them to every link on the way in. Emitting them here keeps the preview
 * and the stored HTML byte-identical, so what the operator approves is what
 * goes out — and lets the spec assert exactly that.
 */
function link(href: string, label: string, accent: string): string {
  return (
    `<a href="${esc(href)}" style="color:${esc(accent)};text-decoration:underline" ` +
    `target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
  );
}

/**
 * Literal non-breaking spaces, not `&nbsp;` entities: the sanitiser decodes
 * entities on the way through, so emitting the character is what round-trips.
 */
const NBSP = '\u00a0';

function nameBlock(r: Resolved): string {
  if (!r.fullName) return '';
  return (
    `<div style="${TEXT};font-weight:bold;` +
    `color:${esc(r.accent)};letter-spacing:0.4px;text-transform:uppercase;` +
    `padding:0 0 4px 0">${esc(r.fullName)}</div>`
  );
}

function roleBlock(r: Resolved): string {
  if (!r.role) return '';
  return (
    `<div style="${TEXT};color:${INK};` +
    `padding:0 0 8px 0">${esc(r.role)}</div>`
  );
}

/**
 * The hairline between the name and the contact rows. A styled `<div>` rather
 * than an `<hr>`: Outlook gives `<hr>` its own margins and a 3D bevel that no
 * inline style reliably removes.
 */
function ruleBlock(): string {
  return (
    `<div style="border-top:1px solid ${RULE};font-size:1px;line-height:1px;` +
    `padding:0;margin:0 0 8px 0">${NBSP}</div>`
  );
}

/**
 * Contact rows. Labels sit inline with their value rather than in their own
 * column — a two-column contact table is the first thing to break when a phone
 * client narrows the signature.
 */
function contactBlock(r: Resolved): string {
  const inline: string[] = [];
  if (r.website) {
    inline.push(`<b>Web</b> ${link(r.website.href, r.website.label, r.accent)}`);
  }
  if (r.email) {
    inline.push(`<b>Email</b> ${link(`mailto:${r.email}`, r.email, r.accent)}`);
  }
  if (r.phone) {
    const tel = r.phone.replace(/[^\d+]/g, '');
    inline.push(`<b>Phone</b> ${link(`tel:${tel}`, r.phone, r.accent)}`);
  }

  const parts: string[] = [];
  if (inline.length) {
    parts.push(
      `<div style="${TEXT};color:${MUTED};padding:0 0 4px 0">` +
        `${inline.join(NBSP + NBSP + NBSP)}</div>`,
    );
  }
  if (r.address) {
    parts.push(
      `<div style="${TEXT};color:${MUTED};padding:0">${esc(r.address)}</div>`,
    );
  }
  return parts.join('');
}

function ctaBlock(r: Resolved): string {
  if (!r.cta) return '';
  return (
    `<div style="${TEXT};color:${MUTED};padding:12px 0 0 0"><b>P.s.</b> ` +
    `${link(r.cta.href, r.cta.text, r.accent)}</div>`
  );
}

/**
 * `width` is set as both an attribute and a style: Outlook reads the attribute,
 * everything else reads the style, and `height:auto` is what stops a client
 * from stretching a logo to its intrinsic pixel height.
 */
function image(url: string, alt: string, width: number, padding: string): string {
  if (!url) return '';
  return (
    `<img src="${esc(url)}" alt="${esc(alt)}" width="${width}" ` +
    `style="display:block;width:${width}px;max-width:${width}px;height:auto;` +
    `border:none;padding:${padding}" />`
  );
}

/** The presentation table every layout starts from. */
function table(body: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse;font-family:${FONT}">` +
    `<tbody>${body}</tbody></table>`
  );
}

function detailsColumn(r: Resolved): string {
  return [
    nameBlock(r),
    roleBlock(r),
    ruleBlock(),
    contactBlock(r),
  ].join('');
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

function photoCard(r: Resolved): string {
  const media =
    image(r.photoUrl, r.fullName, 104, '0 0 10px 0') +
    image(r.logoUrl, r.company || 'Logo', 104, '0');

  const left = media
    ? `<td valign="top" width="124" style="vertical-align:top;padding:0 20px 0 0">${media}</td>`
    : '';

  return table(
    `<tr>${left}<td valign="top" style="vertical-align:top;padding:0">` +
      `${detailsColumn(r)}</td></tr>`,
  );
}

function logoLeft(r: Resolved): string {
  const logo = image(r.logoUrl, r.company || 'Logo', 92, '0');
  const left = logo
    ? `<td valign="top" width="112" style="vertical-align:top;padding:0 20px 0 0">${logo}</td>`
    : '';

  return table(
    `<tr>${left}<td valign="top" style="vertical-align:top;padding:0">` +
      `${detailsColumn(r)}</td></tr>`,
  );
}

function stacked(r: Resolved): string {
  const logo = image(r.logoUrl, r.company || 'Logo', 96, '12px 0 0 0');
  return table(
    `<tr><td valign="top" style="vertical-align:top;padding:0">` +
      `${detailsColumn(r)}${logo}</td></tr>`,
  );
}

function minimal(r: Resolved): string {
  return table(
    `<tr><td valign="top" style="vertical-align:top;padding:0">` +
      `${nameBlock(r)}${roleBlock(r)}${contactBlock(r)}</td></tr>`,
  );
}

const LAYOUTS: Record<SignatureTemplateId, (r: Resolved) => string> = {
  'photo-card': photoCard,
  'logo-left': logoLeft,
  stacked,
  minimal,
};

// ---------------------------------------------------------------------------
// Public renderers
// ---------------------------------------------------------------------------

/**
 * Renders the signature HTML. The result still goes through the server-side
 * sanitiser before it is stored — this produces markup that survives that pass
 * intact, which `signature-templates.spec.ts` pins down.
 */
export function renderSignatureHtml(
  templateId: string,
  fields: SignatureFields,
): string {
  const r = resolve(fields);
  // A blank form should clear the signature, not store an empty table.
  const empty =
    !r.fullName &&
    !r.role &&
    !r.website &&
    !r.email &&
    !r.phone &&
    !r.address &&
    !r.photoUrl &&
    !r.logoUrl &&
    !r.cta;
  if (empty) return '';

  const template = signatureTemplate(templateId);
  return (
    `<div data-ims-signature="${template.id}">` +
    `${LAYOUTS[template.id](r)}${ctaBlock(r)}</div>`
  );
}

/**
 * The plain-text half. Every message is multipart, so a signature that exists
 * only as HTML reads as a missing sign-off on a text client — and, to a filter
 * comparing the two parts, as a body that does not match its own alternative.
 */
export function renderSignatureText(fields: SignatureFields): string {
  const r = resolve(fields);
  const lines: string[] = [];
  if (r.fullName) lines.push(r.fullName);
  if (r.role) lines.push(r.role);
  if (r.website) lines.push(`Web: ${prettyUrl(r.website.href)}`);
  if (r.email) lines.push(`Email: ${r.email}`);
  if (r.phone) lines.push(`Phone: ${r.phone}`);
  if (r.address) lines.push(r.address);
  if (r.cta) lines.push(`P.s. ${r.cta.text}: ${r.cta.href}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Round-tripping the builder
// ---------------------------------------------------------------------------

/**
 * The account row stores HTML and nothing else — that is what gets sent — so
 * re-opening a mailbox has nothing to put back into the builder's form unless
 * the markup says where it came from. The wrapper carries the template id and
 * the field values that produced it.
 *
 * Values are percent-encoded JSON: that alphabet contains no quote or angle
 * bracket, so the payload cannot close the tag it lives in, and it holds only
 * what the signature already displays.
 *
 * `ims` in both attribute names is the legacy internal name. They are part of
 * every signature already stored, so they stay.
 */
const STATE_ATTR = 'data-ims-signature-fields';

export interface SignatureBuilderState {
  templateId: SignatureTemplateId;
  fields: SignatureFields;
}

export function withSignatureState(
  html: string,
  state: SignatureBuilderState,
): string {
  if (!html) return '';
  const payload = encodeURIComponent(JSON.stringify(state));
  return html.replace(/^<div\b/, `<div ${STATE_ATTR}="${payload}"`);
}

// ---------------------------------------------------------------------------
// Sender placeholders
// ---------------------------------------------------------------------------

/**
 * Stands in for the sending mailbox's address. One library signature is shared
 * by several mailboxes, and a typed address would show the same inbox on all of
 * their mail — which is exactly how a copied signature ends up advertising the
 * wrong one.
 */
export const SENDER_EMAIL_PLACEHOLDER = '{{senderEmail}}';

/**
 * Fills the sender placeholder. The HTML half gets the address escaped, the
 * text half gets it raw. Used at send time and by every preview, so what an
 * operator sees is what a recipient gets.
 */
export function fillSignature(
  template: string,
  senderEmail: string,
  format: 'html' | 'text',
): string {
  const value = format === 'html' ? esc(senderEmail) : senderEmail;
  return template.split(SENDER_EMAIL_PLACEHOLDER).join(value);
}

/** Reads the builder state back out of stored HTML. Null when hand-written. */
export function decodeSignatureState(
  html: string,
): SignatureBuilderState | null {
  const match = html.match(new RegExp(`${STATE_ATTR}="([^"]*)"`));
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(match[1]));
    if (!parsed || typeof parsed !== 'object') return null;
    const state = parsed as Partial<SignatureBuilderState>;
    if (!state.fields || typeof state.fields !== 'object') return null;
    return {
      templateId: signatureTemplate(String(state.templateId)).id,
      // Merged over the defaults so a signature stored before a field existed
      // still opens in the builder rather than falling back to raw HTML.
      fields: { ...EMPTY_SIGNATURE_FIELDS, ...state.fields },
    };
  } catch {
    return null;
  }
}
