#!/bin/sh
set -eu
heap=${JAVA_HEAP_MB:-896}
case "$heap" in ''|*[!0-9]*) echo 'Invalid JAVA_HEAP_MB' >&2; exit 1;; esac
exec java "-Xmx${heap}m" \
  --add-opens=java.base/java.lang=ALL-UNNAMED \
  --add-opens=java.base/java.lang.invoke=ALL-UNNAMED \
  --add-opens=java.base/java.nio=ALL-UNNAMED \
  --add-opens=java.base/sun.nio.ch=ALL-UNNAMED \
  --add-opens=java.base/java.util=ALL-UNNAMED \
  --add-opens=java.base/sun.util.calendar=ALL-UNNAMED \
  -cp '/app/app.jar:/app/lib/*' demo.reports.ReportMain "$@"
