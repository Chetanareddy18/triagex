import type { Category, Channel } from '../lib/domain.js';

export interface Template {
  title: string;
  description: string;
  category: Category;
  impact: 1 | 2 | 3;
  urgency: 1 | 2 | 3;
  channel: Channel;
  resolution: string;
  tags?: string[];
}

export const SERVICES = ['checkout-api', 'billing-worker', 'search-service', 'auth-gateway', 'notifications', 'reporting-db', 'payments-api', 'mobile-bff'];
export const OFFICES = ['Hyderabad', 'Bengaluru', 'Pune', 'remote'];
export const HOSTS = ['db-primary-01', 'db-replica-02', 'k8s-node-07', 'k8s-node-12', 'redis-cache-03', 'vpn-gw-01', 'mail-relay-02'];

/** `{service}`, `{office}`, `{host}` and `{n}` are filled in by the seeder. */
export const TEMPLATES: Template[] = [
  {
    title: '{service} returning 5xx for a subset of requests',
    description: 'Error rate on {service} jumped from 0.2% to 7% after the 14:00 deploy. Customers see "Something went wrong" intermittently. Rollback not attempted yet.',
    category: 'software', impact: 1, urgency: 2, channel: 'monitoring',
    resolution: 'Rolled back the release; a missing feature-flag default caused null dereferences. Fix merged with a regression test.',
    tags: ['deploy'],
  },
  {
    title: 'Checkout outage - payments failing for all users',
    description: 'Every card payment fails at the final step with a gateway timeout. Revenue impacting. Status page updated.',
    category: 'software', impact: 1, urgency: 1, channel: 'monitoring',
    resolution: 'Payment provider rotated their TLS certificate chain; our pinned intermediate was outdated. Updated trust store and removed pinning.',
    tags: ['payments', 'customer-facing'],
  },
  {
    title: 'Replication lag on {host} above 15 minutes',
    description: 'Read replica {host} is lagging; reporting dashboards show stale numbers. Long-running analytics query suspected.',
    category: 'database', impact: 2, urgency: 2, channel: 'monitoring',
    resolution: 'Killed a runaway analytics query holding locks, added statement timeout for the reporting role.',
  },
  {
    title: 'Database deadlocks on order updates',
    description: 'Deadlock errors spiked on the orders table during the flash sale. Some orders stuck in "processing".',
    category: 'database', impact: 1, urgency: 2, channel: 'email',
    resolution: 'Reordered row updates in the order service to a consistent lock order; re-queued stuck orders.',
  },
  {
    title: 'VPN disconnects every few minutes for {office} staff',
    description: 'Multiple users in {office} report the VPN tunnel drops every 5-10 minutes, breaking SSH and RDP sessions.',
    category: 'network', impact: 2, urgency: 1, channel: 'portal',
    resolution: 'MTU mismatch after ISP change; set MSS clamping on {host} and pushed updated client profile.',
    tags: ['vpn'],
  },
  {
    title: 'Wi-Fi extremely slow on the 3rd floor in {office}',
    description: 'Speed tests show < 2 Mbps on the 3rd floor since Monday. Video calls keep freezing.',
    category: 'network', impact: 2, urgency: 2, channel: 'portal',
    resolution: 'One access point was on a congested channel after a firmware reset; re-ran channel planning.',
  },
  {
    title: 'DNS resolution failures for internal services',
    description: 'Intermittent NXDOMAIN for *.internal hostnames from k8s pods. Services fail health checks randomly.',
    category: 'network', impact: 1, urgency: 2, channel: 'monitoring',
    resolution: 'CoreDNS pods were CPU-throttled; raised limits and enabled node-local DNS cache.',
  },
  {
    title: 'Cannot log in after MFA reset',
    description: 'After resetting my authenticator app I am locked out of SSO. Error: "Invalid verification code".',
    category: 'access', impact: 3, urgency: 1, channel: 'portal',
    resolution: 'Re-enrolled MFA device after identity verification; device clock drift was also corrected.',
  },
  {
    title: 'Multiple users locked out of SSO',
    description: 'Around 30 users across teams are locked out after the password policy change. Login page loops back.',
    category: 'access', impact: 1, urgency: 1, channel: 'phone',
    resolution: 'Policy change invalidated sessions without notice; restored grace period and sent reset links.',
  },
  {
    title: 'Access request: read-only access to {service} logs',
    description: 'Need read-only access to production logs for {service} to debug a customer ticket.',
    category: 'access', impact: 3, urgency: 3, channel: 'portal',
    resolution: 'Granted time-boxed read-only role (7 days) after manager approval.',
  },
  {
    title: 'Laptop battery swelling',
    description: 'My laptop trackpad is lifting and the battery seems swollen. Not safe to keep using.',
    category: 'hardware', impact: 3, urgency: 2, channel: 'portal',
    resolution: 'Replaced device from spare pool; old unit sent for safe battery disposal.',
  },
  {
    title: 'External monitor not detected via dock',
    description: 'Since the latest OS update the USB-C dock no longer drives my external monitor.',
    category: 'hardware', impact: 3, urgency: 3, channel: 'portal',
    resolution: 'Installed updated dock firmware and display driver.',
  },
  {
    title: 'Printer on floor 2 jams on every job',
    description: 'The shared printer jams on every print job; we have client documents due today.',
    category: 'hardware', impact: 3, urgency: 2, channel: 'phone',
    resolution: 'Replaced worn pickup roller; cleared paper path.',
  },
  {
    title: 'Outlook not syncing calendar invites',
    description: 'Meeting invites sent from Outlook do not appear in attendees\' calendars. Started this morning.',
    category: 'email', impact: 2, urgency: 2, channel: 'email',
    resolution: 'Corrupted local cache; rebuilt profile. Tenant-side issue ruled out.',
  },
  {
    title: 'Outbound email delayed by over an hour',
    description: 'Customer notification emails from {service} are arriving 60-90 minutes late. Queue on {host} growing.',
    category: 'email', impact: 2, urgency: 1, channel: 'monitoring',
    resolution: 'Relay {host} was rate-limited by the provider after a bounce spike; cleaned list and raised quota.',
  },
  {
    title: 'Suspicious phishing email impersonating finance',
    description: 'Several employees received an email asking to "verify payroll details" with a lookalike domain. Two clicked the link.',
    category: 'security', impact: 1, urgency: 1, channel: 'email',
    resolution: 'Blocked sender domain, purged messages tenant-wide, reset credentials for the two users, no data exfiltration found.',
    tags: ['phishing'],
  },
  {
    title: 'Critical CVE in base container image',
    description: 'Scanner flagged a critical OpenSSL CVE in the base image used by {service} and three other services.',
    category: 'security', impact: 2, urgency: 1, channel: 'monitoring',
    resolution: 'Rebuilt images on patched base, redeployed; added weekly base-image rebuild job.',
    tags: ['cve'],
  },
  {
    title: 'Unauthorized login attempts on admin console',
    description: 'Hundreds of failed admin logins from a single IP range over the last hour.',
    category: 'security', impact: 2, urgency: 1, channel: 'monitoring',
    resolution: 'Blocked range at WAF, enforced MFA for all admin accounts, confirmed no successful logins.',
  },
  {
    title: '{service} p95 latency degraded to 4s',
    description: 'p95 latency on {service} went from 300ms to 4s. Users report slow page loads. CPU looks normal.',
    category: 'software', impact: 2, urgency: 1, channel: 'monitoring',
    resolution: 'Connection pool exhaustion after traffic growth; increased pool size and fixed a leaked connection in the retry path.',
  },
  {
    title: 'Mobile app crashes on launch for Android 14 users',
    description: 'Crash reports show a startup crash on Android 14 after release 5.2.0.',
    category: 'software', impact: 1, urgency: 2, channel: 'monitoring',
    resolution: 'Hotfix 5.2.1 guards a deprecated API call; staged rollout completed.',
  },
  {
    title: 'Excel add-in fails to load',
    description: 'The finance Excel add-in shows "Add-in error" for me and two colleagues since yesterday.',
    category: 'software', impact: 3, urgency: 2, channel: 'portal',
    resolution: 'Add-in manifest pointed to an expired certificate; republished with new certificate.',
  },
  {
    title: 'Nightly backup job failed on {host}',
    description: 'The nightly backup for {host} failed with "snapshot quota exceeded". Last good backup is 36h old.',
    category: 'database', impact: 2, urgency: 2, channel: 'monitoring',
    resolution: 'Raised snapshot quota, pruned old snapshots, re-ran backup and verified restore on staging.',
  },
  {
    title: 'Disk almost full on {host}',
    description: 'Disk usage on {host} at 93% and climbing ~1%/hour. Logs not rotating.',
    category: 'hardware', impact: 2, urgency: 1, channel: 'monitoring',
    resolution: 'Fixed logrotate config, compressed old logs, added disk usage alert at 80%.',
  },
  {
    title: 'Typo on the pricing page',
    description: 'The pricing page says "anually" instead of "annually".',
    category: 'software', impact: 3, urgency: 3, channel: 'email',
    resolution: 'Corrected copy and added spell-check to the CMS publishing step.',
  },
  {
    title: 'Request: new laptop for incoming hire',
    description: 'New engineer joining {office} next Monday needs a standard developer laptop.',
    category: 'hardware', impact: 3, urgency: 3, channel: 'portal',
    resolution: 'Provisioned and enrolled device; delivered to {office} office.',
  },
  {
    title: 'Kubernetes node {host} NotReady',
    description: 'Node {host} flapping between Ready and NotReady, pods being evicted.',
    category: 'hardware', impact: 2, urgency: 1, channel: 'monitoring',
    resolution: 'Kubelet OOM due to log volume; drained node, replaced it, and set eviction thresholds.',
  },
  {
    title: 'Search results missing recently added products',
    description: 'Products created in the last 2 days do not show up in search. Indexing job may be stuck.',
    category: 'software', impact: 2, urgency: 2, channel: 'email',
    resolution: 'Indexer consumer crashed on a malformed record; added dead-letter queue and reindexed.',
  },
  {
    title: 'Shared drive permissions reset for marketing',
    description: 'Marketing team lost write access to the shared campaign drive this morning.',
    category: 'access', impact: 2, urgency: 2, channel: 'phone',
    resolution: 'Group sync job removed a nested group; restored membership and fixed sync filter.',
  },
];

/** Extra context appended to descriptions so repeated templates read differently. */
export const DETAILS = [
  'First noticed around {time}.',
  'Roughly {n} people affected so far.',
  'Started shortly after the morning change window.',
  'Reported by the {office} team.',
  'No workaround found yet.',
  'Restarting did not help.',
  'Seems to get worse during peak hours.',
  '',
];

export const COMMENTS = {
  agent: [
    'Looking into this now.',
    'Can you share a screenshot of the error and the time it happened?',
    'I can reproduce this on my side, investigating the logs.',
    'Workaround in place while we work on a permanent fix.',
    'Escalated to the platform team for a second pair of eyes.',
    'Fix deployed, monitoring for the next 30 minutes.',
  ],
  internal: [
    'Looks related to yesterday\'s change on the gateway - checking the diff.',
    'Customer is on the enterprise plan, keep them updated hourly.',
    'Same root cause as the incident last week; linking for the postmortem.',
  ],
  reporter: [
    'Thanks, still happening for me.',
    'Attached the screenshot. It started around 10am.',
    'Confirmed working now, thank you!',
    'Any update? This is blocking our release.',
  ],
};
