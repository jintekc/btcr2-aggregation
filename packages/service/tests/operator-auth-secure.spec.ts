import { buildCohortConfig, createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { createService } from '../src/index.js';
import { SESSION_COOKIE } from '../src/operator-auth.js';

/**
 * The `Secure` attribute on the operator session cookie, exercised in BOTH directions through a
 * real service boot.
 *
 * ## This row is an ADJACENT hardening row, not one of the 24 confirmed defects
 *
 * `05-AUDIT-2.md` entry 24 reports defect #3, the unasserted operator console heading. This is the
 * higher-value gap it names beside that defect, and it is labelled adjacent here on purpose so the
 * round's defect count is not inflated by it. It earned a place anyway for three reasons:
 *
 *  1. `secure: cookieSecure` (`packages/service/src/operator-auth.ts`) is the attribute that keeps
 *     the operator's session identifier off plaintext HTTP. Losing it is a session-theft path, not
 *     a cosmetic regression.
 *  2. It DEFAULTS ON at boot (`cookieSecure: opts.operatorCookieSecure ?? true` in
 *     `packages/service/src/index.ts`), so a production self-host inherits it without asking.
 *  3. None of the fourteen call sites that construct an operator auth config ever exercises it
 *     true. Every one of them passes `cookieSecure: false`, because they drive plain HTTP, and the
 *     one existing cookie assertion (`packages/service/src/operator-auth.spec.ts`) checks
 *     `HttpOnly`, `SameSite=Strict` and `Path=/` and stops there. Deleting the attribute, or
 *     hardcoding it to false, shipped green.
 *
 * ## Why this boots a real service rather than composing the handler
 *
 * The rule under test spans two files: `index.ts` decides the flag's value from the boot option
 * (including its default), and `operator-auth.ts` puts it on the wire. A test that calls
 * `loginHandler({ cookieSecure: true })` directly proves only the second half, which is the same
 * shape of gap 05-26 closed for the discovery-window ceiling. So each row here boots a real
 * `createService` on an ephemeral port and reads the attribute off a real login response.
 *
 * The OFF row is what makes the ON row mean something: without it a hardcoded `secure: true`
 * would satisfy the ON row exactly as well as reading the flag does.
 *
 * Spec file lives under `packages/service/tests/` (tests-outside-src convention).
 */

const PASSWORD = 'correct-horse-battery-staple';
const ACTIVE_NETWORK = 'signet';

/**
 * Boot a real service with the given cookie-secure setting, sign in over real HTTP, and hand the
 * raw `Set-Cookie` header to `body`. Nothing is mocked and nothing is injected past the public
 * boot option, so the whole path from `createService`'s option handling to the response header is
 * the thing under test.
 */
async function loginSetCookie(
  opts: { operatorCookieSecure?: boolean },
  body: (setCookie: string) => void,
): Promise<void> {
  const service = createService({
    identity: createIdentity(resolveNetwork(ACTIVE_NETWORK)),
    config: buildCohortConfig(2, 'CASBeacon', ACTIVE_NETWORK),
    operatorPassword: PASSWORD,
    cohortTtlMs: 60_000,
    ...opts,
  });
  try {
    const { baseUrl } = await service.start(0);
    const res = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    // The header really is the session cookie, so an assertion below cannot pass against some
    // other cookie this service happened to set.
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    body(setCookie);
  } finally {
    await service.stop();
  }
}

describe('the operator session cookie carries Secure when the boot asks for it (adjacent to audit #3)', () => {
  it('sets Secure on a boot that enables it, alongside the three attributes already covered', async () => {
    await loginSetCookie({ operatorCookieSecure: true }, (setCookie) => {
      // The attribute this file exists for. A session identifier without it travels on plaintext
      // HTTP the first time an operator reaches the console over http:// behind a proxy.
      expect(setCookie).toMatch(/;\s*Secure/i);
      // Asserted beside the three the existing row covers, so this file reads as the complete
      // cookie contract rather than as one attribute in isolation.
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
      expect(setCookie).toMatch(/Path=\//i);
    });
  });

  it('omits Secure on a boot that disables it, so the row reads the flag rather than a constant', async () => {
    await loginSetCookie({ operatorCookieSecure: false }, (setCookie) => {
      // The control. `operatorCookieSecure: false` is what every local and hermetic harness in this
      // repo passes, because a Secure cookie is dropped by browsers on plain http:// origins; if
      // this row ever went green with the attribute present, the local browser legs would silently
      // stop being able to sign in.
      expect(setCookie).not.toMatch(/;\s*Secure/i);
      // The rest of the contract is unchanged by the flag: only ONE attribute moves between the
      // two rows, so the pair isolates it.
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
    });
  });

  it('defaults Secure ON when the boot says nothing, which is what a self-host inherits', async () => {
    await loginSetCookie({}, (setCookie) => {
      // `opts.operatorCookieSecure ?? true` in `index.ts`. A default that flipped to off would be
      // invisible to every other test in the repo, because they all pass the option explicitly.
      expect(setCookie).toMatch(/;\s*Secure/i);
    });
  });
});
