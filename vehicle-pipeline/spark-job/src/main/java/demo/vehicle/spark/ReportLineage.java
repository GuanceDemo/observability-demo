package demo.vehicle.spark;

import io.openlineage.client.OpenLineage;
import io.openlineage.client.OpenLineageClientUtils;
import java.net.URI;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;

final class ReportLineage {
  static final String JOB = "vehicle_summary";
  static final List<String> CLEAN_FIELDS = List.of("eventId:STRING", "vehicleId:STRING", "tripId:STRING", "sequence:LONG", "eventTime:LONG",
      "speedKph:DOUBLE", "odometerKm:DOUBLE", "batterySocPct:DOUBLE", "batteryTempC:DOUBLE", "mode:STRING", "anomaly:BOOLEAN",
      "anomalyCode:STRING", "kafkaPartition:INT", "kafkaOffset:LONG", "ingestedAt:LONG");
  static final List<String> SUMMARY_FIELDS = List.of("vehicle_id:VARCHAR(64)", "sample_count:BIGINT", "avg_speed_kph:DOUBLE",
      "max_speed_kph:DOUBLE", "distance_km:DOUBLE", "min_soc_pct:DOUBLE", "max_temp_c:DOUBLE", "high_temp_samples:BIGINT",
      "low_soc_samples:BIGINT", "charge_samples:BIGINT", "first_sequence:BIGINT", "last_sequence:BIGINT", "run_id:CHAR(36)");
  private final OpenLineage ol = new OpenLineage(URI.create("https://github.com/GuanceDemo/observability-demo/tree/main/vehicle-pipeline"));
  private final Settings settings;
  ReportLineage(Settings settings) { this.settings = settings; }
  private OpenLineage.DatasetFacets facets(List<String> fields, String type, String subtype, String version) {
    var builder = ol.newDatasetFacetsBuilder().schema(ol.newSchemaDatasetFacet(fields.stream().map(f -> {
      String[] parts = f.split(":", 2);
      return ol.newSchemaDatasetFacetFieldsBuilder().name(parts[0]).type(parts[1]).build();
    }).toList())).datasetType(ol.newDatasetTypeDatasetFacetBuilder().datasetType(type).subType(subtype).build());
    if (version != null) builder.version(ol.newDatasetVersionDatasetFacet(version));
    return builder.build();
  }
  private OpenLineage.Job job() {
    return ol.newJobBuilder().namespace(settings.jobNamespace()).name(JOB).facets(ol.newJobFacetsBuilder()
        .jobType(ol.newJobTypeJobFacetBuilder().processingType("BATCH").integration("SPARK").jobType("SQL").build())
        .documentation(ol.newDocumentationJobFacetBuilder().description("实际 Spark SQL：只读取北京时间今天对应分区的已提交 Parquet 快照，按事件 ID 去重，生成今日统计和五分钟趋势；同事务发布结果与终态事件。").build())
        .sql(ol.newSQLJobFacetBuilder().query(SummarySql.PREPARE + ";\n" + SummarySql.FIVE_MINUTES + ";\n" + SummarySql.DAILY).build()).build()).build();
  }
  private OpenLineage.OutputDataset output(String name, String timeField, Long rows) {
    var fields = new java.util.ArrayList<>(SUMMARY_FIELDS); fields.add(0, timeField);
    var builder = ol.newOutputDatasetBuilder().namespace(settings.mysqlNamespace()).name("vehicle_analytics." + name)
        .facets(facets(fields, "TABLE", "MYSQL", null));
    if (rows != null) builder.outputFacets(ol.newOutputDatasetOutputFacetsBuilder()
        .outputStatistics(ol.newOutputStatisticsOutputDatasetFacetBuilder().rowCount(rows).build()).build());
    return builder.build();
  }
  List<String> catalog() {
    var now = ZonedDateTime.now(ZoneOffset.UTC);
    var outputs = List.of(output("vehicle_summary_5m", "bucket_start:DATETIME", null), output("vehicle_daily_summary", "day:DATE", null));
    var events = new java.util.ArrayList<String>();
    for (var item : outputs) events.add(OpenLineageClientUtils.toJson(ol.newDatasetEventBuilder().eventTime(now)
        .dataset(ol.newStaticDatasetBuilder().namespace(item.getNamespace()).name(item.getName()).facets(item.getFacets()).build()).build()));
    events.add(OpenLineageClientUtils.toJson(ol.newJobEventBuilder().eventTime(now).job(job())
        .inputs(List.of(ol.newInputDatasetBuilder().namespace(settings.lakeNamespace()).name("clean").facets(facets(CLEAN_FIELDS, "FILE", "PARQUET", null)).build()))
        .outputs(outputs).build()));
    return events;
  }
  String event(UUID runId, String state, String snapshotHash, Long inputs, Long fiveRows, Long dailyRows, String error) {
    return event(runId, state, snapshotHash, inputs, fiveRows, dailyRows, error, null);
  }
  String failure(UUID runId, String state, ReportFailure failure) {
    return event(runId, state, null, null, null, null, failure.message(), failure);
  }
  private String event(UUID runId, String state, String snapshotHash, Long inputs, Long fiveRows, Long dailyRows, String error, ReportFailure failure) {
    var input = ol.newInputDatasetBuilder().namespace(settings.lakeNamespace()).name("clean")
        .facets(facets(CLEAN_FIELDS, "FILE", "PARQUET", snapshotHash));
    if (inputs != null) input.inputFacets(ol.newInputDatasetInputFacetsBuilder()
        .inputStatistics(ol.newInputStatisticsInputDatasetFacetBuilder().rowCount(inputs).build()).build());
    var runFacets = ol.newRunFacetsBuilder().processing_engine(ol.newProcessingEngineRunFacetBuilder()
        .name("Apache Spark").version("3.5.8").openlineageAdapterVersion("1.54.0").build());
    if (error != null) {
      var errorFacet = ol.newErrorMessageRunFacetBuilder().message(error).programmingLanguage("java");
      if (failure != null) errorFacet.stackTrace(failure.stackTrace()).put("errorType", failure.errorType())
          .put("failureStage", failure.failureStage()).put("retryCount", 0).put("errorCode", failure.code());
      runFacets.errorMessage(errorFacet.build());
    }
    return OpenLineageClientUtils.toJson(ol.newRunEventBuilder().eventTime(ZonedDateTime.now(ZoneOffset.UTC))
        .eventType(OpenLineage.RunEvent.EventType.valueOf(state)).job(job())
        .run(ol.newRunBuilder().runId(runId).facets(runFacets.build()).build()).inputs(List.of(input.build()))
        .outputs(List.of(output("vehicle_summary_5m", "bucket_start:DATETIME", fiveRows),
            output("vehicle_daily_summary", "day:DATE", dailyRows))).build());
  }
}
