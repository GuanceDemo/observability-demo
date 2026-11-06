import json
from pathlib import Path

DASHBOARD = Path(__file__).resolve().parents[1] / "dashboard"


def test_dashboard_preserves_lineage_and_renders_unknown_without_stale_fill():
    base = json.loads((DASHBOARD / "base-overview.json").read_text())
    result = json.loads((DASHBOARD / "data-observability-pipeline.json").read_text())
    by_name = {c["name"]: c for c in result["main"]["charts"]}
    for c in base["main"]["charts"]:
        assert [q["query"].get("q") for q in c["queries"]] == [
            q["query"].get("q") for q in by_name[c["name"]]["queries"]
        ]
    variables = {v["code"] for v in result["main"]["vars"]}
    assert variables == {"pipeline", "cluster", "topic", "consumer_group"}
    for chart in result["main"]["charts"]:
        queries = [
            q
            for q in chart["queries"]
            if q.get("query", {}).get("dataSource") == "vehicle_pipeline_stage"
        ]
        if not queries:
            continue
        settings = chart["extend"]["settings"]
        # Guance expects the full object here, not a duration string (spinner regression).
        assert chart["extend"]["fixedTime"]["key"] == settings["fixedTime"]
        for query in queries:
            q = query["query"]
            assert query["queryGroup"] == q["code"]
            assert q["fill"] is None
            assert all("#{" + key + "}" in q["q"] for key in variables)
            if chart["type"] == "table":
                assert isinstance(q["field"], list) and len(q["field"]) == 1
            if chart["type"] == "sequence":
                assert "`" + q["field"] + "` >= 0" in q["q"]
                assert settings["connectNulls"] is False
        if chart["type"] == "singlestat":
            mappings = settings["mappings"]
            assert any(x["operation"] == "nodata" and x["mappingVal"] == "未知" for x in mappings)
            assert any(x["originalVal"] == ["-1"] and x["mappingVal"] == "未知" for x in mappings)


def test_sankey_connects_stage_branches_with_opening_stock_and_no_stale_fill():
    result = json.loads((DASHBOARD / "data-observability-pipeline.json").read_text())
    sankeys = [c for c in result["main"]["charts"] if c["type"] == "sankey"]
    assert len(sankeys) == 1
    sankey = sankeys[0]
    assert sankey["pos"]["w"] == 24
    assert len(sankey["queries"]) == 5
    settings = sankey["extend"]["settings"]
    # isTimeInterval=False alone does not disable the native request's align_time.
    # Keep the latest snapshot inside the same lookback as the summary cards.
    assert settings["disabledAlignTime"] is True
    assert settings["isTimeInterval"] is False
    assert settings["fixedTime"] == "45s"
    for i, item in enumerate(sankey["queries"]):
        query = item["query"]
        before_having, having = query["q"].split(" HAVING ")
        assert query["dataSource"] == "vehicle_pipeline_flow"
        assert "last(`value`)" in before_having
        assert "`value` >" not in before_having
        assert having.startswith("`amount` > 0)")
        assert f'`level` = "{i}"' in before_having
        assert "`source`" in before_having and "`target`" in before_having
        assert query["q"].endswith(f"BY `n{i}`, `n{i + 1}`")
        assert query["groupBy"] == []
        assert query["fill"] is None
        assert all(
            "#{" + key + "}" in query["q"]
            for key in ("pipeline", "cluster", "topic", "consumer_group")
        )
    colors = {x["key"] for x in sankey["extend"]["settings"]["colors"]}
    assert {
        "n0:近1分钟新生成",
        "n0:Android 期初积压",
        "n2:Android 本地积压",
        "n3:EMQX 转发积压",
        "n4:Kafka 当前未提交",
        "n5:Flink 去重丢弃",
    } <= colors
    assert "跨组件独立采样" in sankey["extend"]["settings"]["titleDesc"]
