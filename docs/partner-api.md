# ArchiveCore partner API (v1)

The partner API is read-only and exposes **order statuses only**. It never returns
document contents, personal data, or physical warehouse locations.

## Access

An authorized tenant administrator or Doxart administrator selects the tenant in
ArchiveCore, opens **Settings > Integrations**, and creates a key. The secret is
displayed once. Store it in the client system's secret manager, not in browser
code or a repository. Keys expire after 30, 90, or 365 days and can be revoked
immediately from the same screen. Each key is bound to exactly one tenant.
After the deployment that introduces the Integrations tab, existing users may
need to sign out and in again to refresh their role permissions.

Send the secret as a bearer token over HTTPS:

```http
Authorization: Bearer ac_live_<secret>
```

The normal ArchiveCore login token and `X-Tenant-Id` header do not grant access
to `/api/v1`. The tenant is determined only by the integration key. Responses
use `Cache-Control: no-store` and are rate-limited per source IP.

## Endpoints

`GET /api/v1/orders?limit=50&status=submitted&cursor=<order-uuid>` returns
`{ "success": true, "data": { "orders": [...], "nextCursor": "..." } }`.
`limit` defaults to 50 and may be 1-100. `status` and `cursor` are optional.
Use `nextCursor` for the next page; `null` means the list is complete.

`GET /api/v1/orders/:id` returns one order owned by the key's tenant. An ID
belonging to another tenant returns 404.

An order contains only `id`, `orderNumber`, `orderType`, `status`, `priority`,
`createdAt`, `updatedAt`, `completedAt`, and `itemCount`. Dates are ISO 8601.
An invalid, expired, or revoked key returns 401. The API can return 429 after
too many requests from one IP.

Before the first use on a native deployment, run the normal `C:\Apps\update.ps1`
procedure so the `integration_keys` migration is applied and the server/client
are rebuilt. No reset or manual edits to existing client data are required.

## Order status webhooks

In **Settings > Integrations > Order webhooks**, register a public HTTPS URL on
port 443. The server resolves its IPv4 address and rejects private or reserved
addresses **for every delivery attempt**. Redirects are not followed. The
signing secret (`whsec_...`) is displayed once and stored encrypted on the
ArchiveCore server. Disabling a recipient stops new events and causes its
pending deliveries to fail.

The server sends `POST` with `Content-Type: application/json` and these headers:

- `X-ArchiveCore-Event-Id`: stable UUID, use it to deduplicate retries.
- `X-ArchiveCore-Timestamp`: Unix timestamp in seconds.
- `X-ArchiveCore-Signature`: `sha256=<hex HMAC-SHA256>`.

Calculate HMAC-SHA256 with the signing secret as the key and the exact UTF-8
bytes of `<timestamp>.<raw request body>` as the message. Compare the digest in
constant time. Reject stale timestamps (for example older than five minutes)
and store processed event IDs. A successful receiver returns any 2xx status.

The event body is limited to order state metadata:

```json
{
  "id": "event-uuid",
  "type": "order.status_changed",
  "occurredAt": "2026-10-12T15:00:00.000Z",
  "data": {
    "orderId": "order-uuid",
    "orderNumber": "Z-202610-00001",
    "orderType": "checkout",
    "previousStatus": "ready",
    "status": "delivered"
  }
}
```

Delivery is **at least once**. On timeout or non-2xx response, ArchiveCore
retries with increasing delays (1 minute, 5 minutes, 30 minutes, 2 hours),
then marks the fifth unsuccessful attempt failed. The latest attempts are
visible in the Integrations tab. The native update script must apply the
`webhook_endpoints` and `webhook_deliveries` migration before server startup.
