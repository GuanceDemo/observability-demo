#!/bin/sh
set -eu
namespace=${1:-vehicle-pipeline}
kubectl -n "$namespace" exec deployment/vehicle-kafka -- /bin/bash -ec '
  bin=/opt/kafka/bin
  "$bin/kafka-topics.sh" --bootstrap-server localhost:9092 --command-config /config/admin.properties --create --if-not-exists --topic vehicle.telemetry.raw.v1 --partitions 1 --replication-factor 1 --config retention.ms=604800000 --config retention.bytes=1073741824 --config segment.bytes=67108864
  "$bin/kafka-acls.sh" --bootstrap-server localhost:9092 --command-config /config/admin.properties --add --allow-principal User:emqx --producer --topic vehicle.telemetry.raw.v1
  "$bin/kafka-acls.sh" --bootstrap-server localhost:9092 --command-config /config/admin.properties --add --allow-principal User:flink --consumer --topic vehicle.telemetry.raw.v1 --group vehicle-flink-clean-v1
  "$bin/kafka-topics.sh" --bootstrap-server localhost:9092 --command-config /config/admin.properties --describe --topic vehicle.telemetry.raw.v1
'
