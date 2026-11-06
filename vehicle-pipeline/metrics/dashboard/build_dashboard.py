"""Reproducible enhancement of the supplied lineage overview using verified metrics."""

import copy
import csv
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TAGS = {
    "pipeline": ("链路", "vehicle-telemetry"),
    "cluster": ("链路所属集群", "c0eba4a54613c4adfb108e850e1c7c7d5"),
    "topic": ("Topic", "vehicle.telemetry.raw.v1"),
    "consumer_group": ("消费组", "vehicle-flink-clean-v1"),
}
NAMES = {
    "android": "Android",
    "emqx": "EMQX",
    "kafka": "Kafka",
    "flink": "Flink",
    "spark": "Spark SQL",
    "parquet": "Parquet",
}
GROUPS = [
    ("链路总览", "#60A5FA"),
    ("阶段明细", "#94A3B8"),
    ("流量与积压趋势", "#22D3EE"),
    ("报表更新趋势", "#2DD4BF"),
    ("作业与血缘（全空间）", "#818CF8"),
]
UNKNOWN = [
    {"operation": "=", "mappingVal": "未知", "originalVal": ["-1"]},
    {"operation": "nodata", "mappingVal": "未知", "originalVal": ["N/A"]},
]
UNITS = {
    "data_delay_seconds": ["time", "s"],
    "updated_at_seconds": ["timeStamp", "s"],
    "collected_at_seconds": ["timeStamp", "s"],
    "report_updated_at_seconds": ["timeStamp", "s"],
    "committed_bytes": ["digital", "B"],
    "committed_files": ["custom", "个"],
    "read_rows": ["custom", "行"],
    "output_rows": ["custom", "行"],
}


def uid(name, prefix="chrt_"):
    return prefix + uuid.uuid5(uuid.NAMESPACE_URL, "vehicle-pipeline-dashboard/" + name).hex


def query(kind, field, alias, code, stage=None, trend=False, exclude=()):
    filters = [
        dict(id=uid(key), op="=", name=key, type="", logic="and", value="#{" + key + "}")
        for key in TAGS
    ]
    terms = ["`" + key + '` = "#{' + key + '}"' for key in TAGS]
    if stage:
        terms.append('`stage` = "' + stage + '"')
        filters.append(dict(id=uid(stage), op="=", name="stage", type="", logic="and", value=stage))
    for item in exclude:
        terms.append('`stage` != "' + item + '"')
        filters.append(dict(id=uid(item), op="!=", name="stage", type="", logic="and", value=item))
    if trend:
        terms.append("`" + field + "` >= 0")
        filters.append(
            dict(id=uid(field), op=">=", name=field, type="number", logic="and", value="0")
        )
    groups = list(TAGS) + ["stage"]
    func = "avg" if trend else "last"
    q = (
        "M::`vehicle_pipeline_stage`:("
        + func
        + "(`"
        + field
        + "`) AS `"
        + alias
        + "`) { "
        + " AND ".join(terms)
        + " } BY "
        + ", ".join("`" + x + "`" for x in groups)
    )
    return dict(
        name="",
        type=kind,
        unit="",
        color="",
        qtype="dql",
        queryGroup=code,
        datasource="dataflux",
        query=dict(
            q=q,
            code=code,
            fill=None,
            type="dql",
            alias=alias,
            field=[field] if kind == "table" else field,
            filters=filters,
            groupBy=groups,
            funcList=[],
            fieldFunc=func,
            namespace="metric",
            dataSource="vehicle_pipeline_stage",
            queryFuncs=[],
            groupByTime="",
            interval="",
        ),
    )


