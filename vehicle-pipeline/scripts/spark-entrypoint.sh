#!/bin/sh
set -eu
exec java -Xms256m -Xmx896m -XX:MaxDirectMemorySize=192m \
  --add-opens=java.base/java.lang=ALL-UNNAMED \
  --add-opens=java.base/java.lang.invoke=ALL-UNNAMED \
  --add-opens=java.base/java.util=ALL-UNNAMED \
  --add-opens=java.base/java.nio=ALL-UNNAMED \
  --add-opens=java.base/sun.nio.ch=ALL-UNNAMED \
  --add-opens=java.base/sun.util.calendar=ALL-UNNAMED \
  -cp '/app/app.jar:/app/lib/*' demo.vehicle.spark.ReportMain "$@"
