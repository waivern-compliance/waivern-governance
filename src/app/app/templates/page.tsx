import Link from 'next/link';
import { redirect } from 'next/navigation';

import { HelpLink } from '@/components/help/HelpLink';
import { NotPermitted } from '@/components/NotPermitted';
import { can, kindsFor } from '@/lib/rbac';
import { getActiveSession } from '@/lib/session';
import { draftBasis } from '@/lib/templates/draft-basis';
import { TEMPLATE_KIND_LABEL } from '@/lib/templates/kinds';
import { questionsOf } from '@/lib/templates/logic';
import type { ProgrammeScope } from '@/services/programme-scope';
import { relevantTemplates } from '@/services/template-relevance';
import {
  shippedTemplatesMissing,
  shippedTemplatesOutdated,
  templateLibrary,
  type TemplateKind
} from '@/services/templates';

import {
  createTemplateAction,
  installShippedAction,
  updateShippedAction
} from './actions';

/**
 * Kinds someone may author a template of from scratch. Cyber Essentials
 * readiness is left out: its scoring is tied to an edition's requirements,
 * which only the shipped template carries.
 */
const STARTABLE: readonly TemplateKind[] = [
  'screening',
  'dpia',
  'tra',
  'tia',
  'ai_risk',
  'supplier_record',
  'eia',
  'breach',
  'custom'
];

/**
 * What the organisation has declared, in the words the filter note uses: the
 * programmes whose templates are shown, and why data privacy is left out.
 */
function declared(scope: ProgrammeScope) {
  const laws = [scope.ukLaw ? 'UK' : null, scope.euLaw ? 'EU' : null].filter(
    Boolean
  );
  const shown = [
    scope.privacy ? `data privacy under ${laws.join(' and ')} law` : null,
    'AI governance',
    scope.cyberEssentials ? 'Cyber Essentials' : null
  ].filter((p): p is string => p !== null);
  const left = scope.privacy
    ? null
    : 'no entity is subject to UK or EU data protection law';
  return { shown, left };
}

