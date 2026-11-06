from datetime import UTC, datetime
from typing import Any

import attr
from openlineage.client import event_v2 as ol
from openlineage.client.generated.dataset_type_dataset import DatasetTypeDatasetFacet
from openlineage.client.generated.documentation_job import DocumentationJobFacet
from openlineage.client.generated.error_message_run import ErrorMessageRunFacet
from openlineage.client.generated.execution_parameters_run import (
    ExecutionParameter,
    ExecutionParametersRunFacet,
)
from openlineage.client.generated.input_statistics_input_dataset import (
    InputStatisticsInputDatasetFacet,
)
from openlineage.client.generated.job_type_job import JobTypeJobFacet
from openlineage.client.generated.output_statistics_output_dataset import (
    OutputStatisticsOutputDatasetFacet,
)
from openlineage.client.generated.processing_engine_run import ProcessingEngineRunFacet
from openlineage.client.generated.schema_dataset import SchemaDatasetFacet, SchemaDatasetFacetFields
from openlineage.client.generated.sql_job import SQLJobFacet
from openlineage.client.serde import Serde

from .config import Config

PRODUCER = "https://github.com/GuanceDemo/observability-demo/tree/main/vehicle-pipeline"
RAW_FIELDS = [
    ("schemaVersion", "INT"),
    ("eventId", "STRING"),
    ("vehicleId", "STRING"),
    ("tripId", "STRING"),
    ("sequence", "LONG"),
    ("eventTime", "LONG"),
    ("speedKph", "DOUBLE"),
    ("odometerKm", "DOUBLE"),
    ("batterySocPct", "DOUBLE"),
    ("batteryTempC", "DOUBLE"),
    ("mode", "STRING"),
]
CLEAN_FIELDS = RAW_FIELDS[1:] + [
    ("anomaly", "BOOLEAN"),
    ("anomalyCode", "STRING"),
    ("kafkaPartition", "INT"),
    ("kafkaOffset", "LONG"),
    ("ingestedAt", "LONG"),
]
REJECTED_FIELDS = [
    ("reason", "STRING"),
    ("payload", "STRING"),
    ("kafkaPartition", "INT"),
    ("kafkaOffset", "LONG"),
    ("ingestedAt", "LONG"),
]
JOBS = {"emqx": "emqx_telemetry_to_kafka", "flink": "vehicle_clean_and_detect"}


@attr.define
class ExecutionErrorFacet(ErrorMessageRunFacet):
    errorType: str | None = None
    failureStage: str | None = None
    errorCode: str | None = None


