import { AGREE_FIRST, BACKUPS, IRREVOCABLE } from '@/lib/email/entity-erasure';

/** The same warning wherever a deletion is asked for or confirmed. */
export function IrrevocableWarning() {
  return (
    <div
      role="note"
      className="space-y-2 rounded border-2 border-red-700 bg-red-50 p-4 text-sm text-red-900"
    >
      <p className="font-semibold uppercase tracking-wide">
        Irrevocable: this cannot be undone
      </p>
      <p>{IRREVOCABLE}</p>
      <p className="font-medium">{AGREE_FIRST}</p>
      <p>{BACKUPS}</p>
    </div>
  );
}

/** Records the law may require a firm to keep. Flagged, not decided. */
export function RetentionDuties() {
  return (
    <section className="space-y-2 text-sm">
      <h2 className="font-semibold">Records you may be required to keep</h2>
      <p className="max-w-prose text-ink-soft">
        Some of what is deleted may be records the law expects your firm to
        keep. Govern does not decide that for you. Check with your data
        protection officer or legal adviser, and export what you need to keep
        before you delete. For example:
      </p>
      <ul className="list-disc space-y-1 pl-5 text-ink-soft">
        <li>
          the breach register, which documents every personal data breach (UK
          GDPR and EU GDPR Article 33(5)), and a communications provider&apos;s
          inventory of breaches under PECR regulation 5A;
        </li>
        <li>
          records of processing activities (Article 30) and data protection
          impact assessments (Article 35);
        </li>
        <li>
          data subject requests and complaints, and what was decided on them;
        </li>
        <li>freedom of information requests and their responses;</li>
        <li>
          risk acceptances, AI assurance records and published algorithmic
          transparency records.
        </li>
      </ul>
    </section>
  );
}
