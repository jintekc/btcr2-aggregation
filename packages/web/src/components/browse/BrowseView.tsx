import { DirectoryList } from './DirectoryList';
import { ServiceIdentityHeader } from './ServiceIdentityHeader';

/**
 * The participant landing composition (D-13): the service-identity header above the polled
 * directory list, laid out in a single column with an xl gap between the two blocks
 * (UI-SPEC Spacing). This is the front door replacing the old KeyGen-first entry.
 *
 * BrowseView is deliberately a composition shell only: the pick -> inline identity ->
 * seated -> reused-tail region is added in plan 04, which keeps the participant store as the
 * single lifecycle owner. No join/lifecycle logic lives here yet.
 */
export function BrowseView({ baseUrl }: { baseUrl: string }) {
  return (
    <div className="space-y-8">
      <ServiceIdentityHeader baseUrl={baseUrl} />
      <DirectoryList baseUrl={baseUrl} />
    </div>
  );
}
