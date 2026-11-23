"""APM drawer view: inherit Span identity, keep chain metrics and real Run records."""

import copy
import json
from pathlib import Path

from build_dashboard import uid

ROOT = Path(__file__).resolve().parent
TITLE = "车辆链路 · APM 关联分析"
SERVICE_LABELS = {
    "vehicle-android-producer": "Android · 遥测发送",
    "emqx": "EMQX · 消息转发",
    "vehicle-flink-consumer": "Flink · 清洗与检测",
    "vehicle-spark-summary": "Spark · 统计汇总",
}
JOB_LABELS = {
    "emqx_telemetry_to_kafka": "EMQX · 消息转发",
    "vehicle_clean_and_detect": "Flink · 清洗与检测",
    "vehicle_summary": "Spark · 统计汇总",
}


def variable(code, name, query, seq):
    return {
        "name": name,
        "code": code,
        "seq": seq,
        "datasource": "dataflux",
        "type": "QUERY",
        "definition": {"value": query, "defaultVal": {"label": "全部", "value": "*"}},
        "valueSort": "default",
        "hide": 0,
        "multiple": False,
        "includeStar": True,
        "isHiddenAsterisk": 0,
        "extend": {},
    }


def table(template, name, group, namespace, source, field, alias, function, groups, query):
    result = copy.deepcopy(template)
    result.update(
        uuid=uid(TITLE + name),
        name=name,
        group={"name": group},
        chartGroupUUID=uid(TITLE + group, "grp_"),
        pos={"x": 0, "y": 0, "w": 24, "h": 12},
    )
    item = result["queries"][0]
    item.update(queryGroup="A", name="", qtype="dql", color="", unit="")
    item["query"].update(
        q=query,
        code="A",
        field=[field],
        alias=alias,
        namespace=namespace,
        dataSource=source,
        filters=[],
        groupBy=groups,
        fieldFunc=function,
        funcList=[],
        queryFuncs=[],
        fill=None,
    )
    result["queries"] = [item]
    result["extend"]["fixedTime"] = ""
    settings = result["extend"]["settings"]
    settings.update(
        fixedTime="",
        disabledAlignTime=True,
        alias=[],
        mappings=[],
        valMappings=[],
        units=[],
        globalUnit=["custom", ""],
        scientificNotation=False,
        mainMeasurementField=alias,
        showColumns=[{"name": k} for k in groups] + [{"name": alias, "queryCode": "A"}],
    )
    return result


