package demo.reports;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static demo.reports.Reports.*;

class ReportsTest {
  static Map<String,Object> sales(String date, long orders, long units, long cents) {
    return Map.of("order_date", LocalDate.parse(date), "order_count", orders, "units", units, "revenue_cent", cents);
  }
  static Source fixture() {
    return new Source(UUID.randomUUID().toString(), Instant.parse("2026-10-22T04:00:00Z"), List.of(
        sales("2026-10-16", 2, 5, 10001), sales("2026-10-18", 3, 7, 15000),
        sales("2026-10-19", 2, 2, 30000), sales("2026-10-20", 1, 1, 10000),
        sales("2026-10-21", 2, 3, 5000), sales("2026-10-22", 1, 1, 999)));
  }
  @Test void javaUsesOrderTotalsAndFillsEmptyCalendarDays() {
    List<Daily> daily = Reports.daily(fixture());
    assertEquals(7, daily.size());
    assertEquals(71000, daily.stream().mapToLong(Daily::revenue).sum());
    assertEquals(new BigDecimal("5000.50"), daily.get(0).average());
    assertEquals(0, daily.get(1).orders());
    assertEquals(0, daily.get(1).average().signum());
    assertTrue(daily.get(6).partial());
    assertFalse(daily.get(5).partial());
  }
  @Test void runFinishingAfterMidnightKeepsItsOriginalWindow() {
    var source = new Source("run", Instant.parse("2026-10-22T16:00:05Z"),
        List.of(sales("2026-10-16", 1, 2, 1999)), LocalDate.parse("2026-10-22"));
    var result = Reports.daily(source);
    assertEquals(LocalDate.parse("2026-10-16"), result.get(0).date());
    assertEquals(LocalDate.parse("2026-10-22"), result.get(6).date());
    assertEquals(1999, result.stream().mapToLong(Daily::revenue).sum());
  }
  @Test void emptyWindowIsZeroWithoutDivisionByZero() {
    var daily = Reports.daily(new Source("id", fixture().updatedAt(), List.of()));
    assertEquals(7, daily.size());
    assertTrue(daily.stream().allMatch(d -> d.revenue() == 0 && d.average().signum() == 0 && d.share().signum() == 0));
  }
  @Test void actualSparkComputesWindowsAndSuppressesInvalidComparisons() {
    var trends = SparkTrends.calculate(Reports.daily(fixture()));
    assertEquals(7, trends.size());
    assertEquals(71000, trends.get(6).cumulative());
    assertNull(trends.get(0).change());
    assertNull(trends.get(2).change()); // previous date has zero sales
    assertNull(trends.get(6).change()); // current date is partial
    assertEquals(0, new BigDecimal("100.0000").compareTo(trends.get(3).change()));
    assertEquals(new BigDecimal("15000.00"), trends.get(3).movingAverage());
    assertEquals(new BigDecimal("8333.67"), trends.get(2).movingAverage());
  }
}