def chart(name, kind, group, pos, fields, stage=None, description="", exclude=()):
    trend = kind == "sequence"
    qs = [query(kind, f, a, chr(65 + i), stage, trend, exclude) for i, (f, a) in enumerate(fields)]
    settings = dict(
        alias=[],
        units=[
            dict(key=a, name=a, unit="", units=UNITS.get(f, ["custom", "条"])) for f, a in fields
        ],
        colors=[],
        levels=[],
        unitType="custom",
        globalUnit=UNITS.get(fields[0][0], ["custom", "条"]),
        fixedTime="15m" if trend else "45s",
        isSampling=True,
        timeInterval="auto",
        isCombineChart=False,
        isTimeInterval=trend,
        changeWorkspace=False,
        scientificNotation=False,
        enablePreflightEstimate=False,
        showTitle=True,
        titleDesc=description,
        decimalPlaces=2 if fields[0][0] == "data_delay_seconds" else 0,
        precision="2" if fields[0][0] == "data_delay_seconds" else "0",
        showLegend=trend,
        showFieldMapping=False,
        currentChartType=kind,
        mainMeasurementQueryCode="A",
        aliasVersion=2,
        openThousandsSeparator=True,
    )
    if kind == "singlestat":
        settings.update(
            downsample="last",
            mappings=copy.deepcopy(UNKNOWN),
            valueColor="#0891B2",
            bgColor="rgba(8,145,178,0.10)",
            borderColor="#E5E7EB",
        )
    elif kind == "table":
        settings.update(
            alias=[dict(key="stage", name="stage", alias="阶段", queryCode="")],
            slimit=20,
            pageEnable=False,
            queryMode="toGroupColumn",
            mainMeasurementField=fields[0][1],
            showColumns=[dict(name="stage")]
            + [dict(name=a, queryCode=chr(65 + i)) for i, (_, a) in enumerate(fields)],
            valMappings=[
                dict(field=a, queryCode=chr(65 + i), **mapping)
                for i, (_, a) in enumerate(fields)
                for mapping in UNKNOWN
            ],
        )
        settings["valMappings"] += [
            dict(field="stage", operation="=", mappingVal=v, originalVal=[k])
            for k, v in NAMES.items()
        ]
    else:
        settings.update(
            chartType="areaLine",
            currentChartType="area",
            connectNulls=False,
            lineType="step",
            yAxixMinVal=0,
            yAxixOpenIncludeZero=True,
        )
    return dict(
        uuid=uid(name),
        chartGroupUUID=uid(group, "grp_"),
        name=name,
        type=kind,
        group={"name": group},
        prevGroupName=None,
        pos=pos,
        queries=qs,
        extend=dict(
            settings=settings,
            fixedTime={
                "key": settings["fixedTime"],
                "text": "最近 15 分钟" if trend else "最近 45 秒",
            },
            isRefresh=True,
        ),
    )


def streaming_sankey():
    """Connect source-local ledgers, including opening stock and terminal branches."""
    queries = []
    for level in range(5):
        item = query("sankey", "value", "amount", chr(65 + level))
        terms = ["`" + key + '` = "#{' + key + '}"' for key in TAGS]
        terms.append(f'`level` = "{level}"')
        edge = (
            "M::`vehicle_pipeline_flow`:(last(`value`) AS `amount`) { "
            + " AND ".join(terms)
            + f' }} BY regexp_replace(`source`, "^", "") AS `n{level}`, '
            + f'regexp_replace(`target`, "^", "") AS `n{level + 1}` HAVING `amount` > 0'
        )
        item["query"].update(
            q=f"M::({edge}):(last(`amount`)) BY `n{level}`, `n{level + 1}`",
            # Nonempty metadata grouping makes Guance overwrite explicit DQL.
            groupBy=[],
            alias="",
            filters=[],
            fieldType="float",
            dataSource="vehicle_pipeline_flow",
        )
        queries.append(item)
    node_colors = [
        (0, "近1分钟新生成", "#2563EB"),
        (0, "Android 期初积压", "#D97706"),
        (1, "Android", "#2563EB"),
        (1, "EMQX 期初积压", "#D97706"),
        (2, "EMQX", "#0891B2"),
        (2, "Android 本地积压", "#F59E0B"),
        (2, "Android 丢弃", "#DC2626"),
        (2, "Kafka 期初未提交", "#D97706"),
        (3, "Kafka", "#0D9488"),
        (3, "EMQX 转发积压", "#F59E0B"),
        (3, "EMQX 投递失败", "#DC2626"),
        (3, "EMQX 丢弃", "#DC2626"),
        (3, "EMQX 迟到响应", "#64748B"),
        (4, "Flink", "#16A34A"),
        (4, "Kafka 当前未提交", "#F59E0B"),
        (5, "Parquet 清洗写入", "#059669"),
        (5, "Parquet 隔离写入", "#F97316"),
        (5, "Flink 去重丢弃", "#64748B"),
    ]
    return dict(
        uuid=uid("流式链路 · 近1分钟边界流量"),
        chartGroupUUID=uid("链路总览", "grp_"),
        name="流式链路 · 投递与积压分流",
        type="sankey",
        group={"name": "链路总览"},
        prevGroupName=None,
        pos=dict(x=0, y=6, w=24, h=18),
        queries=queries,
        extend=dict(
            fixedTime={"key": "45s", "text": "最近 45 秒"},
            isRefresh=True,
            settings=dict(
                alias=[],
                units=[],
                colors=[
                    dict(key=f"n{i}:{name}", name=f"n{i}:{name}", color=color)
                    for i, name, color in node_colors
                ],
                levels=[],
                unitType="global",
                globalUnit=["custom", "条"],
                fixedTime="45s",
                precision="1",
                showTitle=True,
                isSampling=True,
                timeInterval="auto",
                isTimeInterval=False,
                # Snapshot queries must keep the requested end time. Otherwise
                # Guance aligns the entire window and can return an older ledger.
                disabledAlignTime=True,
                changeWorkspace=False,
                currentChartType="sankey",
                showFieldMapping=False,
                scientificNotation=False,
                openThousandsSeparator=True,
                titleDesc=(
                    "各节点分出下游投递、当前积压及失败/丢弃；期初积压单独流入。"
                    "Android 新生成60、期初35且投递0时，本地积压95。"
                    "每个组件按自身60秒窗口核对收支，跨组件独立采样，不是同一批消息追踪。"
                    "Kafka 输出为提交位点推进，Flink 输出为清洗/隔离写入及去重丢弃。"
                    "0没有宽度；未知不绘制，见阶段明细。数值为真实观测的窗口估算，悬停查看。"
                ),
            ),
        ),
    )


