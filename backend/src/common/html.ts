import sanitizeHtml from 'sanitize-html';

const COLOUR = [/^#[0-9a-f]{3,8}$/i, /^rgb\(/];

/** `1px solid #d1d5db`, or `none` / `0` for a border a template clears. */
const BORDER = [
  /^\d+(px|pt)?\s+(solid|dashed|dotted)\s+(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\))$/i,
  /^none$/i,
  /^0$/,
];

const LENGTH = [/^\d+(\.\d+)?(px|pt|em|%)?$/, /^auto$/];

/**
 * Signatures are authored in the admin UI — either by filling in a template or
 * by pasting HTML — so the markup arrives from a browser and has to be treated
 * as untrusted even though the author is staff: a pasted signature can carry
 * anything the source page had.
 *
 * `img` keeps `src` because logos are the whole point; `cid:` and `data:` are
 * allowed alongside https so an inline logo survives, and http is not, so a
 * signature cannot silently downgrade a message to a mixed-content fetch.
 *
 * The presentational vocabulary below is wider than a modern page would need
 * because mail clients need it: Outlook lays out through Word, so a signature
 * is a table with `cellpadding`, `valign` and inline styles, and whatever this
 * strips is layout the recipient loses. It stays a *presentational* vocabulary
 * — `background-color` but never the `background` shorthand, which takes a
 * `url()` and would turn a signature into a tracking fetch.
 */
export function sanitizeSignatureHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'a', 'b', 'br', 'div', 'em', 'font', 'i', 'img', 'li', 'ol', 'p',
      'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'style'],
      // `role="presentation"` keeps a layout table out of a screen reader's
      // table navigation; the rest is what Outlook reads instead of the styles.
      table: [
        'role', 'width', 'cellpadding', 'cellspacing', 'border', 'bgcolor',
        // Where the template builder stores the fields it rendered from, so a
        // saved signature can be re-opened in the form instead of as raw HTML.
        'data-ims-signature', 'data-ims-signature-fields',
      ],
      div: ['data-ims-signature', 'data-ims-signature-fields'],
      td: ['width', 'height', 'valign', 'colspan', 'rowspan', 'bgcolor'],
      th: ['width', 'height', 'valign', 'colspan', 'rowspan', 'bgcolor'],
      tr: ['valign', 'bgcolor'],
      '*': ['style', 'align'],
    },
    allowedSchemes: ['https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https', 'cid', 'data'] },
    // Inline styles are how mail clients get any styling at all, but keep the
    // vocabulary narrow rather than allowing arbitrary CSS.
    allowedStyles: {
      '*': {
        color: COLOUR,
        'background-color': COLOUR,
        'font-size': [/^\d+(px|pt|em|%)$/],
        'font-family': [/^[\w\s,'"-]+$/],
        'font-weight': [/^(normal|bold|\d{3})$/],
        'font-style': [/^(normal|italic)$/],
        'text-align': [/^(left|right|center|justify)$/],
        'text-decoration': [/^(none|underline)$/],
        'text-transform': [/^(none|uppercase|lowercase|capitalize)$/],
        'letter-spacing': [/^-?\d+(\.\d+)?(px|em)$/],
        'line-height': [/^(normal|\d+(\.\d+)?(px|pt|em|%)?)$/],
        'vertical-align': [/^(top|middle|bottom|baseline)$/],
        'white-space': [/^(normal|nowrap)$/],
        display: [/^(block|inline|inline-block|table|table-cell)$/],
        width: LENGTH,
        height: LENGTH,
        'max-width': LENGTH,
        'border-collapse': [/^(collapse|separate)$/],
        'border-radius': [/^\d+(px|%)$/],
        border: BORDER,
        'border-top': BORDER,
        'border-right': BORDER,
        'border-bottom': BORDER,
        'border-left': BORDER,
        margin: [/^[\d\s.a-z%]+$/i],
        padding: [/^[\d\s.a-z%]+$/i],
      },
    },
    transformTags: {
      // Every outbound link opens outside the mail client; without noopener a
      // target=_blank link hands the opener to the destination.
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer',
      }),
    },
  });
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Message bodies supplied by an import go through the same allowlist as
 * signatures: both are untrusted markup headed for a mail client, and the
 * presentational vocabulary a mail client needs is identical either way.
 */
export const sanitizeMessageHtml = sanitizeSignatureHtml;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Turns the sheet's plain-text `Message` column into the HTML half of the
 * multipart message. Blank-line-separated blocks become paragraphs and single
 * newlines become `<br>`, which is what an operator typing into a spreadsheet
 * cell expects to see.
 *
 * Bare URLs become real anchors. Mail clients would linkify them on display
 * anyway, but a link the client invents never passes through link rewriting —
 * the recipient's click goes straight to the site and is never tracked.
 */
export function textToHtml(text: string): string {
  const normalised = text.replace(/\r\n/g, '\n').trim();
  if (!normalised) return '';
  return normalised
    .split(/\n{2,}/)
    .map((block) => `<p>${linkify(block).split('\n').join('<br />')}</p>`)
    .join('\n');
}

/**
 * A bare URL in plain text. Ends at whitespace and at the characters that
 * cannot appear unencoded in a URL, so `<https://x.test>` and
 * `"https://x.test"` both stop where the reader expects.
 */
const BARE_URL = /https?:\/\/[^\s<>"']+/gi;

/** Escapes plain text, wrapping each bare URL in an anchor. */
function linkify(text: string): string {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(BARE_URL)) {
    const start = match.index ?? 0;
    const url = trimTrailingPunctuation(match[0]);
    // "Visit https://." trims down to a scheme with nothing after it.
    if (!/^https?:\/\/./i.test(url)) continue;
    html += escapeHtml(text.slice(last, start));
    html +=
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">` +
      `${escapeHtml(url)}</a>`;
    last = start + url.length;
  }
  return html + escapeHtml(text.slice(last));
}

/**
 * Drops punctuation that ends the sentence rather than the URL: the full stop
 * in "see https://x.test." is not part of the address. A closing parenthesis
 * is kept when the URL opened one itself, as Wikipedia URLs do.
 */
function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const char = url[end - 1];
    if ('.,;:!?'.includes(char)) {
      end -= 1;
      continue;
    }
    if (char === ')') {
      const head = url.slice(0, end);
      const opened = head.split('(').length - 1;
      const closed = head.split(')').length - 1;
      if (closed > opened) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

/**
 * Best-effort plain-text fallback for a signature stored only as HTML.
 *
 * Line breaks are turned into newlines *before* the tags are stripped —
 * stripping first collapses "Kevin<br>TokenMinds" into "KevinTokenMinds",
 * which is what every plain-text reader would then see as the sign-off.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t');

  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
