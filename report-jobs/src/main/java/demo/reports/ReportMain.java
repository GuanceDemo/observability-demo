package demo.reports;

public final class ReportMain {
  private ReportMain() {}
  public static void main(String[] args) {
    if (args.length == 1 && args[0].equals("--help")) {
      System.out.println("mall-report-jobs daily|trend|fail-daily|fail-trend|replay"); return;
    }
    int result;
    try {
      if (args.length != 1) throw new IllegalArgumentException("One mode required");
      Settings settings = Settings.fromEnv(System.getenv());
      try (ReportWorker worker = new ReportWorker(settings, new HttpSink(settings))) { result = worker.run(args[0]); }
    } catch (Exception exception) {
      // SQL/HTTP exception messages can contain credentials or row values.
      ReportWorker.log("report_error", "type=" + exception.getClass().getSimpleName()); result = 1;
    }
    System.exit(result);
  }
}
