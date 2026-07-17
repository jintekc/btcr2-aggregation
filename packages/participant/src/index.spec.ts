import { describe, expect, it } from 'vitest';
import { createIdentity } from '@btcr2-aggregation/shared';
import { createUpdateProvider, matchesPickedCohort, type SubmitGateInfo } from './index.js';

// Unit coverage of the single PART-02 browse-and-pick mechanism (D-14): the pure
// predicate that narrows the participant runner's shouldJoin from "accept every
// advert" to "accept only the picked cohortId". Kept hermetic on purpose - a
// pure-function test with no runner, no transport, and no network - because the
// selectivity guarantee this predicate encodes is exactly what the e2e capstone
// then proves end to end over real HTTP.

describe('matchesPickedCohort (join-by-filter predicate)', () => {
  const advertCohortId = 'cohort-abc';

  it('joins when the picked cohortId matches the advert cohortId', () => {
    expect(matchesPickedCohort(advertCohortId, advertCohortId)).toBe(true);
  });

  it('skips when the picked cohortId does not match the advert cohortId', () => {
    expect(matchesPickedCohort('cohort-other', advertCohortId)).toBe(false);
  });

  it('joins any advert when no cohortId was picked (legacy accept-all, not relied on in Phase 2)', () => {
    expect(matchesPickedCohort(undefined, advertCohortId)).toBe(true);
    expect(matchesPickedCohort(undefined, 'cohort-anything-else')).toBe(true);
  });
});

// PART-03 explicit-submit gate (D-12). The runner's onProvideUpdate is internal, so
// we exercise the extracted seam (createUpdateProvider) directly with a real KEY
// identity and the SAME kind of capture maps createParticipant hands its
// getSubmittedUpdate / getDeclineReason accessors. Hermetic on purpose: a KEY update
// resolves deterministically from the public key and signs locally, so there is no
// runner, transport, or network here - exactly the contract the 03-04 store depends on.
describe('createParticipant explicit submit gate (createUpdateProvider)', () => {
  // Any string is fine for the 'append' path: it is only interpolated into the
  // appended service's `bitcoin:<addr>` endpoint, never decoded (only the unused
  // exit-ramp path derives an address). Kept descriptive, not a real funded address.
  const BEACON_ADDRESS = 'tb1p-cohort-aggregate-beacon-example-address';

  it('with onSubmitGate: builds the body once, defers the submit until the gate resolves, and the previewed body is the submitted body', async () => {
    const identity = createIdentity();
    const cohortId = 'cohort-gate';
    const submittedUpdates = new Map<string, SubmitGateInfo['update']>();
    const declinedCohorts = new Map<string, string>();

    let previewed: SubmitGateInfo | undefined;
    let releaseGate!: () => void;
    const userDecision = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const provideUpdate = createUpdateProvider({
      did: identity.did,
      keys: identity.keys,
      defaultBeaconType: 'CASBeacon',
      cohortBeaconTypes: new Map([[cohortId, 'CASBeacon']]),
      submittedUpdates,
      declinedCohorts,
      onSubmitGate: async (info) => {
        previewed = info;
        await userDecision;
      },
    });

    const pending = provideUpdate({ cohortId, beaconAddress: BEACON_ADDRESS });

    // The gate has been offered the fully built body, but nothing is submitted yet -
    // the participant is waiting on the user's consent, not a rebuild.
    expect(previewed).toBeDefined();
    expect(previewed).toMatchObject({ cohortId, beaconAddress: BEACON_ADDRESS, beaconType: 'CASBeacon' });
    expect(submittedUpdates.has(cohortId)).toBe(false);

    releaseGate();
    const returned = await pending;

    // build-once / precision: the exact object previewed to the gate is the object
    // recorded and returned to the runner (identity equality), never re-signed - a
    // rebuild would change the BIP340 canonical hash and break the resolve round-trip.
    expect(previewed!.update).toBe(returned);
    expect(submittedUpdates.get(cohortId)).toBe(previewed!.update);
  });

  it('without onSubmitGate: auto-submits without awaiting any external signal (byte-identical to today)', async () => {
    const identity = createIdentity();
    const cohortId = 'cohort-auto';
    const submittedUpdates = new Map<string, SubmitGateInfo['update']>();

    const provideUpdate = createUpdateProvider({
      did: identity.did,
      keys: identity.keys,
      defaultBeaconType: 'CASBeacon',
      cohortBeaconTypes: new Map(),
      submittedUpdates,
      declinedCohorts: new Map<string, string>(),
      // no onSubmitGate: the historical auto-submit path.
    });

    // Resolves on its own with no external signal to await, and the returned body is
    // exactly what was recorded for getSubmittedUpdate to read back.
    const returned = await provideUpdate({ cohortId, beaconAddress: BEACON_ADDRESS });
    expect(returned).not.toBeNull();
    expect(submittedUpdates.get(cohortId)).toBe(returned);
  });

  it('declines a baked mismatch BEFORE ever offering the gate (cooperative non-inclusion, D-15/D-19)', async () => {
    const identity = createIdentity();
    const cohortId = 'cohort-mismatch';
    const submittedUpdates = new Map<string, SubmitGateInfo['update']>();
    const declinedCohorts = new Map<string, string>();
    let gateCalled = false;

    // A genesis that bakes an aggregate CAS beacon at a DIFFERENT address than this
    // cohort's: classifyCohortFit returns 'mismatch', so the identity must decline.
    const genesisDocument = {
      service: [
        {
          id: 'did:btcr2:_#beacon-cas',
          type: 'CASBeacon',
          serviceEndpoint: 'bitcoin:tb1p-some-other-cohort-beacon-address',
        },
      ],
    };

    const provideUpdate = createUpdateProvider({
      did: identity.did,
      keys: identity.keys,
      genesisDocument,
      defaultBeaconType: 'CASBeacon',
      cohortBeaconTypes: new Map([[cohortId, 'CASBeacon']]),
      submittedUpdates,
      declinedCohorts,
      onSubmitGate: async () => {
        gateCalled = true;
      },
    });

    const returned = await provideUpdate({ cohortId, beaconAddress: BEACON_ADDRESS });

    expect(returned).toBeNull();
    // The decline runs first, so a submit window is never offered and no body is built.
    expect(gateCalled).toBe(false);
    expect(submittedUpdates.has(cohortId)).toBe(false);
    expect(declinedCohorts.get(cohortId)).toMatch(/declining \(cooperative non-inclusion\)/);
  });
});
