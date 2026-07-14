import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryCohortDTO } from '../../lib/directory';

// Hermetic tests for the D-12 three-state logic (rows / empty / unreachable) without a DOM:
// the web package has no jsdom/testing-library (and this phase adds zero packages), so we
// exercise the component's exported state selector + the fetch reducer that splits the
// single `.catch`. fetchDirectory is mocked so no network is touched. The point is that a
// fetch error is NEVER conflated with the benign empty state.

vi.mock('../../lib/directory', async () => {
  const actual = await vi.importActual<typeof import('../../lib/directory')>('../../lib/directory');
  return { ...actual, fetchDirectory: vi.fn() };
});

import { fetchDirectory } from '../../lib/directory';
import { directoryView, fetchDirectoryState } from './DirectoryList';

const mockFetchDirectory = vi.mocked(fetchDirectory);

function row(over: Partial<DirectoryCohortDTO> = {}): DirectoryCohortDTO {
  return {
    cohortId: 'cohort-1',
    beaconType: 'CASBeacon',
    network: 'mutinynet',
    threshold: 3,
    capacity: 3,
    joined: 0,
    phase: 'Advertised',
    ...over,
  };
}

describe('DirectoryList - directoryView selector (D-12 states not conflated)', () => {
  it('renders the rows state when reachable with rows', () => {
    expect(directoryView(true, [row()])).toBe('rows');
  });

  it('renders the empty state when reachable with zero rows', () => {
    expect(directoryView(true, [])).toBe('empty');
  });

  it('renders loading (nothing) before the first successful fetch', () => {
    expect(directoryView(true, undefined)).toBe('loading');
  });

  it('renders the unreachable state on a fetch error - NOT empty - even with no rows', () => {
    expect(directoryView(false, undefined)).toBe('unreachable');
    expect(directoryView(false, undefined)).not.toBe('empty');
  });

  it('shows unreachable (never empty) on a transient error that follows loaded rows', () => {
    // A blip flips reachable to false while stale rows are still held; the banner wins.
    expect(directoryView(false, [row()])).toBe('unreachable');
    expect(directoryView(false, [row()])).not.toBe('empty');
  });
});

describe('DirectoryList - fetchDirectoryState reducer (splits the single .catch)', () => {
  beforeEach(() => {
    mockFetchDirectory.mockReset();
  });

  it('a resolving fetch with rows yields the rows + reachable state', async () => {
    mockFetchDirectory.mockResolvedValueOnce([row({ cohortId: 'a' }), row({ cohortId: 'b' })]);
    const s = await fetchDirectoryState('http://svc.test');
    expect(s.reachable).toBe(true);
    expect(s.rows).toHaveLength(2);
    expect(directoryView(s.reachable, s.rows)).toBe('rows');
  });

  it('a resolving fetch with [] yields the empty state and stays reachable', async () => {
    mockFetchDirectory.mockResolvedValueOnce([]);
    const s = await fetchDirectoryState('http://svc.test');
    expect(s.reachable).toBe(true);
    expect(directoryView(s.reachable, s.rows)).toBe('empty');
  });

  it('a rejecting fetch yields the unreachable state and does NOT surface the empty copy', async () => {
    mockFetchDirectory.mockRejectedValueOnce(new Error('down'));
    const s = await fetchDirectoryState('http://svc.test');
    expect(s.reachable).toBe(false);
    expect(directoryView(s.reachable, s.rows)).toBe('unreachable');
    expect(directoryView(s.reachable, s.rows)).not.toBe('empty');
  });
});