def build():
    rows = list(csv.DictReader((ROOT / "vehicle_pipeline_stage.csv").open()))
    assert rows and all(set(TAGS) <= set(r["tag_key"].split(",")) for r in rows)
    fields_available = {"vehicle_pipeline_stage": {r["metric_name"] for r in rows}}
    flow_rows = list(csv.DictReader((ROOT / "vehicle_pipeline_flow.csv").open()))
    assert flow_rows and all(
        set(TAGS) | {"source", "target", "level"} <= set(r["tag_key"].split(",")) for r in flow_rows
    )
    fields_available["vehicle_pipeline_flow"] = {r["metric_name"] for r in flow_rows}
    base = json.loads((ROOT / "base-overview.json").read_text())
    dashboard = {
        k: copy.deepcopy(base.get(k, v))
        for k, v in dict(
            dashboardType="CUSTOM",
            dashboardOwnerType="node",
            dashboardBindSet=[],
            dashboardMapping=[],
            thumbnail="",
            iconSet={},
            tagInfo=[],
        ).items()
    }
    dashboard.update(
        title="数据可观测概览 · 车辆链路",
        summary="车辆链路统一口径：近1分钟输入/输出、原生积压、最近成功批次与数据延迟；保留全空间作业血缘概览。",
        dashboardExtend={"groupUnfoldStatus": {n: True for n, _ in GROUPS}},
        main={"vars": [], "groups": [], "charts": []},
    )
    m = dashboard["main"]
    for i, (key, (name, value)) in enumerate(TAGS.items()):
        m["vars"].append(
            dict(
                name=name,
                seq=i,
                datasource="dataflux",
                code=key,
                type="QUERY",
                definition=dict(
                    tag="",
                    field="",
                    value="SHOW_TAG_VALUE(from=['vehicle_pipeline_stage'],keyin=['"
                    + key
                    + "'])[1d]",
                    metric="",
                    object="",
                    defaultVal={"label": value, "value": value},
                ),
                valueSort="default",
                hide=0,
                isHiddenAsterisk=1,
                multiple=False,
                includeStar=False,
                extend={},
            )
        )
    for name, color in GROUPS:
        m["groups"].append(
            dict(name=name, uuid=uid(name, "grp_"), extend={"bgColor": color, "isExpanded": True})
        )
    cards = [
        ("EMQX 待投递", "emqx", "backlog", "排队 + 发送中，原生队列指标"),
        (
            "Kafka 消费积压",
            "kafka",
            "backlog",
            "Topic 末尾偏移量与消费组提交位置之差，含检查点提交延迟",
        ),
        (
            "Flink 近1分钟输入",
            "flink",
            "input_1m",
            "近60秒输入记录增量；检查点回退或采集恢复后需重新积累窗口",
        ),
        ("Spark 最近成功读取", "spark", "read_rows", "最近成功批次读取的原始记录数"),
        (
            "Spark 最近成功产出",
            "spark",
            "output_rows",
            "同一成功批次五分钟报表行数 + 日报表行数；不是去重后的输入行数",
        ),
        (
            "Spark 数据延迟",
            "spark",
            "data_delay_seconds",
            "当前采集时刻 − 最近成功批次覆盖的最新源事件时间",
        ),
    ]
    palette = ["#0891B2", "#D97706", "#059669", "#2563EB", "#7C3AED", "#DC2626"]
    for i, (name, stage, field, desc) in enumerate(cards):
        c = chart(
            name,
            "singlestat",
            "链路总览",
            dict(x=i * 4, y=0, w=4, h=6),
            [(field, name)],
            stage,
            desc,
        )
        color = palette[i]
        c["extend"]["settings"].update(
            valueColor=color,
            bgColor="rgba("
            + ",".join(str(int(color[j : j + 2], 16)) for j in (1, 3, 5))
            + ",0.10)",
        )
        m["charts"].append(c)
    m["charts"].append(streaming_sankey())
    content = """**Android → EMQX → Kafka → Flink → Parquet → Spark SQL**

**主图 · 投递与积压分流：**每个阶段从同一节点分出“流向下游”和“仍在积压”，失败、丢弃单列。
Android 的“近1分钟新生成”和“期初积压”共同流入 Android，再分为 MQTT 已确认、本地待确认和丢弃。
例如期初 35 + 新生成 60 = 本地积压 95 + 已投递 0；恢复补发后，流向 EMQX 的分支变宽。
期初指各组件当前 60 秒窗口开始时的存量；积压分支是窗口结束时仍待处理的总量，不能当作本分钟新增。

EMQX 分出转发成功、当前积压、投递失败、丢弃和迟到响应；Kafka 分出消费组已提交推进与当前未提交。
Flink 分出清洗、隔离写入和去重丢弃，内部积压未知，不生成没有依据的分叉。
各组件使用自身计数器核对窗口收支，跨阶段独立采样，并非同一批消息的全链路守恒追踪。
0 值没有宽度，未知不绘制；可结合阶段明细区分。悬停查看数量，“>”是流向分隔符，不是大于号。

流式阶段统一显示**近 60 秒输入 / 输出 + 当前积压**。一分钟增量按源采样时间计算，
窗口边界按相邻采样估算；卡片与明细取整，流量桑基图保留一位小数。
窗口不足、计数器回退或采集中断时显示“未知”，不补零、不沿用旧值。

**边界口径：**Android 输出是 MQTT 确认；
EMQX 输出是 Kafka 投递成功，积压为排队 + 发送中；
Kafka 输出是消费组已提交位点推进，积压包含检查点提交延迟；
Flink 输出是清洗 + 隔离记录，去重丢弃和异常副本不重复计入。
Flink 内部积压没有可靠原生数值，显示“未知”。
不同阶段不能直接相减推算丢失。

**Spark：**读取 / 产出来自同一最近成功批次，产出为实际两张报表的行数；
数据延迟＝采集时刻－该批次最新源事件。
Parquet 单独显示今天已落盘文件数 / 大小。
更新时间是源观测时间；报表更新时间单列。

**查询：**顶部四个标签关联本页链路指标，集群是链路所属 ACK 集群，Android / EMQX 运行于 GCP。
当前卡片 / 流式快照仅查最近 45 秒；落盘及采集健康查最近 2 分钟，
链路趋势固定最近 15 分钟，便于观察短时积压。建议自动刷新 10 秒，实际以页面右上角设置为准。
底部保留的全空间血缘图表沿用原查询，不受四个链路指标变量过滤。"""
    m["charts"].append(
        dict(
            uuid=uid("展示口径"),
            chartGroupUUID=uid("链路总览", "grp_"),
            name="展示口径",
            type="text",
            group={"name": "链路总览"},
            prevGroupName=None,
            pos=dict(x=0, y=24, w=24, h=14),
            extend={"settings": {"showTitle": True, "units": []}},
            queries=[{"name": "", "query": {"content": content}}],
        )
    )
    tables = [
        (
            "流式阶段 · 近1分钟与当前积压",
            None,
            [
                ("input_1m", "近1分钟输入"),
                ("output_1m", "近1分钟输出"),
                ("backlog", "当前积压"),
                ("updated_at_seconds", "源更新时间"),
            ],
            ("spark", "parquet"),
            10,
        ),
        (
            "Spark · 最近成功批次",
            "spark",
            [
                ("read_rows", "读取行数"),
                ("output_rows", "产出行数"),
                ("data_delay_seconds", "数据延迟"),
                ("report_updated_at_seconds", "报表更新时间"),
                ("updated_at_seconds", "采集更新时间"),
            ],
            (),
            8,
        ),
        (
            "Parquet · 今日已落盘",
            "parquet",
            [
                ("committed_files", "落盘文件数"),
                ("committed_bytes", "落盘大小"),
                ("updated_at_seconds", "采集更新时间"),
            ],
            (),
            8,
        ),
        (
            "采集状态与更新时间",
            None,
            [
                ("available", "采集状态"),
                ("updated_at_seconds", "最近有效观测"),
                ("collected_at_seconds", "最近采集尝试"),
            ],
            (),
            12,
        ),
    ]
    y = 0
    for name, stage, fields, exclude, h in tables:
        c = chart(
            name, "table", "阶段明细", dict(x=0, y=y, w=24, h=h), fields, stage, exclude=exclude
        )
        if stage == "parquet" or name == "采集状态与更新时间":
            c["extend"]["fixedTime"] = {"key": "2m", "text": "最近 2 分钟"}
            c["extend"]["settings"]["fixedTime"] = "2m"
        if name == "采集状态与更新时间":
            c["extend"]["settings"]["valMappings"] += [
                dict(field="采集状态", queryCode="A", operation="=", mappingVal=v, originalVal=[k])
                for k, v in [("1", "正常"), ("0", "未知")]
            ]
            c["extend"]["settings"]["units"][0]["units"] = ["custom", ""]
        m["charts"].append(c)
        y += h
    flow = [
        (
            "Android · 近1分钟输入 / 输出",
            "android",
            [("input_1m", "生成"), ("output_1m", "MQTT确认")],
        ),
        ("EMQX · 近1分钟输入 / 输出", "emqx", [("input_1m", "接入"), ("output_1m", "投递成功")]),
        ("EMQX · 当前待投递", "emqx", [("backlog", "排队与发送中")]),
        (
            "Kafka · 近1分钟写入 / 提交",
            "kafka",
            [("input_1m", "写入位点推进"), ("output_1m", "消费组提交推进")],
        ),
        ("Kafka · 当前消费积压", "kafka", [("backlog", "提交位点积压")]),
        (
            "Flink · 近1分钟输入 / 输出",
            "flink",
            [("input_1m", "输入"), ("output_1m", "清洗与隔离输出")],
        ),
    ]
    for i, (name, stage, fields) in enumerate(flow):
        m["charts"].append(
            chart(
                name,
                "sequence",
                "流量与积压趋势",
                dict(x=(i % 3) * 8, y=(i // 3) * 10, w=8, h=10),
                fields,
                stage,
                "未知与采集失败不补值，曲线断开。",
            )
        )
    for i, (name, stage, fields) in enumerate(
        [
            (
                "Spark · 最近成功批次读取 / 产出",
                "spark",
                [("read_rows", "读取行数"), ("output_rows", "报表产出行数")],
            ),
            ("Spark · 数据延迟", "spark", [("data_delay_seconds", "数据延迟")]),
            ("Parquet · 今日落盘推进", "parquet", [("committed_files", "已落盘文件数")]),
        ]
    ):
        m["charts"].append(
            chart(name, "sequence", "报表更新趋势", dict(x=i * 8, y=0, w=8, h=10), fields, stage)
        )
    for original in base["main"]["charts"]:
        c = copy.deepcopy(original)
        c.update(
            uuid=uid("base-" + c["name"]),
            chartGroupUUID=uid(GROUPS[-1][0], "grp_"),
            group={"name": GROUPS[-1][0]},
            prevGroupName=None,
        )
        for q in c.get("queries", []):
            if q.get("query", {}).get("code"):
                q["queryGroup"] = q["query"]["code"]
        settings = c["extend"]["settings"]
        settings["colors"] = []
        if not settings.get("units"):
            settings["units"] = [dict(key="", name="", unit="", units=["custom", ""])]
        m["charts"].append(c)
    for c in m["charts"]:
        for q in c.get("queries", []):
            inner = q.get("query", {})
            source = inner.get("dataSource")
            if source in fields_available:
                f = inner["field"]
                assert (f[0] if isinstance(f, list) else f) in fields_available[source]
    (ROOT / "data-observability-pipeline.json").write_text(
        json.dumps(dashboard, ensure_ascii=False, indent=2) + "\n"
    )
    print(
        "charts",
        len(m["charts"]),
        "queries",
        sum("q" in q.get("query", {}) for c in m["charts"] for q in c.get("queries", [])),
    )


if __name__ == "__main__":
    build()
