package demo.reports;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.*;
import java.util.*;

final class Reports {
  static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");
  record Source(String runId, Instant updatedAt, List<Map<String, Object>> rows, LocalDate windowEndDate) {
    Source(String runId, Instant updatedAt, List<Map<String, Object>> rows) {
      this(runId, updatedAt, rows, updatedAt.atZone(SHANGHAI).toLocalDate());
    }
  }
  record Daily(LocalDate date, long orders, long units, long revenue,
               BigDecimal average, BigDecimal share, boolean partial) {}
  record Trend(Daily daily, Long previous, BigDecimal change, BigDecimal movingAverage, long cumulative) {}

  static List<Daily> daily(Source source) {
    LocalDate last = source.windowEndDate();
    // The Python window freezes immediately before its START record. At midnight,
    // preserve an earlier boundary evidenced by rows rather than dropping a day.
    LocalDate earliest = source.rows().stream().map(row -> (LocalDate) row.get("order_date"))
        .min(LocalDate::compareTo).orElse(last);
    if (earliest.isBefore(last.minusDays(6))) last = earliest.plusDays(6);
    Map<LocalDate, Map<String, Object>> byDay = new HashMap<>();
    long total = 0;
    for (Map<String, Object> row : source.rows()) {
      LocalDate date = (LocalDate) row.get("order_date");
      if (date.isBefore(last.minusDays(6)) || date.isAfter(last) || byDay.put(date, row) != null)
        throw new IllegalArgumentException("INVALID_SOURCE_DATE");
      total = Math.addExact(total, number(row, "revenue_cent"));
    }
    List<Daily> result = new ArrayList<>();
    for (int offset = 6; offset >= 0; offset--) {
      LocalDate date = last.minusDays(offset);
      Map<String, Object> row = byDay.get(date);
      long orders = row == null ? 0 : number(row, "order_count");
      long units = row == null ? 0 : number(row, "units");
      long revenue = row == null ? 0 : number(row, "revenue_cent");
      if (orders < 0 || units < 0 || revenue < 0 || (orders == 0 && revenue != 0))
        throw new IllegalArgumentException("INVALID_SOURCE_TOTALS");
      result.add(new Daily(date, orders, units, revenue, divide(revenue, orders, 2),
          total == 0 ? BigDecimal.ZERO : BigDecimal.valueOf(revenue).multiply(BigDecimal.valueOf(100))
              .divide(BigDecimal.valueOf(total), 4, RoundingMode.HALF_UP), date.equals(last)));
    }
    return result;
  }
  static List<Daily> existingDaily(Source source) {
    return source.rows().stream().map(row -> new Daily((LocalDate) row.get("order_date"),
        number(row,"order_count"), number(row,"units"), number(row,"revenue_cent"),
        (BigDecimal) row.get("avg_order_cent"), (BigDecimal) row.get("revenue_share_pct"),
        row.get("is_partial") instanceof Boolean b ? b : number(row,"is_partial") != 0)).toList();
  }
  static long number(Map<String,Object> row, String field) { return ((Number) row.get(field)).longValue(); }
  static BigDecimal divide(long value, long count, int scale) {
    return count == 0 ? BigDecimal.ZERO.setScale(scale)
        : BigDecimal.valueOf(value).divide(BigDecimal.valueOf(count), scale, RoundingMode.HALF_UP);
  }
}