class Lineage:
    def __init__(self, config: Config):
        self.config = config

    def dataset(self, key: str) -> dict[str, Any]:
        if key == "mqtt":
            namespace, name, fields, kind, subtype = (
                self.config.mqtt_namespace,
                self.config.mqtt_topic,
                RAW_FIELDS,
                "TOPIC",
                "MQTT",
            )
        elif key == "kafka":
            namespace, name, fields, kind, subtype = (
                self.config.kafka_namespace,
                self.config.kafka_topic,
                RAW_FIELDS,
                "TOPIC",
                "KAFKA",
            )
        else:
            namespace, name, fields, kind, subtype = (
                self.config.lake_namespace,
                key,
                REJECTED_FIELDS if key == "quarantine" else CLEAN_FIELDS,
                "FILE",
                "PARQUET",
            )
        return {
            "namespace": namespace,
            "name": name,
            "facets": {
                "schema": SchemaDatasetFacet(
                    fields=[SchemaDatasetFacetFields(name=n, type=t) for n, t in fields],
                    producer=PRODUCER,
                ),
                "datasetType": DatasetTypeDatasetFacet(
                    datasetType=kind, subType=subtype, producer=PRODUCER
                ),
            },
        }

    def job(self, component: str) -> ol.Job:
        emqx = component == "emqx"
        facets: dict[str, Any] = {
            "jobType": JobTypeJobFacet(
                processingType="STREAMING",
                integration="EMQX" if emqx else "FLINK",
                jobType="SQL" if emqx else "JAR",
                producer=PRODUCER,
            ),
            "documentation": DocumentationJobFacet(
                description=(
                    "EMQX 原生 Kafka Sink；元数据适配器读取真实规则/动作指标。"
                    "计数为该运行实例的实际处理计数。"
                    if emqx
                    else "真实 Flink JAR 持续校验、去重和异常检测；检查点提交 Parquet。"
                    "元数据适配器按实际执行尝试记录运行：引擎异常结束当次运行，"
                    "真实子任务重新执行并完成检查点后开始新运行；保留可恢复累计计数。"
                ),
                producer=PRODUCER,
            ),
        }
        if emqx:
            facets["sql"] = SQLJobFacet(
                query=(
                    "SELECT payload, payload.vehicleId AS vehicleId FROM "
                    f'"{self.config.mqtt_topic}"'
                ),
                producer=PRODUCER,
            )
        return ol.Job(namespace=self.config.job_namespace, name=JOBS[component], facets=facets)

    def datasets(
        self, component: str, counts: dict[str, int] | None = None
    ) -> tuple[list[Any], list[Any]]:
        counts = counts or {}
        input_key = "mqtt" if component == "emqx" else "kafka"
        output_keys = ["kafka"] if component == "emqx" else ["clean", "anomalies", "quarantine"]
        inputs = [
            ol.InputDataset(
                **self.dataset(input_key),
                inputFacets={
                    "inputStatistics": InputStatisticsInputDatasetFacet(
                        rowCount=counts["input"], producer=PRODUCER
                    )
                }
                if "input" in counts
                else {},
            )
        ]
        outputs = [
            ol.OutputDataset(
                **self.dataset(key),
                outputFacets={
                    "outputStatistics": OutputStatisticsOutputDatasetFacet(
                        rowCount=counts[key], producer=PRODUCER
                    )
                }
                if key in counts
                else {},
            )
            for key in output_keys
        ]
        return inputs, outputs

    def catalog(self, component: str) -> list[str]:
        inputs, outputs = self.datasets(component)
        now = datetime.now(UTC).isoformat()
        keys = (
            ["mqtt", "kafka"]
            if component == "emqx"
            else ["kafka", "clean", "anomalies", "quarantine"]
        )
        events: list[Any] = [
            ol.DatasetEvent(
                eventTime=now, producer=PRODUCER, dataset=ol.StaticDataset(**self.dataset(key))
            )
            for key in keys
        ]
        events.append(
            ol.JobEvent(
                eventTime=now,
                producer=PRODUCER,
                job=self.job(component),
                inputs=inputs,
                outputs=outputs,
            )
        )
        return [Serde.to_json(event) for event in events]

    def event(
        self,
        component: str,
        run_id: str,
        state: str,
        counts: dict[str, int] | None = None,
        *,
        error: str | None = None,
        at: datetime | None = None,
        metadata: dict[str, Any] | None = None,
        error_details: dict[str, Any] | None = None,
    ) -> str:
        inputs, outputs = self.datasets(component, counts)
        facets: dict[str, Any] = {
            "processing_engine": ProcessingEngineRunFacet(
                name="EMQX" if component == "emqx" else "Apache Flink",
                version="6.3.2" if component == "emqx" else "1.20.3",
                openlineageAdapterVersion="vehicle-pipeline-0.1.0",
                producer=PRODUCER,
            )
        }
        if component == "flink" and metadata and metadata.get("executionScope"):
            facets["executionParameters"] = ExecutionParametersRunFacet(
                parameters=[
                    ExecutionParameter(key=key, value=str(metadata[key]))
                    for key in ("executionScope", "jobId", "attemptKey")
                    if metadata.get(key) is not None
                ],
                producer=PRODUCER,
            )
        if error:
            details = error_details or {}
            facets["errorMessage"] = ExecutionErrorFacet(
                message=details.get("message", error),
                programmingLanguage="java" if component == "flink" else "python",
                stackTrace=details.get("stackTrace"),
                errorType=details.get("errorType"),
                failureStage=details.get("failureStage"),
                errorCode=error,
                producer=PRODUCER,
            )
        return Serde.to_json(
            ol.RunEvent(
                eventTime=(at or datetime.now(UTC)).isoformat(),
                producer=PRODUCER,
                eventType=ol.RunState[state],
                job=self.job(component),
                run=ol.Run(runId=run_id, facets=facets),
                inputs=inputs,
                outputs=outputs,
            )
        )
