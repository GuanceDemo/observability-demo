#!/usr/bin/env python3
"""Run once with the target namespace administrator's kubectl configuration."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from emqx_executor import EMQX_IMAGE

NAMESPACE = 'vehicle-pipeline'
OWNER = 'vehicle-demo-api-control'


def kubectl(*args, text=None):
    result = subprocess.run(['kubectl', '-n', NAMESPACE, *args], input=text,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            universal_newlines=True, timeout=45)
    if result.returncode:
        raise RuntimeError('kubectl failed; credential output withheld: ' + ' '.join(args[:2]))
    return result.stdout


def workload_hash():
    items = json.loads(kubectl('get', 'deployment,cronjob', '-o', 'json'))['items']
    for kind, name in [('Deployment', 'vehicle-control'), ('CronJob', 'vehicle-summary')]:
        resource = next((x for x in items if x['kind'] == kind and x['metadata']['name'] == name), None)
        annotations = (resource or {}).get('metadata', {}).get('annotations', {})
        if (annotations.get('meta.helm.sh/release-name') != NAMESPACE
                or annotations.get('meta.helm.sh/release-namespace') != NAMESPACE):
            raise RuntimeError('Target namespace ownership mismatch')
    data = sorted([{'kind': x['kind'], 'name': x['metadata']['name'],
                    'uid': x['metadata']['uid'], 'spec': x['spec']} for x in items],
                  key=lambda x: (x['kind'], x['name']))
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def emqx_executor_manifest():
    deployment = json.loads(kubectl('get', 'deployment', 'vehicle-emqx', '-o', 'json'))
    annotations = deployment['metadata'].get('annotations', {})
    if (annotations.get('meta.helm.sh/release-name') != NAMESPACE
            or annotations.get('meta.helm.sh/release-namespace') != NAMESPACE):
        raise RuntimeError('Unowned EMQX deployment')
    pods = json.loads(kubectl('get', 'pods', '-l', 'app=vehicle-emqx', '-o', 'json'))['items']
    if len(pods) != 1:
        raise RuntimeError('Expected one owned EMQX Pod')
    pod = pods[0]
    refs = pod['metadata'].get('ownerReferences', [])
    if len(refs) != 1 or refs[0]['kind'] != 'ReplicaSet' or not refs[0].get('controller'):
        raise RuntimeError('Unexpected EMQX Pod owner')
    rs = json.loads(kubectl('get', 'replicaset', refs[0]['name'], '-o', 'json'))
    owners = rs['metadata'].get('ownerReferences', [])
    if (rs['metadata']['uid'] != refs[0]['uid'] or len(owners) != 1
            or owners[0]['uid'] != deployment['metadata']['uid']
            or pod['spec']['containers'][0]['image'] != EMQX_IMAGE
            or pod['metadata'].get('deletionTimestamp')
            or not any(x.get('type') == 'Ready' and x.get('status') == 'True'
                       for x in pod.get('status', {}).get('conditions', []))):
        raise RuntimeError('EMQX ownership/version/readiness mismatch')
    name = 'vehicle-demo-emqx-executor'
    metadata = {'name': name, 'namespace': NAMESPACE,
                'labels': {'app.kubernetes.io/managed-by': OWNER}}
    resources = [
        {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'Role', 'metadata': metadata,
         'rules': [{'apiGroups': [''], 'resources': ['pods/exec'],
                    'resourceNames': [pod['metadata']['name']], 'verbs': ['get']}]},
        {'apiVersion': 'rbac.authorization.k8s.io/v1', 'kind': 'RoleBinding', 'metadata': metadata,
         'subjects': [{'kind': 'ServiceAccount', 'name': 'vehicle-demo-fault-worker', 'namespace': NAMESPACE}],
         'roleRef': {'kind': 'Role', 'name': name, 'apiGroup': 'rbac.authorization.k8s.io'}},
    ]
    return json.dumps({'apiVersion': 'v1', 'kind': 'List', 'items': resources})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username', help='Authenticated Kubernetes username, not context alias')
    parser.add_argument('--emqx-executor', action='store_true', help='Grant only current owned EMQX Pod exec to the existing worker')
    args = parser.parse_args()
    if not args.emqx_executor and not args.username:
        parser.error('--username is required for initial API setup')
    root = Path(__file__).resolve().parent
    manifest = (emqx_executor_manifest() if args.emqx_executor else
                (root / 'kubernetes-access.yaml').read_text().replace('__KUBERNETES_USER__', json.dumps(args.username)))
    state = (root / 'initial-state.json').read_text()
    before = workload_hash()
    inspect_manifest = manifest if args.emqx_executor else manifest + '\n---\n' + state
    existing_raw = kubectl('get', '-f', '-', '--ignore-not-found', '-o', 'json', text=inspect_manifest)
    existing = json.loads(existing_raw) if existing_raw.strip() else {'items': []}
    items = existing.get('items', [existing] if existing.get('kind') else [])
    for item in items:
        if item['metadata'].get('labels', {}).get('app.kubernetes.io/managed-by') != OWNER:
            raise RuntimeError('Refusing foreign-owned resource: ' + item['metadata']['name'])
    print(kubectl('apply', '-f', '-', text=manifest).strip())
    if not args.emqx_executor and not any(x['kind'] == 'ConfigMap' and x['metadata']['name'] == 'vehicle-demo-fault-state' for x in items):
        # Never apply/reset an existing operation or lease, including repeat setup.
        print(kubectl('create', '-f', '-', text=state).strip())
    else:
        print('Existing operation state preserved.')
    after = workload_hash()
    if before != after:
        raise RuntimeError('Workload specs changed during setup; inspect concurrent changes')
    print('Deployment/CronJob specs unchanged:', after)


if __name__ == '__main__':
    main()
