#!/usr/bin/env python3
"""Provision a limited analytics account and a referenced Secret without printing secrets.

Run on a host with kubectl access. The existing MySQL deployment must provide
MYSQL_ROOT_PASSWORD. Supply OPENLINEAGE_TOKEN_FILE, or copy the existing DataKit
ingestion token with --from-datakit. This script never writes source orders.
"""

import argparse
import base64
import json
import os
import re
import secrets
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


def kubectl(args, data=None):
    # The current management host has Python 3.6; use byte pipes supported there.
    with subprocess.Popen(
        ["kubectl", *args],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    ) as process:
        output, _ = process.communicate(data.encode() if data is not None else None)
        if process.returncode:
            # API errors can echo a submitted Secret/SQL. Do not print raw stderr.
            raise RuntimeError(
                "kubectl operation failed; inspect cluster permissions/resources"
            )
    return output.decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--namespace", default="observability-demo")
    parser.add_argument("--mysql-deployment", default="demo-observability-demo-mysql")
    parser.add_argument("--secret", default="mall-data-pipeline")
    parser.add_argument("--from-datakit", action="store_true")
    parser.add_argument("--datakit-namespace", default="datakit")
    parser.add_argument("--datakit-daemonset", default="datakit")
    args = parser.parse_args()
    if args.from_datakit:
        ds = json.loads(
            kubectl(
                [
                    "-n",
                    args.datakit_namespace,
                    "get",
                    "ds",
                    args.datakit_daemonset,
                    "-o",
                    "json",
                ]
            )
        )
        env = [
            item
            for c in ds["spec"]["template"]["spec"]["containers"]
            for item in c.get("env", [])
            if item["name"] == "ENV_DATAWAY"
        ]
        if len(env) != 1 or "value" not in env[0]:
            raise ValueError(
                "DataKit must expose one literal ENV_DATAWAY; otherwise use a token file"
            )
        token = parse_qs(urlsplit(env[0]["value"]).query).get("token", [""])[0]
    else:
        token = Path(os.environ["OPENLINEAGE_TOKEN_FILE"]).read_text().strip()
    if not token or "\n" in token:
        raise ValueError("Ingestion token missing or invalid")
    existing = kubectl(
        [
            "-n",
            args.namespace,
            "get",
            "secret",
            args.secret,
            "--ignore-not-found",
            "-o",
            "json",
        ]
    )
    if (
        existing
        and json.loads(existing)["metadata"]
        .get("labels", {})
        .get("app.kubernetes.io/part-of")
        != "data-observability-demo"
    ):
        raise ValueError("Existing Secret is not owned by this bootstrap")
    mysql_command = [
        "-n",
        args.namespace,
        "exec",
        "-i",
        f"deployment/{args.mysql_deployment}",
        "--",
        "sh",
        "-c",
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B',
    ]
    if (
        not existing
        and kubectl(
            mysql_command, "SELECT COUNT(*) FROM mysql.user WHERE User='mall_pipeline';"
        ).strip()
        != "0"
    ):
        raise ValueError(
            "Existing database account has no owned Secret; refusing adoption"
        )
    password = (
        base64.b64decode(json.loads(existing)["data"]["mysql-password"]).decode()
        if existing
        else secrets.token_hex(24)
    )
    if not re.fullmatch(r"[a-f0-9]{48}", password):
        raise ValueError(
            "Existing Secret is not owned by this bootstrap; refusing account changes"
        )
    manifest = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {
            "name": args.secret,
            "namespace": args.namespace,
            "labels": {"app.kubernetes.io/part-of": "data-observability-demo"},
        },
        "type": "Opaque",
        "stringData": {"mysql-password": password, "openlineage-token": token},
    }
    # Persist the generated password before SQL so a partial bootstrap can be retried.
    kubectl(
        ["apply", "--server-side", "--field-manager=mall-data-bootstrap", "-f", "-"],
        json.dumps(manifest),
    )
    sql = f"""CREATE DATABASE IF NOT EXISTS mall_analytics
        CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        CREATE USER IF NOT EXISTS 'mall_pipeline'@'%' IDENTIFIED BY '{password}';
        GRANT SELECT ON selfheal.demo_orders TO 'mall_pipeline'@'%';
        GRANT SELECT,INSERT,UPDATE,DELETE,CREATE ON mall_analytics.* TO 'mall_pipeline'@'%';
    """
    kubectl(mysql_command, sql)

    print(
        f"Provisioned analytics database/account and Secret {args.namespace}/{args.secret}"
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, KeyError, ValueError) as error:
        print(f"Bootstrap failed: {type(error).__name__}; no credentials printed")
        raise SystemExit(1) from None
