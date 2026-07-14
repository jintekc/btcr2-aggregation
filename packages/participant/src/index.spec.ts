import { describe, expect, it } from 'vitest';
import { matchesPickedCohort } from './index.js';

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
