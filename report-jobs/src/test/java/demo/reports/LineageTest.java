package demo.reports;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class LineageTest {
  static Settings settings(int port) {
    return new Settings("127.0.0.1", port, "mall_reports_writer", "fixture-password", URI.create("http://127.0.0.1:1"),
        "fixture-token", "mall-demo.data-pipeline", "mysql://demo-observability-demo-mysql:3306");
  }
  @Test void sdkPreservesLifecycleIdentityAndConnectsEngines() throws Exception {
    Lineage ol = new Lineage(settings(3306));
    UUID id = UUID.randomUUID();
    ObjectMapper mapper = new ObjectMapper();
    for (String job : List.of(Lineage.DAILY, Lineage.TREND)) {
      var start = mapper.readTree(ol.event(job, id, "START", null, null, null, null));
      var end = mapper.readTree(ol.event(job, id, "COMPLETE", "source-id", 7L, 7L, null));
      assertEquals(start.at("/run/runId"), end.at("/run/runId"));
      assertEquals(job.equals(Lineage.DAILY) ? "JAVA" : "SPARK", end.at("/job/facets/jobType/integration").asText());
      assertEquals(7, end.at("/outputs/0/outputFacets/outputStatistics/rowCount").asInt());
      assertEquals("source-id", end.at("/inputs/0/facets/version/datasetVersion").asText());
      assertTrue(end.at("/outputs/0/facets/schema/fields").size() >= 11);
      assertFalse(end.toString().contains("fixture-token"));
      assertFalse(end.toString().contains("fixture-password"));
      assertEquals(2, ol.catalog(job).size());
    }
    assertEquals(Lineage.output(Lineage.DAILY), Lineage.input(Lineage.TREND));
    java.nio.file.Files.createDirectories(java.nio.file.Path.of("target"));
    List<String> fixtures = new ArrayList<>();
    for (String job : List.of(Lineage.DAILY, Lineage.TREND)) {
      fixtures.addAll(ol.catalog(job));
      fixtures.add(ol.event(job, id, "START", null, null, null, null));
      fixtures.add(ol.event(job, id, "COMPLETE", "source-id", 7L, 7L, null));
      fixtures.add(ol.event(job, id, "FAIL", "source-id", 7L, null, "SQL_ERROR"));
    }
    java.nio.file.Files.write(java.nio.file.Path.of("target/lineage-fixtures.jsonl"), fixtures);
  }
  @Test void rejectsUntrustedEndpointAndRedactsSettings() {
    assertThrows(IllegalArgumentException.class, () -> Settings.fromEnv(Map.of("OPENLINEAGE_URL", "https://user:pass@example.com")));
    assertThrows(IllegalArgumentException.class, () -> Settings.fromEnv(Map.of("OPENLINEAGE_URL", "http://example.com")));
    assertFalse(settings(3306).toString().contains("fixture-password"));
    assertEquals(10000, HttpSink.retryDelay(0, "300"));
    assertEquals(0, HttpSink.retryDelay(0, "-1"));
  }
}
