package demo.reports;

import java.util.*;
import org.apache.spark.sql.*;
import org.apache.spark.sql.types.*;
import static demo.reports.Reports.*;

final class SparkTrends {
  static final String SQL = """
      WITH windowed AS (
        SELECT *,
          LAG(revenue_cent) OVER (ORDER BY order_date) AS previous_revenue_cent,
          CAST(AVG(CAST(revenue_cent AS DECIMAL(20,2))) OVER
            (ORDER BY order_date ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS DECIMAL(20,2)) AS moving_avg_3d_cent,
          SUM(revenue_cent) OVER (ORDER BY order_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_revenue_cent
        FROM business_daily
      )
      SELECT *, CASE WHEN is_partial OR previous_revenue_cent IS NULL OR previous_revenue_cent=0 THEN NULL
        ELSE CAST((CAST(revenue_cent AS DECIMAL(20,4))-previous_revenue_cent)*100/previous_revenue_cent AS DECIMAL(20,4))
        END AS revenue_change_pct
      FROM windowed ORDER BY order_date
      """;

  static List<Trend> calculate(List<Daily> daily) {
    SparkSession spark = SparkSession.builder().appName("mall-sales-trend").master("local[2]")
        .config("spark.ui.enabled", "false").config("spark.sql.shuffle.partitions", "2")
        .config("spark.sql.session.timeZone", "UTC").config("spark.driver.bindAddress", "127.0.0.1")
        .config("spark.driver.host", "127.0.0.1").config("spark.sql.warehouse.dir", "/tmp/spark-warehouse")
        .config("spark.sql.ansi.enabled", "true").getOrCreate();
    try {
      spark.sparkContext().setLogLevel("WARN");
      StructType schema = new StructType().add("order_date", DataTypes.DateType, false)
          .add("order_count", DataTypes.LongType, false).add("units", DataTypes.LongType, false)
          .add("revenue_cent", DataTypes.LongType, false).add("is_partial", DataTypes.BooleanType, false);
      List<Row> rows = daily.stream().map(d -> RowFactory.create(java.sql.Date.valueOf(d.date()),
          d.orders(), d.units(), d.revenue(), d.partial())).toList();
      spark.createDataFrame(rows, schema).createOrReplaceTempView("business_daily");
      Dataset<Row> result = spark.sql(SQL);
      // Execution details contain only the schema and SQL plan, never credentials or order values.
      System.out.println("{\"event\":\"spark_execution\",\"engine\":\"Apache Spark\",\"version\":\""
          + spark.version() + "\",\"master\":\"local[2]\",\"operation\":\"Window SQL\"}");
      Map<java.time.LocalDate, Daily> days = new HashMap<>();
      daily.forEach(d -> days.put(d.date(), d));
      return result.collectAsList().stream().map(row -> new Trend(
          days.get(row.getDate(0).toLocalDate()), row.isNullAt(5) ? null : row.getLong(5),
          row.isNullAt(8) ? null : row.getDecimal(8), row.getDecimal(6), row.getLong(7))).toList();
    } finally { spark.stop(); }
  }
}
