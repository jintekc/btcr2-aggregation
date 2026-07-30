import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CompletionSummary,
  reflectedRoundTripSentence,
} from '../src/components/cohort/CompletionSummary';
import { asRenderedText, renderStatic } from './support/render';
import type { ParticipantState } from '../src/stores/participant';

/**
 * The POSITIVE pin on the honest-success sentence of the resolve round trip
 * (`05-AUDIT-2.md` entry 19, defect #28, D-28/D-29).
 *
 * ## The pair, and why only half of it existed
 *
 * `e2e/browser-participant-cohort.ts` fails if `Your update is reflected` appears on a
 * structurally hermetic run, where the claim cannot be true. That is the dishonest direction, and
 * it is guarded. The honest direction had nothing at all: renaming this sentence, or deleting the
 * arm that renders it, makes that hermetic leg MORE green, so the only automated opinion the repo
 * held about this copy rewarded its disappearance. A live participant whose update really did land
 * would then have read the warn-toned "not found in the resolved document yet" box instead of the
 * success they earned.
 *
 * That negative assertion is deliberately untouched by this plan. The pair is the point.
 *
 * ## What this file does NOT close
 *
 * It pins the sentence, its one call site and its rendering. It does NOT prove a real live round
 * trip reaches this arm, because every browser harness in this repo is hermetic by construction:
 * with no chain there is no beacon in the resolved document, so `roundTripOutcome` can never
 * return `reflected` in any existing e2e leg. Real closure needs a live regtest browser leg, which
 * is FILED and not built:
 * `.planning/todos/pending/2026-07-30-live-regtest-browser-leg-for-the-reflected-outcome.md`.
 *
 * ## Why the render row installs the store FAKE
 *
 * `CompletionSummary` reads the participant store, and a static render takes
 * `useSyncExternalStore`'s SERVER snapshot, which zustand implements as `getInitialState()`. A
 * `useParticipant.setState` seed is therefore INVISIBLE to a render: the component would render its
 * pre-resolve state and the reflected row would pass or fail for reasons unrelated to the arm under
 * test. See the trap section of `packages/web/tests/support/render.tsx`. The fixture is installed
 * through `selectorFake` with the hoisting recipe from that docstring, and it is TYPED as a partial
 * of the exported participant state so a misspelled key is a compile error rather than a silent
 * `undefined`.
 *
 * The fixture's `network` carries a REAL registry name because the component resolves it through
 * `resolveNetwork` (twice), and an unknown value does not render.
 *
 * The file is `.ts` rather than `.tsx` and builds its trees with `createElement`, matching
 * `packages/web/tests/lifecycle.spec.ts`.
 */

const participantFixture: { current: Partial<ParticipantState> } = { current: {} };

vi.mock('../src/stores/participant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/stores/participant')>();
  const { selectorFake } = await import('./support/render');
  return { ...actual, useParticipant: selectorFake(() => participantFixture.current) };
});

const DID = 'did:btcr2:k1qqpz8xw0c9k3lm2n4v6r8t0y2u4i6o8a0s2d4f6g8h0j2k4l6m8n0p2q4r6s8t0';

/** The exact hermetic-genesis sentence, the contrast arm this file uses as its control. */
const HERMETIC_GENESIS_OPENING = 'Resolved to the genesis document.';

/**
 * A settled, INCLUDED cohort result. Only `included` and `beaconType` are read by the surfaces
 * this file reaches; the rest is filled honestly rather than cast away.
 */
const RESULT: ParticipantState['result'] = {
  cohortId: 'c0ffee00-1111-2222-3333-444455556666',
  beaconAddress: 'tb1pexampleexampleexampleexampleexampleexampleexampleexamplex',
  beaconType: 'CASBeacon',
  included: true,
  announcementEntries: 2,
  updateHashHex: 'ab'.repeat(32),
};

/**
 * Seed the fixture and render the completion summary.
 *
 * `beaconPresent` decides whether the resolved document carries THIS DID's aggregate beacon, and
 * `anchorEnabled` whether the service broadcasts. Those are exactly the two inputs
 * `roundTripOutcome` reads, so the two rows below differ in the facts the outcome is computed
 * from rather than in anything the test asserts directly.
 */
