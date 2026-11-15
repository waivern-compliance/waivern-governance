import { SOURCE_CODE_URL } from '@/lib/product';
import { bookingUrl } from '@/lib/trial';

/**
 * Beside the request for more time: a conversation with Waivern, where one
 * can be booked (`TRIAL_BOOKING_URL`), and the other way to keep using it,
 * which is to run it yourself.
 */
export function NextSteps() {
  const booking = bookingUrl();
  return (
    <section className="space-y-2 rounded border border-line bg-surface p-5 text-sm">
      <h2 className="font-semibold">Other ways forward</h2>
      {booking ? (
        <p>
          <a
            href={booking}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand underline"
          >
            Book a guided demo or an advisory session with Waivern
          </a>
          , to talk through what you saw and what you need.
        </p>
      ) : null}
      <p className="text-ink-soft">
        Govern is open source under the AGPL-3.0, so you can also run it
        yourself on your own infrastructure.{' '}
        <a
          href={SOURCE_CODE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand underline"
        >
          Get the source code
        </a>
        .
      </p>
    </section>
  );
}
