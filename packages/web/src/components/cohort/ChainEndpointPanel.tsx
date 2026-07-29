import { useState } from 'react';
import { useParticipant } from '../../stores/participant';
import { Button, Expander, Field, Input, Mono } from '../../ui/primitives';

/**
 * The participant's own chain-read source (PART-05, D-20, UI-SPEC E16).
 *
 * An advanced disclosure, collapsed by default, because the shipped same-origin proxy is
 * the zero-config default and always will be (ADR 0003): a participant who never opens
 * this panel is not missing a setting, they are using the working one. That is why the
 * unset state renders a sentence saying so rather than an empty field with no context.
 *
 * The four failure messages below are four on purpose. A participant reading "something
 * went wrong" cannot decide what to do; a participant told their endpoint refuses browser
 * requests knows to pick another one, and one told the endpoint is on another chain knows
 * their endpoint is fine but pointed at the wrong network. Nothing here switches back on
 * its own either: the participant chose a trust source, so leaving it is an explicit act,
 * and the browser-rejected case renders WITH that button as the offered next step.
 *
 * Setting and clearing take no confirmation. Both are reversible, and spending ceremony on
 * a reversible act would dilute the ladder that Cancel cohort depends on (UI-SPEC).
 */

/** The disclosure title (UI-SPEC E16). */
const TITLE = 'Chain endpoint';

/** Unset state: empty reads as the working default, not as a missing setting. */
const DEFAULT_STATE_LINE =
  'This browser reads the chain through this service. That is the default and needs no setup.';

const FIELD_LABEL = 'Esplora endpoint (optional)';
const FIELD_PLACEHOLDER = 'https://esplora.example.com';
const FIELD_HELP =
  'Set your own esplora endpoint to read the chain directly instead of through this service.';

const USE_ENDPOINT_LABEL = 'Use this endpoint';
/** The explicit switch back. Never taken automatically. */
const USE_SERVICE_LABEL = "Use this service's chain reads";

/** In-flight label: neutral, and claiming no result until the probe returns. */
const PROBING_LINE = 'Checking this endpoint…';

const BROADCAST_OPT_IN_LABEL = 'Also broadcast my transactions through this endpoint.';
const BROADCAST_OPT_IN_HELP =
  'Off by default. While it is off, your registration transaction is still relayed through this service.';

/** A browser refusing the cross-origin request. Distinct from a host that is not there. */
const BROWSER_REJECTED_MESSAGE =
  "This endpoint does not allow browser requests, so it can't be used from here.";
const UNREACHABLE_MESSAGE = "Couldn't reach that endpoint.";
const MALFORMED_MESSAGE = 'Enter a full https URL, for example https://esplora.example.com.';

/** The wrong-chain refusal names BOTH chains, because either one could be the mistake. */
function mismatchMessage(theirNetwork: string, ourNetwork: string): string {
  return `That endpoint is on ${theirNetwork}, but this service is on ${ourNetwork}. It was not used.`;
}

/** Active state. The host renders through Mono and truncates (UI-SPEC E16 long-text). */
const ACTIVE_PREFIX = 'Reading the chain from ';

/**
 * The independent-check caption. The service's anchor read is keyed by COHORT id and an
 * esplora endpoint has no notion of a cohort, so this states plainly what the endpoint
 * did and did not replace.
 */
const ANCHOR_NOT_REPLACED_LINE =
  "This service still reports this cohort's anchor. Your endpoint only double-checks a transaction it named.";
const TX_SEEN_LINE = 'Your endpoint sees this transaction in a block.';
const TX_UNSEEN_LINE = 'Your endpoint has not seen this transaction yet.';

/** The host of an endpoint, falling back to the whole value if it will not parse. */
function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

export function ChainEndpointPanel() {
  const endpoint = useParticipant((s) => s.chainEndpoint);
  const verdict = useParticipant((s) => s.chainEndpointVerdict);
  const probing = useParticipant((s) => s.chainEndpointProbing);
  const broadcastDirect = useParticipant((s) => s.broadcastDirect);
  const txConfirmed = useParticipant((s) => s.endpointTxConfirmed);
  const useChainEndpoint = useParticipant((s) => s.useChainEndpoint);
  const clearChainEndpoint = useParticipant((s) => s.clearChainEndpoint);
  const setBroadcastDirect = useParticipant((s) => s.setBroadcastDirect);

  // The typed value is local: only an ACCEPTED endpoint reaches the store, so what the
  // participant is editing and what the browser is actually reading from stay distinct.
  const [draft, setDraft] = useState('');

  const failure =
    verdict && verdict.kind !== 'ok'
      ? verdict.kind === 'mismatch'
        ? mismatchMessage(verdict.theirNetwork, verdict.ourNetwork)
        : verdict.kind === 'browser-rejected'
          ? BROWSER_REJECTED_MESSAGE
          : verdict.kind === 'unreachable'
            ? UNREACHABLE_MESSAGE
            : MALFORMED_MESSAGE
      : null;

  return (
    <Expander title={TITLE}>
      <div className="space-y-3">
        {endpoint ? (
          <p className="flex min-w-0 items-baseline gap-1 text-sm text-ink">
            <span className="shrink-0">{ACTIVE_PREFIX}</span>
            <Mono className="min-w-0 truncate">{hostOf(endpoint)}</Mono>
            <span className="shrink-0">.</span>
          </p>
        ) : (
          <p className="text-sm text-muted">{DEFAULT_STATE_LINE}</p>
        )}

        <Field label={FIELD_LABEL} htmlFor="chain-endpoint">
          <Input
            id="chain-endpoint"
            value={draft}
            onChange={setDraft}
            placeholder={FIELD_PLACEHOLDER}
            disabled={probing}
            autoComplete="off"
          />
        </Field>
        <p className="text-xs text-faint">{FIELD_HELP}</p>

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={probing} onClick={() => void useChainEndpoint(draft)}>
            {USE_ENDPOINT_LABEL}
          </Button>
          {endpoint ? (
            <Button variant="ghost" disabled={probing} onClick={clearChainEndpoint}>
              {USE_SERVICE_LABEL}
            </Button>
          ) : null}
        </div>

        {probing ? <p className="text-sm text-muted">{PROBING_LINE}</p> : null}

        {/* Each verdict renders its OWN message, never a shared generic one. The
            browser-rejected case sits beside the switch-back button above, which is the
            offered next step; the app itself never takes it. */}
        {!probing && failure ? <p className="text-sm text-bad">{failure}</p> : null}

        {endpoint ? (
          <div className="space-y-1">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={broadcastDirect}
                onChange={(e) => setBroadcastDirect(e.target.checked)}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>{BROADCAST_OPT_IN_LABEL}</span>
            </label>
            <p className="text-xs text-faint">{BROADCAST_OPT_IN_HELP}</p>
          </div>
        ) : null}

        {endpoint ? (
          <div className="space-y-1">
            <p className="text-xs text-faint">{ANCHOR_NOT_REPLACED_LINE}</p>
            {txConfirmed === null ? null : (
              <p className="text-sm text-muted">{txConfirmed ? TX_SEEN_LINE : TX_UNSEEN_LINE}</p>
            )}
          </div>
        ) : null}
      </div>
    </Expander>
  );
}
