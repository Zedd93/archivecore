# ArchiveCore partner API (v1)

The first version is read-only and exposes **order statuses only**. It never returns
document contents, personal data, or physical warehouse locations. Webhooks are
not part of this first version.

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
