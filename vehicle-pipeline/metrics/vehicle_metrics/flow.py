"""Window-local queue ledgers for the node-branch Sankey, not event-cohort tracing."""

from .points import point
from .presentation import UNKNOWN, MinuteWindow

# Each tuple is (layer, source, target, ledger field). Adjacent layers share nodes.
EDGES = {
    "android": [
        (0, "近1分钟新生成", "Android", "input"),
        (0, "Android 期初积压", "Android", "opening"),
        (1, "Android", "EMQX", "output"),
        (1, "Android", "Android 本地积压", "closing"),
        (1, "Android", "Android 丢弃", "dropped"),
    ],
    "emqx": [
        (1, "EMQX 期初积压", "EMQX", "opening"),
        (2, "EMQX", "Kafka", "output"),
        (2, "EMQX", "EMQX 转发积压", "closing"),
        (2, "EMQX", "EMQX 投递失败", "failed"),
        (2, "EMQX", "EMQX 丢弃", "dropped"),
        (2, "EMQX", "EMQX 迟到响应", "late_reply"),
    ],
    "kafka": [
        (2, "Kafka 期初未提交", "Kafka", "opening"),
        (3, "Kafka", "Flink", "output"),
        (3, "Kafka", "Kafka 当前未提交", "closing"),
    ],
    "flink": [
        (4, "Flink", "Parquet 清洗写入", "clean"),
        (4, "Flink", "Parquet 隔离写入", "quarantine"),
        (4, "Flink", "Flink 去重丢弃", "duplicates"),
    ],
}


class FlowProjection:
    def __init__(self, source):
        self.source = source
        self.window = MinuteWindow()

    def ledger(self, raw):
        source = self.source
        p = raw[0]
        f = p["fields"]
        at = p.get("observed_at", p["time"] / 1e9)
        identity = p.get("identity", source)
        if source == "android":
            counts = (f["generated"], f["acknowledged"], f["dropped"])
            closing = counts[0] - sum(counts[1:])
            # Native pending is a separate Room read; the diagnostic contract allows ±1.
            if closing < 0 or abs(closing - f["pending"]) > 1 + 1e-6:
                raise ValueError("android_flow_incoherent")
        elif source == "emqx":
            counts = tuple(f[k] for k in ("matched", "success", "failed", "dropped", "late_reply"))
            closing = counts[0] - sum(counts[1:])
            if closing < 0 or abs(closing - f["queuing"] - f["inflight"]) > 1 + 1e-6:
                raise ValueError("emqx_flow_incoherent")
        elif source == "kafka":
            ordered = sorted(raw, key=lambda x: x["tags"]["partition"])
            identity = tuple(x["tags"]["partition"] for x in ordered)
            counts = tuple(
                x["fields"][k] for x in ordered for k in ("end_offset", "committed_offset")
            )
            closing = 0
            for item in ordered:
                fields = item["fields"]
                lag = fields["end_offset"] - fields["committed_offset"]
                if lag < 0 or abs(lag - fields["committed_lag"]) > 1 + 1e-6:
                    raise ValueError("kafka_flow_incoherent")
                closing += lag
        else:
            counts = tuple(f[k] for k in ("input", "clean", "quarantine", "duplicates"))
            closing = 0
            if counts[0] != sum(counts[1:]):
                raise ValueError("flink_flow_incoherent")
        delta = self.window.observe(at, counts, identity)
        if delta[0] == UNKNOWN:
            return {}, at
        if source == "kafka":
            result = dict(input=sum(delta[::2]), output=sum(delta[1::2]))
        elif source == "flink":
            result = dict(zip(("input", "clean", "quarantine", "duplicates"), delta, strict=True))
            return result, at
        else:
            keys = (
                ("input", "output", "dropped")
                if source == "android"
                else ("input", "output", "failed", "dropped", "late_reply")
            )
            result = dict(zip(keys, delta, strict=True))
        # Same-source cumulative conservation gives the interpolated opening stock.
        # Never infer a queue from totals belonging to different components.
        opening = closing + sum(v for k, v in result.items() if k != "input") - result["input"]
        if opening < -1e-6:
            raise ValueError("negative_opening_stock")
        result.update(opening=max(0.0, opening), closing=closing)
        return result, at

    def build(self, points, now):
        if self.source not in EDGES:
            return []
        raw = [p for p in points if p["measurement"] == "vehicle_pipeline_" + self.source]
        values, at = {}, UNKNOWN
        try:
            if not raw:
                raise ValueError("flow_source_unavailable")
            values, at = self.ledger(raw)
        except (KeyError, ValueError, TypeError, IndexError):
            self.window.clear()
        result = []
        for level, source, target, field in EDGES[self.source]:
            p = point(
                "flow",
                {"available": int(bool(values))},
                now,
                stage=self.source,
                level=str(level),
                source=source,
                target=target,
            )
            p["fields"].update(
                value=values.get(field, UNKNOWN),
                updated_at_seconds=at,
                window_start_seconds=at - 60 if values else UNKNOWN,
            )
            result.append(p)
        return result