export default async function Templates({
  searchParams
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const active = await getActiveSession();
  if (!active) redirect('/sign-in');

  if (!can(active.membership.grants, 'record.read')) {
    return (
      <NotPermitted
        what="The template library"
        organisationName={active.membership.organisationName}
      />
    );
  }

  // The whole library, drafts included: a template whose only version is an
  // unpublished draft is exactly what somebody editing came back for.
  const [library, relevant, allMissing, allOutdated, { all }] =
    await Promise.all([
      templateLibrary(active.membership.organisationId),
      relevantTemplates(active.membership.organisationId),
      shippedTemplatesMissing(active.membership.organisationId),
      shippedTemplatesOutdated(active.membership.organisationId),
      searchParams
    ]);
  // By default only what the organisation has declared it manages; the rest
  // is one link away, and the choice is in the address so it survives a
  // reload and can be shared.
  const showAll = all === '1';
  const rows = showAll
    ? library
    : library.filter(({ template }) => relevant.ids.has(template.id));
  const hidden = library.length - rows.length;
  const { shown, left } = declared(relevant.scope);
  const mayAuthor = can(active.membership.grants, 'template.author');
  const mayPublish = can(active.membership.grants, 'template.publish');
  // A role limited to some kinds is offered only those: the shipped templates
  // it may add or update, and the kinds it may start a template of.
  const authorKinds = kindsFor(active.membership.grants, 'template.author');
  const publishKinds = kindsFor(active.membership.grants, 'template.publish');
  const reaches = (kinds: string[] | null, kind: string) =>
    kinds === null || kinds.includes(kind);
  const missing = allMissing.filter((t) => reaches(publishKinds, t.kind));
  const outdated = allOutdated.filter((t) => reaches(publishKinds, t.kind));
  const updatable = outdated.filter((t) => !t.blockedByDraft);
  const blocked = outdated.filter((t) => t.blockedByDraft);
  const startable = STARTABLE.filter((kind) => reaches(authorKinds, kind)).map(
    (kind) => [kind, TEMPLATE_KIND_LABEL[kind]] as const
  );

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header className="space-y-1 border-b border-line pb-6">
        <Link
          href="/app"
          className="text-xs text-ink-soft hover:text-brand"
        >
          ← {active.membership.organisationName}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Assessment templates
        </h1>
        <p className="max-w-prose text-sm text-ink-soft">
          Every kind runs through the same engine. Publishing freezes a version,
          and assessments record the version they ran against.
        </p>
      </header>

      <HelpLink topic="templates" />

      {mayPublish && missing.length > 0 && library.length > 0 ? (
        <form
          action={installShippedAction}
          className="space-y-2 rounded border-l-2 border-brand bg-surface px-4 py-3"
        >
          <p className="text-sm">
            <strong>
              {missing.length === 1
                ? 'One template'
                : `${missing.length} templates`}{' '}
              released since your library was set up:
            </strong>{' '}
            {missing.map((t) => t.name).join(', ')}.
          </p>
          <p className="text-xs text-ink-soft">
            Adding them publishes each as a version 1 of its own. Nothing you
            already have changes.
          </p>
          <button
            type="submit"
            className="rounded border border-line bg-ground px-3 py-1.5 text-sm hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
          >
            Add {missing.length === 1 ? 'it' : 'them'}
          </button>
        </form>
      ) : null}

      {mayPublish && outdated.length > 0 ? (
        <form
          action={updateShippedAction}
          className="space-y-2 rounded border-l-2 border-brand bg-surface px-4 py-3"
        >
          <p className="text-sm">
            <strong>
              Waivern has updated{' '}
              {outdated.length === 1
                ? 'a template'
                : `${outdated.length} templates`}{' '}
              you use:
            </strong>{' '}
            {outdated
              .map((t) => `${t.name} (you have version ${t.version})`)
              .join(', ')}
            .
          </p>
          <p className="text-xs text-ink-soft">
            Updating publishes the new questions as the next version.
            Assessments already started keep the version they ran against.
            {blocked.length > 0
              ? ` ${blocked.map((t) => t.name).join(', ')} ${blocked.length === 1 ? 'has' : 'have'} an open draft, which has to be published or abandoned first.`
              : ''}
          </p>
          {updatable.length > 0 ? (
            <button
              type="submit"
              className="rounded border border-line bg-ground px-3 py-1.5 text-sm hover:border-brand focus-visible:outline-2 focus-visible:outline-brand"
            >
              Update {updatable.length === 1 ? 'it' : 'them'}
            </button>
          ) : null}
        </form>
      ) : null}

      {mayAuthor ? (
        <details className="rounded border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Add a template
          </summary>
          <form
            action={createTemplateAction}
            className="space-y-3 border-t border-line p-4"
          >
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-wider text-ink-soft">
                What is it called?
              </span>
              <input
                name="name"
                required
                className="w-full rounded border border-line bg-ground px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium uppercase tracking-wider text-ink-soft">
                  Kind
                </span>
                <select
                  name="kind"
                  required
                  defaultValue={
                    authorKinds === null ? 'custom' : startable[0]?.[0]
                  }
                  className="w-full rounded border border-line bg-ground px-3 py-2 text-sm"
                >
                  {startable.map(([value, label]) => (
                    <option
                      key={value}
                      value={value}
                    >
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium uppercase tracking-wider text-ink-soft">
                  Jurisdiction, if it matters
                </span>
                <input
                  name="jurisdiction"
                  placeholder="UK, EU…"
                  className="w-full rounded border border-line bg-ground px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-medium uppercase tracking-wider text-ink-soft">
                What is it for?
              </span>
              <textarea
                name="description"
                rows={2}
                className="w-full rounded border border-line bg-ground px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Create it
            </button>
            <p className="text-xs text-ink-soft">
              It starts as a draft with one question, which you then edit. It is
              offered to nobody until you publish it.
            </p>
          </form>
        </details>
      ) : null}

      {showAll || hidden > 0 ? (
        <div className="space-y-1 rounded border border-line bg-surface px-4 py-3 text-sm">
          {showAll ? (
            <p>
              Showing every template in your library.{' '}
              <Link
                href="/app/templates"
                className="text-brand underline-offset-2 hover:underline"
              >
                Show only those for what you manage
              </Link>
            </p>
          ) : (
            <p>
              Showing the templates for what you manage in Govern:{' '}
              {shown.join(', ')}.{' '}
              {hidden === 1 ? 'One other is' : `${hidden} others are`} hidden
              {left ? `, because ${left}` : ''}.{' '}
              <Link
                href="/app/templates?all=1"
                className="text-brand underline-offset-2 hover:underline"
              >
                See all templates
              </Link>
            </p>
          )}
          <p className="text-xs text-ink-soft">
            Templates you created, copied, have assessments against or are
            editing are always shown. What you manage follows the laws your
            entities are under and whether Cyber Essentials is on, both on the
            Organisation page.
          </p>
        </div>
      ) : null}

      <ul className="space-y-3">
        {rows.map(({ template, versions }) => {
          const published = versions.find((v) => v.status === 'published');
          const draft = versions.find((v) => v.status === 'draft');
          // What a new draft would copy: never an abandoned draft.
          const showing = draftBasis(versions);
          const questions = showing
            ? questionsOf(showing.definition.schema)
            : [];
          const conditional = questions.filter(
            ({ question }) => question.showWhen || question.requireWhen
          ).length;

          return (
            <li key={template.id}>
              <Link
                href={`/app/templates/${template.id}`}
                className="block rounded border border-line bg-surface p-4 hover:bg-ground focus-visible:outline-2 focus-visible:outline-brand"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-medium">{template.name}</h2>
                  <span className="font-mono text-xs text-ink-soft">
                    {TEMPLATE_KIND_LABEL[template.kind]}
                    {template.jurisdiction ? ` · ${template.jurisdiction}` : ''}
                    {published ? ` · v${published.version}` : ' · unpublished'}
                  </span>
                </div>
                {template.description ? (
                  <p className="mt-1 text-sm text-ink-soft">
                    {template.description}
                  </p>
                ) : null}
                <p className="mt-2.5 font-mono text-xs text-ink-soft">
                  {showing
                    ? `${showing.definition.schema.sections.length} sections · ${questions.length} questions · ${conditional} conditional · ${
                        showing.definition.scoring.method === 'none'
                          ? 'unscored'
                          : showing.definition.scoring.method.replace(/_/g, ' ')
                      }`
                    : 'no versions'}
                </p>
                {draft ? (
                  <span className="mt-2 inline-block rounded border border-amber-700 bg-amber-50 px-2 py-0.5 font-mono text-[11px] text-amber-900">
                    draft v{draft.version} in progress
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {library.length === 0 ? (
        <p className="text-sm text-ink-soft">
          No templates yet. Run <code className="font-mono">pnpm seed</code> to
          load the shipped library{mayAuthor ? ', or add one above' : ''}.
        </p>
      ) : null}
    </main>
  );
}
