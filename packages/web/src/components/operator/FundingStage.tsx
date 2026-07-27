import { Card, CopyField, SectionTitle, StatusDot } from '../../ui/primitives';
import type { FundingView } from '../../lib/operator';

/**
 * The operator funding stage (LIVE-01, D-36 through D-42), rendered ONLY for a live+broadcast
 * cohort (its `funding` view is present). The app is WATCH-ONLY: it never holds or spends the
 * funding keys - the operator funds the beacon address from their own wallet and this stage just
 * observes and narrates the chain honestly.
 *
 * It shows the beacon address (copy + explorer link), the ONE suggested minimum (D-37), and the
 * fixed-tone state copy: waiting (warn) / seen-in-mempool (accent) / funded (good) / dead-end
 * (bad) plus the terminal window-closed / blind-lapse verdicts (D-38/D-39). The recovery-key
 * disclosure is ALWAYS shown (D-40); the mainnet real-money + change-routing lines show only on
 * mainnet (D-42). The truncated-window (D-38), esplora-stale (D-43), mainnet, and recovery-key
 * disclosures stack as separate short paragraphs. Strings originate from 04-UI-SPEC.md (the
 * waiting / suggested-minimum / dead-end copy was amended by the 04-08 live-UAT gap closure to
 * make the single-payment requirement and the oldest-coin dead-end cause explicit) and are
 * em-dash-free.
 */

/** Fixed funding-state tone map (04-UI-SPEC, D-36). */
type FundingTone = 'good' | 'warn' | 'accent' | 'bad';

/** The primary state line: copy + tone for each funding state (or its terminal lapse verdict). */
function stateLine(funding: FundingView): { text: string; tone: FundingTone } {
  // A terminal lapse verdict overrides the live state (the cohort failed for want of funding).
  if (funding.terminal === 'window-closed') {
    return { text: 'The funding window closed before funds arrived.', tone: 'bad' };
  }
  if (funding.terminal === 'blind-lapse') {
    return {
      text: 'The funding window ended while this service could not observe the chain. Check the address before reusing it.',
      tone: 'warn',
    };
  }
  switch (funding.state) {
    case 'awaiting-confirmation':
      return { text: 'Funding seen in the mempool. Waiting for it to confirm.', tone: 'accent' };
    case 'funded':
      return { text: 'Funded and confirmed. This cohort can anchor on-chain.', tone: 'good' };
    case 'dead-end':
      // Plain-language WHY (04-08 live-UAT field finding): the library's coin selection is
      // deepest-first, so an inadequate FIRST send is selected forever and a later top-up
      // confirms shallower and is never picked. Say "oldest confirmed coin" (plain-first,
      // D-12), never "deepest-first selectSpendableUtxo".
      return {
        text: 'Funded below the minimum. The beacon always spends the oldest confirmed coin at this address, so topping up cannot fix this. Re-create the cohort on a fresh address.',
        tone: 'bad',
      };
    case 'waiting':
    default:
      // "one single payment" is load-bearing (04-08 live-UAT field finding): a below-minimum
      // first send permanently dead-ends the address, so the requirement must be explicit
      // BEFORE the operator sends anything.
      return {
        text: `Waiting for funds. Send at least ${funding.suggestedMinSats} sats in one single payment from your own wallet, then this stage advances automatically.`,
        tone: 'warn',
      };
  }
}

/** Tailwind text-tone class for a funding tone (matches the semantic --color-* tokens). */
const TONE_TEXT: Record<FundingTone, string> = {
  good: 'text-good',
  warn: 'text-warn',
  accent: 'text-accent',
  bad: 'text-bad',
};

/** Tailwind dot tone for the StatusDot (accent is not a StatusDot tone, so it maps to good's neutral-accent). */
const TONE_DOT: Record<FundingTone, 'good' | 'warn' | 'accent' | 'bad'> = {
  good: 'good',
  warn: 'warn',
  accent: 'accent',
  bad: 'bad',
};

export function FundingStage({ funding, activeNetwork }: { funding: FundingView; activeNetwork: string }) {
  const line = stateLine(funding);
  return (
    <Card className="space-y-4 p-5">
      <SectionTitle>Funding</SectionTitle>

      {/* Beacon address to fund (copy) + explorer link. The value is a bitcoin: URI so a wallet can
          open it directly. */}
      <CopyField
        label={`fund this cohort's beacon address (${activeNetwork})`}
        value={`bitcoin:${funding.beaconAddress}`}
      />
      {funding.explorerUrl ? (
        <a
          href={funding.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-accent underline decoration-dotted underline-offset-2 hover:brightness-110"
        >
          View on explorer
        </a>
      ) : null}

      {/* The one consistent suggested-minimum line (D-37). "in a single payment" is load-bearing:
          a below-minimum first send dead-ends the address permanently (deepest-first selection). */}
      <p className="text-sm text-muted">
        Send at least {funding.suggestedMinSats} sats to this address in a single payment.
      </p>

      {/* The primary state line, tone-coded. */}
      <div className="flex items-start gap-2">
        <span className="mt-1">
          <StatusDot tone={TONE_DOT[line.tone]} label={line.text} />
        </span>
        <p className={`text-sm ${TONE_TEXT[line.tone]}`}>{line.text}</p>
      </div>

      {/* Stacked disclosures (can co-occur): truncated window, esplora stale, recovery key, mainnet. */}
      {funding.truncatedWindowMin !== undefined ? (
        <p className="text-sm text-warn">
          This cohort's remaining lifetime shortens the funding window to about {funding.truncatedWindowMin} min.
        </p>
      ) : null}

      {funding.esploraStale && !funding.terminal ? (
        <p className="text-sm text-warn">
          This service can't observe the chain right now, so the funding state below may be stale.
        </p>
      ) : null}

      {/* Recovery-key disclosure: ALWAYS shown (D-40). */}
      {funding.recoveryKeyState === 'operator-held' ? (
        <p className="text-sm text-muted">
          Operator-held recovery key: if this cohort fails below the fallback threshold, you can recover
          funds sent to this address.
        </p>
      ) : (
        <p className="text-sm text-warn">
          Throwaway recovery key: if this cohort fails below the fallback threshold, funds sent to this
          address are unrecoverable.
        </p>
      )}

      {/* Mainnet real-money + change-routing lines (D-42), only on mainnet. */}
      {funding.mainnet ? (
        <p className="text-sm text-bad">
          Bitcoin mainnet: this address receives real funds. Change returns to the beacon address and is
          timelocked unless LIVE_CHANGE_ADDRESS redirects it.
        </p>
      ) : null}
    </Card>
  );
}
