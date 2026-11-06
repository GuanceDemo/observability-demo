#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["boto3>=1.40,<2"]
# ///
"""Initialize lifecycle using an authenticated, loopback-only kubectl/SSH forward."""

import json
import sys

import boto3

config = json.load(sys.stdin)
client = boto3.client(
    "s3",
    endpoint_url=config["endpoint"],
    region_name="us-east-1",
    aws_access_key_id=config["access_key"],
    aws_secret_access_key=config["secret_key"],
)
client.head_bucket(Bucket="vehicle-lake")
rules = [
    {
        "ID": "retain-" + prefix + "-8d",
        "Status": "Enabled",
        "Filter": {"Prefix": prefix + "/"},
        "Expiration": {"Days": 8},
        "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1},
    }
    for prefix in ["clean", "anomalies", "quarantine"]
]
client.put_bucket_lifecycle_configuration(
    Bucket="vehicle-lake", LifecycleConfiguration={"Rules": rules}
)
actual = client.get_bucket_lifecycle_configuration(Bucket="vehicle-lake")["Rules"]
assert {r["ID"] for r in actual} == {r["ID"] for r in rules}
print(json.dumps({"bucket": "vehicle-lake", "retentionDays": 8, "rules": len(actual)}))
