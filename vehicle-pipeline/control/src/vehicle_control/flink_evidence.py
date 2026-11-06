"""Safe execution evidence from Flink REST, never an instruction to fail a run."""

import hashlib
import json
import re
from typing import Any


def attempt_identity(job_id: str, vertices: list[dict[str, Any]]) -> tuple[str | None, int]:
    attempts = []
    for vertex in vertices:
        subtasks = vertex.get("subtasks", [])
        if len(subtasks) != vertex.get("parallelism", 1):
            return None, 0
        for task in subtasks:
            if task.get("status") != "RUNNING" or task.get("start-time", 0) <= 0:
                return None, 0
            attempts.append((vertex["id"], task["subtask"], task["attempt"], task["start-time"]))
    if not attempts:
        return None, 0
    digest = hashlib.sha256(json.dumps(sorted(attempts)).encode()).hexdigest()[:32]
    return job_id + ":" + digest, min(row[3] for row in attempts)


def failures(snapshot: dict[str, Any], now_ms: int) -> list[dict[str, Any]]:
    output = []
    for entry in snapshot.get("exceptionHistory", {}).get("entries", []):
        stamp = entry.get("timestamp")
        if type(stamp) is not int or not 0 < stamp <= now_ms + 5000:
            continue
        raw = str(entry.get("stacktrace", ""))[:100000]
        kind = str(entry.get("exceptionName", ""))
        if not re.fullmatch(r"[A-Za-z_$][\w.$]{0,200}", kind):
            kind = "FlinkExecutionException"
        # Messages may contain credentials or row values; retain class/frame evidence only.
        classes = re.findall(r"(?:^|\n)(?:Caused by: )?([\w.$]+(?:Exception|Error))(?::|\s|$)", raw)
        if "org.apache.flink.runtime.jobmanager.scheduler.NoResourceAvailableException" in classes:
            kind = "org.apache.flink.runtime.jobmanager.scheduler.NoResourceAvailableException"
        code, stage = "FLINK_EXECUTION_FAILED", "task-execution"
        description = "Flink 引擎记录了执行异常，本次执行已失败；作业的自动恢复机制继续工作。"
        if kind.endswith("NoResourceAvailableException"):
            code, stage = "FLINK_RESOURCES_UNAVAILABLE", "resource-allocation"
            description = "Flink 无法获得执行任务所需的资源，本次执行已失败。"
        elif (
            kind == "org.apache.flink.util.FlinkExpectedException"
            and "TaskExecutor is shutting down" in raw
        ):
            code = "FLINK_TASKEXECUTOR_LOST"
            description = "TaskExecutor 退出，当前任务执行失败；恢复后从检查点重新执行。"
        frames = re.findall(r"(?m)^\s*at ([\w.$<>]+\([\w.$: -]+\))\s*$", raw)
        stack = "\n".join(
            [kind]
            + ["Caused by: " + c for c in classes if c != kind][:4]
            + ["\tat " + f for f in frames[:48]]
        )[:12000]
        output.append(
            {
                "atMs": stamp,
                "errorCode": code,
                "errorType": kind,
                "failureStage": stage,
                "stackTrace": stack,
                "message": f"{kind}；失败阶段：{stage}。{description}",
            }
        )
    return sorted(output, key=lambda item: item["atMs"])
