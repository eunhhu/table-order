# Guest entry lifecycle

The printed table QR remains `/t/:qr`. That URL is an entry point, not the menu session itself.

1. `/t/:qr` creates a random browser credential and a `guest_entries` row.
2. The response stores the secret in an HttpOnly cookie scoped to that one entry API path and redirects to `/order/:qr/:entryId`.
3. The customer bootstrap temporarily exposes `/t/:qr` to the existing UI while the shared client rewrites guest API calls to the entry-specific path. Draft and pending-order localStorage keys are namespaced by `entryId`.
4. If the table already has an open visit, the new entry is bound to it. If the table is empty, the entry may wait up to 15 minutes for the party's first order.
5. First-order creation and entry binding are serialized on the same store lock used by settlement. All pending scans for that table are bound before the transaction commits.
6. A bound entry can only use its exact visit. Once that visit is no longer `open`, snapshots become read-only/ended and order writes return `VISIT_ENDED`.
7. Rescanning creates a new entry and a cookie with a different Path. The old tab therefore cannot inherit the new tab's credential even in the same browser.

Entry credentials expire after 12 hours. Expired database rows are pruned opportunistically after an additional day so old tabs can still render an ended state for a while.

The legacy guest API remains for operational compatibility, but a legacy cookie that points at a closed or expired visit is treated as a tombstone rather than falling through to the next table visit. New QR scans always use the entry-specific flow.

## Threat-model boundary

A permanent printed QR cannot prove physical presence. Anyone who deliberately reopens the original `/t/:qr` entry URL can obtain a fresh entry just like a person scanning the card at the table. This change prevents *already-issued menu sessions* and stale browser tabs from rolling forward into a later party; preventing deliberate reuse of the original QR requires an additional physical signal such as a rotating code, staff approval, NFC/BLE, or another table-local factor.
