'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  EMPTY_SIGNATURE_FIELDS,
  SIGNATURE_TEMPLATES,
  decodeSignatureState,
  renderSignatureHtml,
  renderSignatureText,
  signatureTemplate,
  withSignatureState,
  type SignatureFields,
  type SignatureTemplateId,
} from '@ims/shared';
import { ICONS, Icon } from './icons';
import { Field, Input, Textarea, cx } from './ui';

/**
 * Signature editing.
 *
 * SMTP carries no signature of its own — Gmail's lives in Gmail's compose box
 * and never reaches a message we send — so every mailbox configured here needs
 * one stored against it. That used to mean pasting hand-written email HTML into
 * a textarea, which is a specialist skill and an easy way to send a broken
 * block to a few hundred people.
 *
 * So the default is a form: pick a layout, fill in the details, watch the
 * preview. Pasting HTML is still there for anyone whose brand team handed them
 * a block, and the field values are stored inside the markup, so a signature
 * built from a template re-opens as a form rather than as HTML.
 */

interface FieldMeta {
  label: string;
  placeholder?: string;
  hint?: string;
  /** Multi-line and colour inputs; everything else is a plain text box. */
  kind?: 'text' | 'multiline' | 'color';
}

const FIELD_META: Record<keyof SignatureFields, FieldMeta> = {
  fullName: { label: 'Full name', placeholder: 'Anchor Chan' },
  jobTitle: { label: 'Job title', placeholder: 'Chief Executive Officer' },
  company: { label: 'Company', placeholder: 'TMX' },
  photoUrl: {
    label: 'Photo URL',
    placeholder: 'https://cdn.example.com/anchor.png',
    hint: 'A square headshot, around 200px. Must be a public https link.',
  },
  logoUrl: {
    label: 'Logo URL',
    placeholder: 'https://cdn.example.com/logo.png',
    hint: 'Public https link. Transparent PNG reads best on both themes.',
  },
  websiteUrl: { label: 'Website', placeholder: 'visibility.tmx.center' },
  websiteLabel: {
    label: 'Website link text',
    placeholder: 'Leave blank to show the address',
  },
  email: { label: 'Reply-to address', placeholder: 'anchor@mail.tmx.center' },
  phone: { label: 'Phone', placeholder: '+65 6123 4567' },
  address: {
    label: 'Address',
    placeholder: '139 Cecil Street #03-10, Singapore (069539)',
    kind: 'multiline',
  },
  ctaText: {
    label: 'P.s. link text',
    placeholder: 'See the full video of how it works',
    hint: 'An optional line under the signature.',
  },
  ctaUrl: { label: 'P.s. link', placeholder: 'https://youtube.com/watch?v=…' },
  accentColor: {
    label: 'Accent colour',
    hint: 'Used for the name and every link.',
    kind: 'color',
  },
};

/**
 * Twelve fields in one flat grid is a wall. Grouped, it reads as four short
 * questions — who, how to reach you, what to show, what to add — and each group
 * is short enough to take in without scrolling back up.
 */
const FIELD_GROUPS: Array<{
  label: string;
  icon: ReactNode;
  keys: Array<keyof SignatureFields>;
}> = [
  {
    label: 'Who',
    icon: ICONS.user,
    keys: ['fullName', 'jobTitle', 'company'],
  },
  {
    label: 'Contact',
    icon: ICONS.mail,
    keys: ['websiteUrl', 'websiteLabel', 'email', 'phone', 'address'],
  },
  { label: 'Images', icon: ICONS.image, keys: ['photoUrl', 'logoUrl'] },
  {
    label: 'Extras',
    icon: ICONS.sparkle,
    keys: ['ctaText', 'ctaUrl', 'accentColor'],
  },
];

export interface SignatureValue {
  html: string;
  text: string;
}

