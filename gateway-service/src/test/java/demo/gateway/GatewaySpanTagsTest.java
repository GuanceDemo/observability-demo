package demo.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class GatewaySpanTagsTest {

  @Test
  void addsClassificationsWithoutOverwritingStandardRouteOrCreatingSpans() throws Exception {
    RecordingSpan span = new RecordingSpan();
    span.tags.put("http.route", "/api/demo/faults/{faultName}/enable");
    GatewaySpanTags.applyToSpan(
        span, Map.of("public_route", "demo.faults.enable", "route_class", "demo_api"));
    assertThat(span.tags).containsExactlyInAnyOrderEntriesOf(Map.of(
        "http.route", "/api/demo/faults/{faultName}/enable",
        "public_route", "demo.faults.enable",
        "route_class", "demo_api"));
  }

  @Test
  void distinguishesBusinessAndUnmatchedRequests() throws Exception {
    RecordingSpan business = new RecordingSpan();
    GatewaySpanTags.applyToSpan(business, Map.of("public_route", "orders.create", "route_class", "business_api"));
    assertThat(business.tags).containsEntry("public_route", "orders.create")
        .containsEntry("route_class", "business_api");
    RecordingSpan unmatched = new RecordingSpan();
    GatewaySpanTags.applyToSpan(unmatched, Map.of("public_route", "unmatched", "route_class", "unmatched"));
    assertThat(unmatched.tags).containsEntry("public_route", "unmatched")
        .containsEntry("route_class", "unmatched");
  }

  @Test
  void worksWithoutAnAgent() {
    assertThatCode(() -> GatewaySpanTags.apply(Map.of("public_route", "demo.status")))
        .doesNotThrowAnyException();
  }

  @Test
  void addsClassificationsToHandlerAndHttpRootWithoutChangingHttpMetadata() {
    RecordingSpan root = new RecordingSpan();
    root.tags.put("http.route", "/api/orders");
    root.tags.put("http.status_code", "200");
    SpanWithLocalRoot handler = new SpanWithLocalRoot(root);
    Map<String, String> tags = Map.of(
        "public_route", "orders.create", "route_class", "business_api",
        "traffic_type", "public_demo", "key_request", "checkout_submit_order");

    GatewaySpanTags.applyToRequestSpans(handler, tags);

    assertThat(handler.tags).containsExactlyInAnyOrderEntriesOf(tags);
    assertThat(root.tags).containsAllEntriesOf(tags)
        .containsEntry("http.route", "/api/orders")
        .containsEntry("http.status_code", "200")
        .hasSize(tags.size() + 2);
  }

  @Test
  void omitsMissingValuesOnBothHandlerAndRoot() {
    RecordingSpan root = new RecordingSpan();
    SpanWithLocalRoot handler = new SpanWithLocalRoot(root);
    Map<String, String> tags = new LinkedHashMap<>();
    tags.put("route_class", "business_api");
    tags.put("user_id", null);
    tags.put("user_tier", " ");
    tags.put("referer", "-");

    GatewaySpanTags.applyToRequestSpans(handler, tags);

    assertThat(handler.tags).containsExactlyInAnyOrderEntriesOf(Map.of("route_class", "business_api"));
    assertThat(root.tags).isEqualTo(handler.tags);
  }

  @Test
  void writesOnlyOnceWhenActiveSpanIsTheLocalRoot() {
    SpanWithLocalRoot root = new SpanWithLocalRoot(null);
    root.localRoot = root;

    GatewaySpanTags.applyToRequestSpans(root, Map.of("route_class", "business_api"));

    assertThat(root.tags).containsEntry("route_class", "business_api");
    assertThat(root.tagWrites).isEqualTo(1);
  }

  @Test
  void keepsActiveTagsWhenLocalRootIsMissingOrUnsupported() {
    for (RecordingSpan span : new RecordingSpan[] {
        new SpanWithLocalRoot(null), new RecordingSpan(), new FailingRootSpan()
    }) {
      assertThatCode(() -> GatewaySpanTags.applyToRequestSpans(
          span, Map.of("route_class", "business_api"))).doesNotThrowAnyException();
      assertThat(span.tags).containsEntry("route_class", "business_api");
    }
  }

  @Test
  void doesNothingWithoutAnActiveSpan() {
    assertThatCode(() -> GatewaySpanTags.applyToRequestSpans(
        null, Map.of("route_class", "business_api"))).doesNotThrowAnyException();
  }

  public static class RecordingSpan {
    final Map<String, String> tags = new LinkedHashMap<>();
    int tagWrites;

    public RecordingSpan setTag(String key, String value) {
      tagWrites++;
      tags.put(key, value);
      return this;
    }
  }

  public static final class SpanWithLocalRoot extends RecordingSpan {
    RecordingSpan localRoot;

    SpanWithLocalRoot(RecordingSpan localRoot) {
      this.localRoot = localRoot;
    }

    public RecordingSpan getLocalRootSpan() {
      return localRoot;
    }
  }

  public static final class FailingRootSpan extends RecordingSpan {
    public RecordingSpan getLocalRootSpan() {
      throw new IllegalStateException("local root unavailable");
    }
  }
}
