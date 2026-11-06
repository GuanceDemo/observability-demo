# Gateway tracing metadata

The Java Agent creates HTTP server/client spans. Spring MVC supplies the standard
`http.route` through `HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE`; the gateway
must not set that tag or create replacement spans.

`GatewaySpanTags` enriches the currently active Agent span and its local root span
with the same application context:

- Correlation: `key_request`, `biz_request_id`, `visitor_id`.
- Routing: `gateway.target`, `public_route`, `route_class`, `traffic_type`.
- Request context: `language`, `client_ip`, `peer_ip`, `request_host`, `user_agent`, `referer`.
- Identity: initially `auth_state=anonymous`; after a verified downstream response,
  `user_id`, `user_tier`, and `auth_state=authenticated` are added.

Identity comes from the trusted downstream response, never browser-supplied user
headers. Internal identity headers are not returned to the browser. Request-source
fields remain diagnostic context, not authorization inputs. Missing/blank/dash
values are omitted. Without an Agent, enrichment is a no-op and serving continues.
If the active span is already the local root, tags are written only once. If the
Agent has no local-root API or returns no root, active-span enrichment is retained.

During MVC dispatch the active span may be `spring.handler`, while the HTTP status
code belongs to the `servlet.request` local root. Request classification and later
verified identity updates must reach both spans so HTTP alert queries can combine
status codes with `route_class` and `traffic_type` on the same span. Use the local
root, not an upstream service's distributed trace root. Requests rejected before
the application handler runs still have no application classification; missing
tags alone do not prove a request is a scan.

Validation: `mvn -pl gateway-service test` covers MVC route templates alongside
business tags on handler and root spans, verified identity overriding spoofed
headers on both spans, no internal identity response leakage, and optional-Agent
behavior. These tests do not replace a real Agent smoke test of exported
`http.route` and custom tags before deployment.