export function SignatureBuilder({
  value,
  onChange,
  accountName,
  accountEmail,
}: {
  value: SignatureValue;
  onChange: (next: SignatureValue) => void;
  /** The form's own From-name and address, for the prefill button. */
  accountName?: string;
  accountEmail?: string;
}) {
  // What is stored is HTML. A signature the builder produced carries the field
  // values that made it, so re-opening a mailbox lands back on the form; one
  // that was pasted in has nothing to recover and opens as HTML.
  //
  // Read once, from whatever this mounted with. Past that point the form below
  // is the source of truth and `value.html` is its own output, so re-reading it
  // would only ever overwrite what is being typed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saved = useMemo(() => decodeSignatureState(value.html), []);

  const [mode, setMode] = useState<'template' | 'html'>(
    saved || !value.html.trim() ? 'template' : 'html',
  );
  const [templateId, setTemplateId] = useState<SignatureTemplateId>(
    saved?.templateId ?? 'photo-card',
  );
  const [fields, setFields] = useState<SignatureFields>(
    saved?.fields ?? EMPTY_SIGNATURE_FIELDS,
  );
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  const template = signatureTemplate(templateId);

  function emit(nextTemplate: SignatureTemplateId, next: SignatureFields) {
    const html = renderSignatureHtml(nextTemplate, next);
    onChange({
      html: withSignatureState(html, { templateId: nextTemplate, fields: next }),
      text: renderSignatureText(next),
    });
  }

  function setField(key: keyof SignatureFields, raw: string) {
    const next = { ...fields, [key]: raw };
    setFields(next);
    emit(templateId, next);
  }

  function pickTemplate(id: SignatureTemplateId) {
    setTemplateId(id);
    emit(id, fields);
  }

  /**
   * The name and address are already typed into the form above. Copying them on
   * a click rather than syncing them live: a signature name is not always the
   * From name, and silently overwriting an edited field is worse than a button.
   */
  const canPrefill = Boolean(
    (accountName && accountName !== fields.fullName) ||
      (accountEmail && accountEmail !== fields.email),
  );

  function prefill() {
    const next = {
      ...fields,
      fullName: accountName || fields.fullName,
      email: accountEmail || fields.email,
    };
    setFields(next);
    emit(templateId, next);
  }

  async function copyHtml() {
    await navigator.clipboard.writeText(value.html);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="@container space-y-4">
      <ModeTabs mode={mode} onChange={setMode} />

      {mode === 'template' ? (
        <>
          <TemplatePicker selected={templateId} onSelect={pickTemplate} />

          <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="@container/fields space-y-4">
              {FIELD_GROUPS.map((group) => {
                // A layout without a logo has no Images group to show.
                const keys = group.keys.filter((key) =>
                  template.fields.includes(key),
                );
                if (!keys.length) return null;
                return (
                  <fieldset key={group.label}>
                    <legend className="mb-2 flex w-full items-center gap-2 border-b border-border pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <Icon className="size-3.5">{group.icon}</Icon>
                      {group.label}
                    </legend>
                    <div className="grid gap-x-3 gap-y-2.5 @md/fields:grid-cols-2">
                      {keys.map((key) => (
                        <SignatureField
                          key={key}
                          meta={FIELD_META[key]}
                          value={fields[key]}
                          onChange={(next) => setField(key, next)}
                        />
                      ))}
                    </div>
                    {group.label === 'Who' && canPrefill && (
                      <button
                        type="button"
                        onClick={prefill}
                        className="mt-2 text-xs font-medium text-accent hover:underline"
                      >
                        Use the name and address from this mailbox
                      </button>
                    )}
                  </fieldset>
                );
              })}
            </div>

            <Preview
              html={value.html}
              showSource={showSource}
              onToggleSource={() => setShowSource((on) => !on)}
              onCopy={() => void copyHtml()}
              copied={copied}
            />
          </div>
        </>
      ) : (
        <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field
            label="Signature HTML"
            hint="Tables and inline styles only — mail clients drop stylesheets. The server sanitises this again before it is stored."
          >
            <Textarea
              rows={14}
              className="font-mono text-xs"
              value={value.html}
              placeholder="<p><strong>Kevin</strong><br />TokenMinds</p>"
              onChange={(e) =>
                // Plain text is derived server-side from the HTML when it is
                // left blank, which is the right answer for a pasted block.
                onChange({ html: e.target.value, text: '' })
              }
            />
          </Field>
          <Preview
            html={value.html}
            showSource={false}
            onToggleSource={null}
            onCopy={() => void copyHtml()}
            copied={copied}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function ModeTabs({
  mode,
  onChange,
}: {
  mode: 'template' | 'html';
  onChange: (mode: 'template' | 'html') => void;
}) {
  const tabs: Array<{ id: 'template' | 'html'; label: string }> = [
    { id: 'template', label: 'Use a template' },
    { id: 'html', label: 'Paste HTML' },
  ];
  return (
    <div
      role="tablist"
      aria-label="Signature editing mode"
      className="inline-flex rounded-full border border-border bg-canvas p-0.5"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={mode === tab.id}
          onClick={() => onChange(tab.id)}
          className={cx(
            'rounded-full px-3 py-1 text-xs font-medium transition',
            mode === tab.id
              ? 'bg-surface shadow-sm'
              : 'text-muted hover:text-ink',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Four tiles and one description, rather than four tiles each carrying two
 * lines of prose. Only the chosen layout's trade-off is worth reading, and the
 * block above the fields shrinks from six lines to two.
 */
function TemplatePicker({
  selected,
  onSelect,
}: {
  selected: SignatureTemplateId;
  onSelect: (id: SignatureTemplateId) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
        {SIGNATURE_TEMPLATES.map((template) => {
          const active = template.id === selected;
          return (
            <button
              key={template.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(template.id)}
              className={cx(
                'flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition',
                active
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-ink hover:border-accent/40',
              )}
            >
              <TemplateGlyph id={template.id} />
              <span className="truncate text-xs font-medium">
                {template.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        {signatureTemplate(selected).description}
      </p>
    </div>
  );
}

/**
 * A wireframe of the layout, not an icon. Four template names read as four
 * arbitrary labels; the shape is what tells them apart at a glance.
 */
function TemplateGlyph({ id }: { id: SignatureTemplateId }) {
  const bar = 'block rounded-[1px] bg-current';
  const lines = (
    <span className="flex flex-1 flex-col gap-[2px]">
      <span className={cx(bar, 'h-[3px] w-full')} />
      <span className={cx(bar, 'h-[2px] w-3/4 opacity-50')} />
      <span className={cx(bar, 'h-[2px] w-full opacity-50')} />
    </span>
  );
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center gap-[3px] rounded border border-border p-1 text-accent"
    >
      {(id === 'photo-card' || id === 'logo-left') && (
        <span
          className={cx(
            bar,
            'h-full w-[6px] shrink-0',
            id === 'photo-card' ? 'opacity-80' : 'opacity-40',
          )}
        />
      )}
      {id === 'stacked' ? (
        <span className="flex flex-1 flex-col gap-[2px]">
          {lines}
          <span className={cx(bar, 'h-[4px] w-1/2 opacity-80')} />
        </span>
      ) : (
        lines
      )}
    </span>
  );
}

function SignatureField({
  meta,
  value,
  onChange,
}: {
  meta: FieldMeta;
  value: string;
  onChange: (value: string) => void;
}) {
  if (meta.kind === 'multiline') {
    return (
      <Field
        label={meta.label}
        hint={meta.hint}
        className="@md/fields:col-span-2"
      >
        <Textarea
          rows={2}
          value={value}
          placeholder={meta.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }

  if (meta.kind === 'color') {
    return (
      <Field label={meta.label} hint={meta.hint}>
        <span className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${meta.label} swatch`}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#1d4ed8'}
            onChange={(e) => onChange(e.target.value)}
            className="size-8 shrink-0 cursor-pointer rounded border border-border bg-canvas p-0.5"
          />
          <Input
            value={value}
            placeholder="#1d4ed8"
            onChange={(e) => onChange(e.target.value)}
          />
        </span>
      </Field>
    );
  }

  return (
    <Field label={meta.label} hint={meta.hint}>
      <Input
        value={value}
        placeholder={meta.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/**
 * The preview sits on white with dark text whatever the admin theme is: the
 * signature is judged in a mail client, and a block that reads well against a
 * dark dashboard can be invisible in an inbox.
 */
function Preview({
  html,
  showSource,
  onToggleSource,
  onCopy,
  copied,
}: {
  html: string;
  showSource: boolean;
  onToggleSource: (() => void) | null;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">
          {showSource ? 'HTML' : 'Preview'}
        </span>
        <span className="flex items-center gap-2">
          {onToggleSource && (
            <button
              type="button"
              onClick={onToggleSource}
              className="text-xs font-medium text-accent hover:underline"
            >
              {showSource ? 'Show preview' : 'Show HTML'}
            </button>
          )}
          {html && (
            <button
              type="button"
              onClick={onCopy}
              className="text-xs font-medium text-accent hover:underline"
            >
              {copied ? 'Copied' : 'Copy HTML'}
            </button>
          )}
        </span>
      </div>

      {!html ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted">
          Fill in a field to see the signature.
        </p>
      ) : showSource ? (
        <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-canvas p-3 text-[11px] leading-relaxed">
          <code className="whitespace-pre-wrap break-all">{html}</code>
        </pre>
      ) : (
        <div className="rounded-lg border border-border bg-white p-4">
          <div
            className="text-[#111827]"
            // Built by the renderer above, which escapes every value it is
            // given; a pasted block is the operator's own HTML. Either way the
            // server sanitises it again before it is stored or sent.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted">
        Most clients hide remote images until the recipient allows them, so the
        text has to stand on its own — send yourself a test to see it as it
        arrives.
      </p>
    </div>
  );
}
