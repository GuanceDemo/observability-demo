# Web login and RUM identity verification

## Scope

- Time range: 2026-08-17 11:50:05–12:00:05 CST (2026-08-17 03:50:05–04:00:05 UTC)
- Data domain: Guance RUM `view`
- Tools: in-app Browser, Chrome, `dqlcheck`, `owl.data.query`
- Environment RUM app ID: `order_web_docker_demo`

## Conclusion

Two independent browsers logged in as `demo-reader-001`. The observed result was `visitor_UV=2` and `account_UV=1`. The six Views comprised two anonymous Views and four authenticated Views across initial, authentication, and navigation boundaries.

## Evidence

- Both browsers rendered the fixed-persona dialog and displayed `Demo Reader A · standard` after login.
- A route change to `storefront/path` succeeded in both browsers and flushed the authenticated View boundary.
- RUM grouped data contained two anonymous SDK-generated user IDs and one signed-in ID, `demo-reader-001`.
- Signed-in Views contained `auth_state=authenticated`, `user_tier=standard`, and `is_signin=T`.
- Logout in the in-app Browser restored the anonymous account control without changing the browser visitor identity.

Validated environment-specific queries:

```dql
R::`view`:(COUNT(*) AS `PV`) { `app_id` = 'order_web_docker_demo' and `sdk_name` = 'df_web_rum_sdk' } [10m]
R::`view`:(COUNT_DISTINCT(`visitor_id`) AS `visitor_UV`) { `app_id` = 'order_web_docker_demo' and `sdk_name` = 'df_web_rum_sdk' } [10m]
R::`view`:(COUNT_DISTINCT(`userid`) AS `account_UV`) { `app_id` = 'order_web_docker_demo' and `sdk_name` = 'df_web_rum_sdk' and `is_signin` = 'T' } [10m]
```

Observed values: `PV=6`, `visitor_UV=2`, `account_UV=1`.

## Inference and remaining gap

The provided generic query uses `is_signin = true`, which passes syntax validation but returned zero in this workspace. The stored RUM boolean representation is `T`/`F`, so `is_signin = 'T'` is required for the live workspace query. Replace the example `app_id` with the deployment's configured RUM application ID when validating another environment.
