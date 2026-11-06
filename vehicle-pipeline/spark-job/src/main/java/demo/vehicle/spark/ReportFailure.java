package demo.vehicle.spark;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Map;
import org.apache.spark.sql.AnalysisException;

/** Bounded execution evidence: never serialize raw rows, query plans or credentials. */
record ReportFailure(String code, String errorType, String failureStage, String message, String stackTrace) {
  static ReportFailure capture(Exception error, String stage) {
    String code = error instanceof ReportMain.SourceUnavailable ? error.getMessage() : error.getClass().getSimpleName();
    String explanation = "执行失败，上一成功报表保留。";
    if (error instanceof AnalysisException analysis) {
      String errorClass = analysis.getErrorClass();
      if (errorClass != null && errorClass.matches("[A-Z0-9_.]{1,100}")) code = errorClass;
      // Only this known schema diagnostic is safe to include; arbitrary Spark messages can contain row values and paths.
      if (code.startsWith("UNRESOLVED_COLUMN") && "`batterySocPct`".equals(analysis.getMessageParameters().get("objectName"))) {
        explanation = "汇总 SQL 引用了不存在的字段 batterySocPct；输入字段已变为 batterySocPercent，字段映射未同步。上一成功报表保留。";
      }
    }
    String message = error.getClass().getName() + " [" + code + "]；失败阶段：" + stage
        + "；本次运行未重试，恢复会创建新的运行。" + explanation;
    StringBuilder stack = new StringBuilder();
    var seen = Collections.newSetFromMap(new IdentityHashMap<Throwable, Boolean>());
    Throwable cause = error;
    for (int depth = 0; cause != null && depth < 4 && seen.add(cause); depth++, cause = cause.getCause()) {
      if (depth > 0) stack.append("Caused by: ");
      stack.append(cause.getClass().getName()).append('\n');
      var frames = cause.getStackTrace();
      for (int i = 0; i < Math.min(frames.length, 48); i++) stack.append("\tat ").append(frames[i]).append('\n');
      if (frames.length > 48) stack.append("\t... ").append(frames.length - 48).append(" frames omitted\n");
    }
    return new ReportFailure(code, error.getClass().getName(), stage, message,
        stack.substring(0, Math.min(stack.length(), 12000)));
  }

  Map<String, Object> metadata() {
    return Map.of("errorType", errorType, "failureStage", failureStage, "retryCount", 0,
        "errorCode", code, "errorMessage", message, "stackTrace", stackTrace);
  }
}
