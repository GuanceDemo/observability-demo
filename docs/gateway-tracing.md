# Gateway tracing metadata

The Java Agent creates HTTP server/client spans. Spring MVC supplies the standard
`http.route` through `HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE`; the gateway
must not set that tag or create replacement spans.

`GatewaySpanTags` enriches the currently active Agent span with application context:

- Correlation: `key_request`, `biz_request_id`, `visitor_id`.
- Routing: `gateway.target`, `public_route`, `route_class`, `traffic_type`.
- Request context: `language`, `client_ip`, `peer_ip`, `request_host`, `user_agent`, `referer`.
- Identity: initially `auth_state=anonymous`; after a verified downstream response,
  `user_id`, `user_tier`, and `auth_state=authenticated` are added.

Identity comes from the trusted downstream response, never browser-supplied user
headers. Internal identity headers are not returned to the browser. Request-source
fields remain diagnostic context, not authorization inputs. Missing/blank/dash
values are omitted. Without an Agent, enrichment is a no-op and serving continues.

Validation: `mvn -pl gateway-service test` covers MVC route templates alongside
business tags, verified identity overriding spoofed headers, no internal identity
response leakage, and optional-Agent behavior. These tests do not replace a real
Agent smoke test of exported `http.route` and custom tags before deployment.
