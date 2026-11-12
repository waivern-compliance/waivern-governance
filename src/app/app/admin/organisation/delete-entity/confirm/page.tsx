import { IrrevocableWarning, RetentionDuties } from '../Warning';
import { ConfirmLanding } from './ConfirmLanding';

/**
 * Where the emailed link lands. The token is after `#` in the address, so it
 * never reaches the server's logs; `ConfirmLanding` reads it and asks the
 * server what to show. Deletes nothing by being opened: the person must be
 * signed in as whoever asked, still be allowed to, and type the confirmation.
 */
export default function ConfirmDeletionPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="space-y-2 border-b border-line pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Confirm: permanently delete a legal entity
        </h1>
      </header>
      <ConfirmLanding
        warnings={
          <>
            <IrrevocableWarning />
            <RetentionDuties />
          </>
        }
      />
    </main>
  );
}
