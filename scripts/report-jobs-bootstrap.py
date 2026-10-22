#!/usr/bin/env python3
"""Provision report-only accounts and Secrets; run on the Demo kubectl management host."""
import argparse
import base64
import json
import re
import secrets
import subprocess
from pathlib import Path


def kubectl(args, data=None):
    with subprocess.Popen(["kubectl", *args], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE) as process:
        output, _ = process.communicate(data.encode() if data is not None else None)
        if process.returncode:
            raise RuntimeError("kubectl failed; inspect permissions without printing Secret data")
    return output.decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--namespace", default="observability-demo")
    parser.add_argument("--mysql-deployment", default="demo-observability-demo-mysql")
    parser.add_argument("--source-secret", default="mall-data-pipeline")
    args = parser.parse_args()
    prefix = ["-n", args.namespace]
    source = json.loads(kubectl(prefix + ["get", "secret", args.source_secret, "-o", "json"]))
    token = base64.b64decode(source["data"]["openlineage-token"]).decode()
    if not token or "\n" in token or "\r" in token:
        raise ValueError("Invalid ingestion token")
    sql_command = prefix + ["exec", "-i", "deployment/" + args.mysql_deployment, "--", "sh", "-c",
                            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot -N -B']
    credentials = {}
    for name, user in [("mall-report-jobs", "mall_reports_writer"), ("mall-report-reader", "mall_reports_reader")]:
        raw = kubectl(prefix + ["get", "secret", name, "--ignore-not-found", "-o", "json"])
        existing = json.loads(raw) if raw else None
        if existing and existing["metadata"].get("labels", {}).get("app.kubernetes.io/part-of") != "mall-report-jobs":
            raise ValueError("Refusing unrelated Secret")
        if not existing and kubectl(sql_command, "SELECT COUNT(*) FROM mysql.user WHERE User='" + user + "';").strip() != "0":
            raise ValueError("Existing account has no owned Secret")
        password = base64.b64decode(existing["data"]["mysql-password"]).decode() if existing else secrets.token_hex(24)
        if not re.fullmatch(r"[a-f0-9]{48}", password):
            raise ValueError("Unexpected password format")
        credentials[user] = password
        manifest = {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
                    "metadata": {"name": name, "namespace": args.namespace,
                                 "labels": {"app.kubernetes.io/part-of": "mall-report-jobs"}},
                    "stringData": {"mysql-password": password}}
        if user == "mall_reports_writer":
            manifest["stringData"]["openlineage-token"] = token
        # Persist passwords before any database change, so partial bootstrap is retryable.
        kubectl(["apply", "--server-side", "--field-manager=mall-report-bootstrap", "-f", "-"], json.dumps(manifest))
    schema = Path(__file__).resolve().parent.parent / "report-jobs/src/main/resources/schema.sql"
    sql = "CREATE DATABASE IF NOT EXISTS mall_reports CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE mall_reports;\n" + schema.read_text()
    for user, password in credentials.items():
        sql += "\nCREATE USER IF NOT EXISTS '" + user + "'@'%' IDENTIFIED BY '" + password + "';"
    sql += """
GRANT SELECT ON mall_analytics.demo_sales_daily TO 'mall_reports_writer'@'%';
GRANT SELECT ON mall_analytics.pipeline_runs TO 'mall_reports_writer'@'%';
GRANT SELECT,INSERT,UPDATE,DELETE ON mall_reports.* TO 'mall_reports_writer'@'%';
GRANT SELECT ON mall_reports.demo_sales_trend TO 'mall_reports_reader'@'%';
GRANT SELECT ON mall_reports.report_runs TO 'mall_reports_reader'@'%';
"""
    kubectl(sql_command, sql)
    print("Provisioned mall_reports, writer/reader accounts and owned Secrets")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, KeyError, ValueError) as error:
        print("Bootstrap failed: " + type(error).__name__ + "; credentials omitted")
        raise SystemExit(1) from None