def build():
    data = json.loads((ROOT / "data-observability-pipeline.json").read_text())
    data.update(
        title=TITLE,
        dashboardOwnerType="inner",
        identifier="vehicle-apm-correlation",
        dashboardBindSet=[],
        summary="从当前 Span 关联链路指标、同 Trace 的服务和真实作业运行。",
    )
    main = data["main"]
    main["charts"] = [c for c in main["charts"][:12] if c["type"] != "text"]
    main["groups"] = main["groups"][:2]
    for c in main["charts"]:
        c["uuid"] = uid(TITLE + c["name"])
        c["chartGroupUUID"] = uid(TITLE + c["group"]["name"], "grp_")
        # Incident context follows the drawer's selected time, including historical Spans.
        c["extend"]["fixedTime"] = ""
        c["extend"]["settings"].update(fixedTime="", disabledAlignTime=True)
    for group in main["groups"]:
        group["uuid"] = uid(TITLE + group["name"], "grp_")
    main["vars"] += [
        variable(
            "trace_id",
            "当前 Trace",
            "T::*:(distinct(`trace_id`)) "
            "{service IN ['vehicle-android-producer','emqx','vehicle-flink-consumer',"
            "'vehicle-spark-summary']} LIMIT 20",
            4,
        ),
        variable(
            "job_name",
            "作业",
            "LN::run_event:(distinct(`job_name`)) "
            "{lineage_record_type='event' AND job_namespace='vehicle-demo.telemetry'}",
            5,
        ),
        variable(
            "run_id",
            "运行",
            "LN::run_event:(distinct(`run_id`)) "
            "{lineage_record_type='event' AND job_namespace='vehicle-demo.telemetry' "
            "AND wildcard(job_name,'#{job_name}')}",
            6,
        ),
    ]
    # Native selectors show identifiers verbatim, including the literal '*'.
    # Keep all original codes/values for inherited context, but collapse the
    # technical filter bar in the presentation view.
    for item in main["vars"]:
        item["hide"] = 1
    template = next(c for c in main["charts"] if c["type"] == "table")
    extra = [
        table(
            template,
            "本次请求 · 各环节处理",
            "请求与运行关联",
            "tracing",
            "*",
            "*",
            "Span 数",
            "count",
            ["service", "resource", "trace_id"],
            "T::*:(count(*) AS `Span 数`) {trace_id='#{trace_id}' AND "
            "service IN ['vehicle-android-producer','emqx','vehicle-flink-consumer',"
            "'vehicle-spark-summary']} "
            "BY service,resource,trace_id",
        ),
        table(
            template,
            "作业运行 · 状态与上报时间",
            "请求与运行关联",
            "lineage",
            "run_event",
            "event_type",
            "最新事件",
            "last",
            ["job_name", "run_id", "job_id"],
            "LN::run_event:(last(event_type) AS `最新事件`) {lineage_record_type='event' "
            "AND job_namespace='vehicle-demo.telemetry' "
            "AND wildcard(job_name,'#{job_name}') "
            "AND wildcard(run_id,'#{run_id}')} BY job_name,run_id,job_id",
        ),
    ]
    request_settings = extra[0]["extend"]["settings"]
    request_settings["showColumns"] = [
        {"name": "service"},
        {"name": "resource"},
        {"name": "Span 数", "queryCode": "A"},
    ]
    request_settings["alias"] = [
        dict(key=key, name=key, alias=label, queryCode="")
        for key, label in {"service": "处理环节", "resource": "操作"}.items()
    ]
    request_settings["valMappings"] = [
        dict(field=field, operation="=", mappingVal=label, originalVal=[value])
        for field, labels in {
            "service": SERVICE_LABELS,
            "resource": {
                "mqtt.publish": "发送遥测消息",
                "process_message": "接收并转发消息",
                "kafka.process": "消费并清洗数据",
                "flink.clean_and_detect": "清洗并检测遥测数据",
                "spark.batch": "执行汇总批次",
                "spark.initialize": "初始化 Spark",
                "spark.snapshot": "确认输入快照",
                "spark.read": "读取明细数据",
                "spark.deduplicate": "去重并检查数据",
                "spark.aggregate": "计算汇总结果",
                "spark.publish": "提交报表批次",
            },
        }.items()
        for value, label in labels.items()
    ]

    runs = extra[1]
    timestamp = copy.deepcopy(runs["queries"][0])
    timestamp["queryGroup"] = "B"
    timestamp["query"].update(
        code="B",
        field=["time"],
        alias="最近上报时间",
        fieldFunc="max",
        q=runs["queries"][0]["query"]["q"].replace(
            "last(event_type) AS `最新事件`", "max(time) AS `最近上报时间`"
        ),
    )
    runs["queries"].append(timestamp)
    run_settings = runs["extend"]["settings"]
    run_settings.update(
        titleDesc="按当前作业及运行上下文筛选；未指定时显示所选时间范围内的全部运行。"
        "最近上报时间是运行事件的上报时间。完整 Run/Job ID 保留用于定位，可在表格列设置中查看。",
        showColumns=[
            {"name": "job_name"},
            {"name": "最近上报时间", "queryCode": "B"},
            {"name": "最新事件", "queryCode": "A"},
        ],
        alias=[
            dict(key="job_name", name="job_name", alias="作业", queryCode=""),
            dict(key="最新事件", name="最新事件", alias="运行状态", queryCode="A"),
        ],
        units=[
            dict(key="最近上报时间", name="最近上报时间", unit="", units=["timeStamp", "ms"])
        ],
        valMappings=[
            dict(field="job_name", operation="=", mappingVal=label, originalVal=[value])
            for value, label in JOB_LABELS.items()
        ]
        + [
            dict(
                field="最新事件",
                queryCode="A",
                operation="=",
                mappingVal=label,
                originalVal=[value],
            )
            for value, label in {
                "START": "已开始",
                "RUNNING": "运行中",
                "COMPLETE": "成功",
                "FAIL": "失败",
                "ABORT": "已中止",
            }.items()
        ],
    )
    extra[1]["pos"]["y"] = 12
    main["charts"] += extra
    main["groups"].append(
        {
            "uuid": uid(TITLE + "请求与运行关联", "grp_"),
            "name": "请求与运行关联",
            "extend": {"bgColor": "#CBD5E1", "isExpanded": True},
        }
    )
    data["dashboardExtend"] = {"groupUnfoldStatus": {g["name"]: True for g in main["groups"]}}
    return data


if __name__ == "__main__":
    (ROOT / "vehicle-apm-correlation.json").write_text(
        json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    )