function summary(input: { beaconPresent: boolean; anchorEnabled: boolean; version?: string }): string {
  participantFixture.current = {
    result: RESULT,
    did: DID,
    // A REAL registry network: the component resolves it through `resolveNetwork` for the anchor
    // narration and again inside the registration stage.
    network: 'signet',
    sidecar: null,
    fallbackObserved: false,
    nonInclusionReason: null,
    cohortThreshold: null,
    cohortCapacity: null,
    resolveStatus: 'resolved',
    resolveError: null,
    // EXTERNAL keeps the KEY-only registration stage (and its funding surface) out of the render;
    // it is not the subject here and it is covered elsewhere.
    idType: 'EXTERNAL',
    regStatus: 'idle',
    anchor: input.anchorEnabled ? { enabled: true, state: 'confirmed' } : { enabled: false, state: 'none' },
    resolution: {
      didDocument: {
        id: DID,
        service: input.beaconPresent
          ? [{ id: `${DID}#beacon-cas`, type: 'CASBeacon', serviceEndpoint: 'bitcoin:tb1pexample' }]
          : [],
      },
      didDocumentMetadata: { versionId: input.version ?? '2' },
    },
  };
  return renderStatic(createElement(CompletionSummary, { baseUrl: 'http://svc.example', onBrowse: () => {} }));
}

describe('the honest-success sentence has ONE definition and ONE call site (audit #28)', () => {
  const SRC = readFileSync(
    fileURLToPath(new URL('../src/components/cohort/CompletionSummary.tsx', import.meta.url)),
    'utf8',
  );

  it('reads exactly as it did before the extraction, with and without a version', () => {
    // The words, pinned. This is the assertion a rename has to get past, and it is the one the
    // hermetic browser leg's negative guard can never supply.
    expect(reflectedRoundTripSentence('2')).toBe(
      "Your update is reflected. The resolved DID document now lists this cohort's beacon service (version 2).",
    );
    // The version clause is optional and its LEADING SPACE belongs to the clause, not to the
    // sentence: the JSX this replaced concatenated a text child with no trailing space against an
    // interpolation that supplied one, so a space left behind here would be a visible change.
    expect(reflectedRoundTripSentence()).toBe(
      "Your update is reflected. The resolved DID document now lists this cohort's beacon service.",
    );
    expect(reflectedRoundTripSentence()).not.toMatch(/ \.$/);
  });

  it('is defined once and called once, so the pinned sentence is the shipped sentence', () => {
    // Two occurrences of the identifier in the whole component: the definition and the single call
    // site. A second arm rendering its own copy of these words would be invisible to the row above,
    // which is the failure mode this count exists for. Deleting the arm takes the call site with
    // it and reddens this row.
    expect(SRC.split('reflectedRoundTripSentence').length - 1).toBe(2);
    expect(SRC).toMatch(/export function reflectedRoundTripSentence\(/);
    expect(SRC).toMatch(/\{reflectedRoundTripSentence\(version\)\}/);
  });

  it('keeps no second copy of the words anywhere in the component', () => {
    // The builder holds the only literal. A copy left behind in a JSX arm would keep the rendered
    // page working while making the pin above a pin on dead code.
    expect(SRC.split('Your update is reflected').length - 1).toBe(1);
  });
});

describe('CompletionSummary RENDERS that sentence on a reflected round trip (audit #28)', () => {
  it('renders the honest-success copy when the beacon is in the document and the service broadcasts', () => {
    const html = summary({ beaconPresent: true, anchorEnabled: true, version: '2' });
    // `asRenderedText` runs the copy through React's own escaping, so the apostrophe is compared
    // the way the browser receives it rather than against a second escaping table that could drift.
    expect(html).toContain(asRenderedText(reflectedRoundTripSentence('2')));
    // ...and the arm really is the reflected one, not the warn-toned fallback wearing the same words.
    expect(html).not.toContain('not found in the resolved document yet');
  });

  it('renders the hermetic-genesis arm instead when the service never broadcasts (the control)', () => {
    // The anti-vacuity row. A different fixture produces different output, so the row above is
    // measuring the arm rather than passing against whatever this component happens to render. It
    // also proves the reflected pin is not matching the hermetic sentence: the two arms are
    // distinct copy for distinct outcomes, and the hermetic one is EXPECTED rather than a failure.
    const html = summary({ beaconPresent: false, anchorEnabled: false });
    expect(html).toContain(HERMETIC_GENESIS_OPENING);
    expect(html).not.toContain('Your update is reflected');
  });

  it('renders neither success arm when the anchor is live but the beacon has not appeared yet', () => {
    // The third outcome `roundTripOutcome` can produce. Without it, a mutation that made the
    // reflected arm the DEFAULT would still satisfy both rows above.
    const html = summary({ beaconPresent: false, anchorEnabled: true });
    expect(html).not.toContain('Your update is reflected');
    expect(html).not.toContain(HERMETIC_GENESIS_OPENING);
    expect(html).toContain('not found in the resolved document yet');
  });
});
