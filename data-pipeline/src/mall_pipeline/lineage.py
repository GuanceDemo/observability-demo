import json
from datetime import UTC, datetime
from typing import Any

from openlineage.client import event_v2 as ol
from openlineage.client.generated.documentation_dataset import DocumentationDatasetFacet
from openlineage.client.generated.documentation_job import DocumentationJobFacet
from openlineage.client.generated.error_message_run import ErrorMessageRunFacet
from openlineage.client.generated.input_statistics_input_dataset import (
    InputStatisticsInputDatasetFacet,
)
from openlineage.client.generated.job_type_job import JobTypeJobFacet
from openlineage.client.generated.output_statistics_output_dataset import (
    OutputStatisticsOutputDatasetFacet,
)
from openlineage.client.generated.schema_dataset import SchemaDatasetFacet, SchemaDatasetFacetFields
from openlineage.client.serde import Serde

from .config import Config

PRODUCER = "https://github.com/GuanceDemo/observability-demo/tree/main/data-pipeline"
SCHEMAS = {
    "source": [
        ("order_id", "VARCHAR(64)"),
        ("sku", "VARCHAR(96)"),
        ("quantity", "INT"),
        ("amount_cent", "INT"),
        ("status", "VARCHAR(32)"),
        ("created_at", "TIMESTAMP(3)"),
    ],
    "clean": [
        ("order_id", "VARCHAR(64)"),
        ("sku", "VARCHAR(96)"),
        ("quantity", "INT"),
        ("amount_cent", "BIGINT"),
        ("order_date", "DATE"),
        ("created_at", "DATETIME(3)"),
        ("processed_at", "DATETIME(3)"),
        ("run_id", "CHAR(36)"),
    ],
    "sales": [
        ("order_date", "DATE"),
        ("order_count", "BIGINT"),
        ("units", "BIGINT"),
        ("revenue_cent", "BIGINT"),
        ("processed_at", "DATETIME(3)"),
        ("run_id", "CHAR(36)"),
    ],
}
DESCRIPTIONS = {
    "source": "商城订单源表；仅报告处理所需列的 Schema，不采集用户或请求标识。",
    "clean": "近 7 个北京时间自然日的有效已确认订单，金额为订单总额（分）。",
    "sales": "按北京时间日期汇总订单数、件数与订单总金额（分）。",
}
JOBS = {
    "orders_clean": ("source", "clean", "清洗已确认订单，剔除无效 SKU、数量与金额。"),
    "sales_aggregate": ("clean", "sales", "汇总每日销售；直接求和订单总额，不再乘数量。"),
}


class Lineage:
    def __init__(self, config: Config):
        self.config = config
        self.names = {
            "source": f"{config.source_schema}.demo_orders",
            "clean": f"{config.analytics_schema}.demo_orders_clean",
            "sales": f"{config.analytics_schema}.demo_sales_daily",
        }

    def dataset(self, key: str) -> dict[str, Any]:
        return {
            "namespace": self.config.dataset_namespace,
            "name": self.names[key],
            "facets": {
                "schema": SchemaDatasetFacet(
                    fields=[SchemaDatasetFacetFields(name=n, type=t) for n, t in SCHEMAS[key]],
                    producer=PRODUCER,
                ),
                "documentation": DocumentationDatasetFacet(
                    description=DESCRIPTIONS[key], producer=PRODUCER
                ),
            },
        }

    def job(self, name: str) -> ol.Job:
        return ol.Job(
            namespace=self.config.job_namespace,
            name=name,
            facets={
                "jobType": JobTypeJobFacet(
                    processingType="BATCH", integration="PYTHON", jobType="SQL", producer=PRODUCER
                ),
                "documentation": DocumentationJobFacet(
                    description=JOBS[name][2], producer=PRODUCER
                ),
            },
        )

    def catalog(self) -> list[str]:
        now = datetime.now(UTC).isoformat()
        events: list[Any] = [
            ol.DatasetEvent(
                eventTime=now, producer=PRODUCER, dataset=ol.StaticDataset(**self.dataset(key))
            )
            for key in self.names
        ]
        for name, (input_key, output_key, _) in JOBS.items():
            events.append(
                ol.JobEvent(
                    eventTime=now,
                    producer=PRODUCER,
                    job=self.job(name),
                    inputs=[ol.InputDataset(**self.dataset(input_key))],
                    outputs=[ol.OutputDataset(**self.dataset(output_key))],
                )
            )
        return [Serde.to_json(event) for event in events]

    def run(
        self,
        job: str,
        run_id: str,
        state: str,
        *,
        input_count: int | None = None,
        output_count: int | None = None,
        error: str | None = None,
    ) -> str:
        input_key, output_key, _ = JOBS[job]
        event = ol.RunEvent(
            eventTime=datetime.now(UTC).isoformat(),
            producer=PRODUCER,
            eventType=ol.RunState[state],
            job=self.job(job),
            run=ol.Run(
                runId=run_id,
                facets={
                    "errorMessage": ErrorMessageRunFacet(
                        message=error, programmingLanguage="python", producer=PRODUCER
                    )
                }
                if error
                else {},
            ),
            inputs=[
                ol.InputDataset(
                    **self.dataset(input_key),
                    inputFacets={
                        "inputStatistics": InputStatisticsInputDatasetFacet(
                            rowCount=input_count, producer=PRODUCER
                        )
                    }
                    if input_count is not None
                    else {},
                )
            ],
            outputs=[
                ol.OutputDataset(
                    **self.dataset(output_key),
                    outputFacets={
                        "outputStatistics": OutputStatisticsOutputDatasetFacet(
                            rowCount=output_count, producer=PRODUCER
                        )
                    }
                    if output_count is not None
                    else {},
                )
            ],
        )
        return Serde.to_json(event)


def log(event: str, **fields: Any) -> None:
    print(
        json.dumps({"event": event, "service": "mall-data-pipeline", **fields}, ensure_ascii=False),
        flush=True,
    )
