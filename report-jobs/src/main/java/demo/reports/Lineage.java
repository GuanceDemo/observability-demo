package demo.reports;

import io.openlineage.client.OpenLineage;
import io.openlineage.client.OpenLineageClientUtils;
import java.net.URI;
import java.time.ZonedDateTime;
import java.time.ZoneOffset;
import java.util.*;

final class Lineage {
  static final String DAILY = "business_daily";
  static final String TREND = "sales_trend";
  static final String SOURCE = "mall_analytics.demo_sales_daily";
  static final String DAILY_TABLE = "mall_reports.demo_business_daily";
  static final String TREND_TABLE = "mall_reports.demo_sales_trend";
  private static final URI PRODUCER = URI.create("https://github.com/GuanceDemo/observability-demo/tree/main/report-jobs");
  private final OpenLineage ol = new OpenLineage(PRODUCER);
  private final Settings settings;
  Lineage(Settings settings) { this.settings = settings; }
  static String input(String job) { return job.equals(DAILY) ? SOURCE : DAILY_TABLE; }
  static String output(String job) { return job.equals(DAILY) ? DAILY_TABLE : TREND_TABLE; }

  OpenLineage.DatasetFacets facets(String table) {
    List<String> fields = new ArrayList<>(List.of("order_date:DATE", "order_count:BIGINT", "units:BIGINT", "revenue_cent:BIGINT"));
    if (!table.equals(SOURCE)) {
      fields.addAll(List.of("avg_order_cent:DECIMAL(20,2)", "revenue_share_pct:DECIMAL(9,4)", "is_partial:BOOLEAN"));
      if (table.equals(TREND_TABLE)) fields.addAll(List.of("previous_revenue_cent:BIGINT", "revenue_change_pct:DECIMAL(20,4)",
          "moving_avg_3d_cent:DECIMAL(20,2)", "cumulative_revenue_cent:BIGINT", "upstream_run_id:CHAR(36)"));
      fields.addAll(List.of("source_run_id:CHAR(36)", "source_updated_at:DATETIME(3)"));
    }
    fields.addAll(List.of("run_id:CHAR(36)", "processed_at:DATETIME(3)"));
    return ol.newDatasetFacetsBuilder().schema(ol.newSchemaDatasetFacet(fields.stream().map(field -> {
      String[] pair = field.split(":", 2);
      return ol.newSchemaDatasetFacetFieldsBuilder().name(pair[0]).type(pair[1]).build();
    }).toList())).datasetType(ol.newDatasetTypeDatasetFacetBuilder().datasetType("TABLE").subType("MYSQL").build()).build();
  }
  OpenLineage.Job job(String name) {
    boolean spark = name.equals(TREND);
    var facets = ol.newJobFacetsBuilder()
        .jobType(ol.newJobTypeJobFacetBuilder().processingType("BATCH")
            .integration(spark ? "SPARK" : "JAVA").jobType(spark ? "SQL" : "JDBC").build())
        .documentation(ol.newDocumentationJobFacetBuilder().description(spark
            ? "Spark SQL 销售趋势：日环比、3 日移动平均和累计营业额。当日不参与环比。"
            : "Java 经营日报：读取真实销售汇总，计算客单价与营业额占比，补齐零销量日期。").build());
    if (spark) facets.sql(ol.newSQLJobFacetBuilder().query(SparkTrends.SQL).build());
    return ol.newJobBuilder().namespace(settings.jobNamespace()).name(name).facets(facets.build()).build();
  }
  private OpenLineage.InputDataset source(String name, Long rows, String version) {
    var f = facets(name);
    // The version facet identifies the committed batch consumed by this run.
    if (version != null) f = ol.newDatasetFacetsBuilder().schema(f.getSchema()).datasetType(f.getDatasetType())
        .version(ol.newDatasetVersionDatasetFacet(version)).build();
    var builder = ol.newInputDatasetBuilder().namespace(settings.datasetNamespace()).name(name).facets(f);
    if (rows != null) builder.inputFacets(ol.newInputDatasetInputFacetsBuilder()
        .inputStatistics(ol.newInputStatisticsInputDatasetFacetBuilder().rowCount(rows).build()).build());
    return builder.build();
  }
  private OpenLineage.OutputDataset target(String name, Long rows) {
    var builder = ol.newOutputDatasetBuilder().namespace(settings.datasetNamespace()).name(name).facets(facets(name));
    if (rows != null) builder.outputFacets(ol.newOutputDatasetOutputFacetsBuilder()
        .outputStatistics(ol.newOutputStatisticsOutputDatasetFacetBuilder().rowCount(rows).build()).build());
    return builder.build();
  }
  List<String> catalog(String name) {
    var now = ZonedDateTime.now(ZoneOffset.UTC);
    String dataset = OpenLineageClientUtils.toJson(ol.newDatasetEventBuilder().eventTime(now)
        .dataset(ol.newStaticDatasetBuilder().namespace(settings.datasetNamespace()).name(output(name))
            .facets(facets(output(name))).build()).build());
    String job = OpenLineageClientUtils.toJson(ol.newJobEventBuilder().eventTime(now).job(job(name))
        .inputs(List.of(source(input(name), null, null))).outputs(List.of(target(output(name), null))).build());
    return List.of(dataset, job);
  }
  String event(String name, UUID runId, String state, String sourceRunId, Long inputCount, Long outputCount, String error) {
    boolean spark = name.equals(TREND);
    var runFacets = ol.newRunFacetsBuilder().processing_engine(ol.newProcessingEngineRunFacetBuilder()
        .name(spark ? "Apache Spark" : "Java").version(spark ? "3.5.8" : System.getProperty("java.version"))
        .openlineageAdapterVersion("1.54.0").build());
    if (error != null) runFacets.errorMessage(ol.newErrorMessageRunFacetBuilder()
        .message(error).programmingLanguage("java").build());
    return OpenLineageClientUtils.toJson(ol.newRunEventBuilder().eventTime(ZonedDateTime.now(ZoneOffset.UTC))
        .eventType(OpenLineage.RunEvent.EventType.valueOf(state)).job(job(name))
        .run(ol.newRunBuilder().runId(runId).facets(runFacets.build()).build())
        .inputs(List.of(source(input(name), inputCount, sourceRunId)))
        .outputs(List.of(target(output(name), outputCount))).build());
  }
}
