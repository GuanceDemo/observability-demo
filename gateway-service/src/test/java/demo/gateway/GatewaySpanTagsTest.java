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

  public static final class RecordingSpan {
    final Map<String, String> tags = new LinkedHashMap<>();

    public RecordingSpan setTag(String key, String value) {
      tags.put(key, value);
      return this;
    }
  }
}
