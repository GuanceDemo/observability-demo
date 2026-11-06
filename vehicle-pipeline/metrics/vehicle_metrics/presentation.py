"""Source-aware dashboard snapshots; -1 means unknown, never a business count."""

from collections import deque

from .points import point

UNKNOWN = -1
STREAMS = {"android", "emqx", "kafka", "flink"}


class MinuteWindow:
    def __init__(self):
        self.samples = deque()
        self.identity = None

    def clear(self):
        self.samples.clear()

    def observe(self, at, counters, identity):
        values = tuple(counters)
        if self.samples:
            prior_at, prior = self.samples[-1]
            if (
                identity != self.identity
                or at < prior_at
                or at - prior_at > 35
                or any(new < old for new, old in zip(values, prior, strict=True))
            ):
                self.clear()
            elif at == prior_at:
                return self.delta()
        self.identity = identity
        self.samples.append((at, values))
        while len(self.samples) > 2 and self.samples[1][0] <= at - 60:
            self.samples.popleft()
        return self.delta()

    def delta(self):
        if len(self.samples) < 2:
            return UNKNOWN, UNKNOWN
        at, values = self.samples[-1]
        target = at - 60
        left, right = self.samples[0], self.samples[1]
        if not left[0] <= target <= right[0]:
            return UNKNOWN, UNKNOWN
        ratio = (target - left[0]) / (right[0] - left[0])
        baseline = tuple(a + ratio * (b - a) for a, b in zip(left[1], right[1], strict=True))
        return tuple(max(0.0, v - b) for v, b in zip(values, baseline, strict=True))


class StageProjection:
    def __init__(self, source):
        self.source = source
        self.window = MinuteWindow()
        self.last_observed = UNKNOWN

    def build(self, points, now):
        source = self.source
        fields = {
            "available": 0,
            "collected_at_seconds": now,
            "updated_at_seconds": self.last_observed,
        }
        if source in STREAMS:
            fields.update(input_1m=UNKNOWN, output_1m=UNKNOWN, backlog=UNKNOWN)
        elif source == "spark":
            fields.update(
                read_rows=UNKNOWN,
                output_rows=UNKNOWN,
                data_delay_seconds=UNKNOWN,
                report_updated_at_seconds=UNKNOWN,
            )
        else:
            fields.update(committed_files=UNKNOWN, committed_bytes=UNKNOWN)
        raw = [p for p in points if p["measurement"] == "vehicle_pipeline_" + source]
        if not raw:
            self.window.clear()
        else:
            p = raw[0]
            f = p["fields"]
            at = p.get("observed_at", p["time"] / 1e9)
            self.last_observed = at
            fields.update(available=1, updated_at_seconds=at)
            identity = p.get("identity", source)
            if source == "android":
                counts = f["generated"], f["acknowledged"]
                fields["backlog"] = f["pending"]
            elif source == "emqx":
                counts = f["matched"], f["success"]
                fields["backlog"] = f["queuing"] + f["inflight"]
            elif source == "kafka":
                ordered = sorted(raw, key=lambda item: item["tags"]["partition"])
                # A membership change or reset of ANY partition invalidates the window.
                identity = tuple(item["tags"]["partition"] for item in ordered)
                counts = tuple(
                    item["fields"][key]
                    for item in ordered
                    for key in ("end_offset", "committed_offset")
                )
                fields["backlog"] = sum(item["fields"]["committed_lag"] for item in raw)
            elif source == "flink":
                counts = f["input"], f["clean"] + f["quarantine"]
            elif source == "spark":
                fields.update(
                    read_rows=f["input_rows"],
                    output_rows=f["five_minute_rows"] + f["daily_rows"],
                    data_delay_seconds=f["source_age_seconds"],
                    report_updated_at_seconds=f["batch_completed_time_seconds"],
                )
            else:
                fields.update(
                    committed_files=sum(item["fields"]["committed_files"] for item in raw),
                    committed_bytes=sum(item["fields"]["committed_bytes"] for item in raw),
                )
            if source in STREAMS:
                delta = self.window.observe(at, counts, identity)
                if source == "kafka" and delta != (UNKNOWN, UNKNOWN):
                    fields.update(input_1m=sum(delta[::2]), output_1m=sum(delta[1::2]))
                else:
                    fields.update(input_1m=delta[0], output_1m=delta[1])
        result = point(
            "stage", {k: v for k, v in fields.items() if v != UNKNOWN}, now, stage=source
        )
        result["fields"].update({k: UNKNOWN for k, v in fields.items() if v == UNKNOWN})
        return result
