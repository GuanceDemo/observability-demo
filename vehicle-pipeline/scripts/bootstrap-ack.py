#!/usr/bin/env python3
"""Run on the authorized ACK management host; credentials never leave stdin/Secrets."""

import base64
import json
import os
import secrets
import subprocess
import uuid
from pathlib import Path

NS = "vehicle-pipeline"
OWNER = "vehicle-telemetry-v1"


def run(args, data=None):
    return subprocess.check_output(args, input=data, universal_newlines=True)


def apply(value):
    run(["kubectl", "apply", "-f", "-"], json.dumps(value))


def get(kind, name, namespace):
    p = subprocess.run(
        ["kubectl", "get", kind, name, "-n", namespace, "-o", "json", "--ignore-not-found"],
        stdout=subprocess.PIPE,
        check=True,
        universal_newlines=True,
    )
    return json.loads(p.stdout) if p.stdout.strip() else None


def main():
    old = get("namespace", NS, NS)
    if old and old["metadata"].get("labels", {}).get("vehicle-owner") != OWNER:
        raise SystemExit("Refusing an unowned namespace")
    apply(
        {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {"name": NS, "labels": {"vehicle-owner": OWNER}},
        }
    )
    pods = json.loads(
        run(
            [
                "kubectl",
                "get",
                "pods",
                "-n",
                "observability-demo",
                "-l",
                "app.kubernetes.io/component=mysql",
                "-o",
                "json",
            ]
        )
    )["items"]
    if len(pods) != 1:
        raise SystemExit("Expected one existing MySQL pod")
    mysql_command = [
        "kubectl",
        "exec",
        "-i",
        "-n",
        "observability-demo",
        pods[0]["metadata"]["name"],
        "--",
        "sh",
        "-c",
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -N -uroot',
    ]
    secret = get("secret", NS, NS)
    if secret:
        if secret["metadata"].get("labels", {}).get("vehicle-owner") != OWNER:
            raise SystemExit("Refusing an unowned Secret")
        values = {k: base64.b64decode(v).decode() for k, v in secret["data"].items()}
    else:
        orphan = run(
            mysql_command,
            "SELECT (SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='vehicle_analytics') + (SELECT COUNT(*) FROM mysql.user WHERE user IN ('vehicle_writer','vehicle_control','vehicle_reader'));\n",
        )
        if int(orphan.strip()) != 0:
            raise SystemExit("Refusing existing database/accounts without the owned Secret")
        values = {
            k: secrets.token_hex(24)
            for k in [
                "kafka-admin",
                "kafka-emqx",
                "kafka-flink",
                "mysql-writer",
                "mysql-control",
                "mysql-reader",
                "s3-writer-secret",
                "s3-reader-secret",
                "bridge-token",
            ]
        }
        values.update(
            {
                "kafka-cluster-id": base64.urlsafe_b64encode(uuid.uuid4().bytes)
                .decode()
                .rstrip("="),
                "s3-writer-key": "vehiclewriter",
                "s3-reader-key": "vehiclereader",
            }
        )
        upstream = get("secret", "mall-data-pipeline", "observability-demo")
        values["openlineage-token"] = base64.b64decode(
            upstream["data"]["openlineage-token"]
        ).decode()
        jaas = (
            'org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="'
            + values["kafka-admin"]
            + '" '
            + " ".join(
                "user_" + role + '="' + values["kafka-" + role] + '"'
                for role in ["admin", "emqx", "flink"]
            )
            + ";"
        )
        values["kafka-server-properties"] = (
            "\n".join(
                [
                    "process.roles=broker,controller",
                    "node.id=1",
                    "controller.quorum.voters=1@localhost:9093",
                    "listeners=INTERNAL://0.0.0.0:9092,CONTROLLER://localhost:9093,TUNNEL://0.0.0.0:9094",
                    "advertised.listeners=INTERNAL://vehicle-kafka.vehicle-pipeline.svc.cluster.local:9092,TUNNEL://172.19.0.1:19092",
                    "listener.security.protocol.map=INTERNAL:SASL_PLAINTEXT,TUNNEL:SASL_PLAINTEXT,CONTROLLER:PLAINTEXT",
                    "controller.listener.names=CONTROLLER",
                    "inter.broker.listener.name=INTERNAL",
                    "sasl.enabled.mechanisms=PLAIN",
                    "sasl.mechanism.inter.broker.protocol=PLAIN",
                    "listener.name.internal.plain.sasl.jaas.config=" + jaas,
                    "listener.name.tunnel.plain.sasl.jaas.config=" + jaas,
                    "authorizer.class.name=org.apache.kafka.metadata.authorizer.StandardAuthorizer",
                    "super.users=User:admin;User:ANONYMOUS",
                    "allow.everyone.if.no.acl.found=false",
                    "log.dirs=/var/lib/kafka/data",
                    "num.partitions=1",
                    "default.replication.factor=1",
                    "offsets.topic.replication.factor=1",
                    "transaction.state.log.replication.factor=1",
                    "transaction.state.log.min.isr=1",
                    "log.retention.hours=168",
                    "log.retention.bytes=1073741824",
                    "log.segment.bytes=67108864",
                    "log.retention.check.interval.ms=60000",
                    "auto.create.topics.enable=false",
                    "group.initial.rebalance.delay.ms=0",
                ]
            )
            + "\n"
        )
        # ANONYMOUS is only the loopback-only controller; both externally reachable listeners require SASL.
        values["kafka-admin-properties"] = (
            'security.protocol=SASL_PLAINTEXT\nsasl.mechanism=PLAIN\nsasl.jaas.config=org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="'
            + values["kafka-admin"]
            + '";\n'
        )
        values["s3-config"] = json.dumps(
            {
                "identities": [
                    {
                        "name": "vehicle-writer",
                        "credentials": [
                            {
                                "accessKey": values["s3-writer-key"],
                                "secretKey": values["s3-writer-secret"],
                            }
                        ],
                        "actions": [
                            "Admin:vehicle-lake",
                            "Read:vehicle-lake",
                            "Write:vehicle-lake",
                            "List:vehicle-lake",
                            "Tagging:vehicle-lake",
                        ],
                    },
                    {
                        "name": "vehicle-reader",
                        "credentials": [
                            {
                                "accessKey": values["s3-reader-key"],
                                "secretKey": values["s3-reader-secret"],
                            }
                        ],
                        "actions": ["Read:vehicle-lake", "List:vehicle-lake"],
                    },
                ]
            }
        )
        # Persist credentials before modifying SQL, so an interrupted bootstrap can resume.
        apply(
            {
                "apiVersion": "v1",
                "kind": "Secret",
                "metadata": {"name": NS, "namespace": NS, "labels": {"vehicle-owner": OWNER}},
                "type": "Opaque",
                "stringData": values,
            }
        )
    sql = (
        "CREATE DATABASE IF NOT EXISTS vehicle_analytics CHARACTER SET utf8mb4;\nUSE vehicle_analytics;\n"
        + Path(__file__).parents[1].joinpath("schema.sql").read_text()
    )
    for role in ["writer", "control", "reader"]:
        sql += (
            "\nCREATE USER IF NOT EXISTS 'vehicle_"
            + role
            + "'@'%' IDENTIFIED BY '"
            + values["mysql-" + role]
            + "';\n"
        )
    sql += "GRANT SELECT ON vehicle_analytics.* TO 'vehicle_reader'@'%';\n"
    for table in [
        "pipeline_runs",
        "lineage_outbox",
        "report_batches",
        "vehicle_summary_5m",
        "vehicle_daily_summary",
    ]:
        sql += (
            "GRANT SELECT,INSERT,UPDATE,DELETE ON vehicle_analytics."
            + table
            + " TO 'vehicle_writer'@'%';\n"
        )
    sql += "GRANT SELECT ON vehicle_analytics.* TO 'vehicle_control'@'%';\n"
    for table in [
        "pipeline_runs",
        "lineage_outbox",
        "report_batches",
        "component_state",
        "emqx_snapshot",
    ]:
        sql += (
            "GRANT INSERT,UPDATE,DELETE ON vehicle_analytics."
            + table
            + " TO 'vehicle_control'@'%';\n"
        )
    run(mysql_command, sql)
    for folder, uid in [("kafka", 1000), ("lake", 0)]:
        path = Path("/var/lib/vehicle-pipeline") / folder
        path.mkdir(parents=True, exist_ok=True)
        os.chown(str(path), uid, uid)
        os.chmod(str(path), 0o750)
    print("Owned namespace, retained local paths, credentials and isolated SQL schema are ready.")


if __name__ == "__main__":
    main()
