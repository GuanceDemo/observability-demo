"""Render both charts offline and verify the opt-in deployment boundary."""
from pathlib import Path
import subprocess
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[4]


def render(pipeline=True, enabled=True, **overrides):
    chart = 'vehicle-pipeline/deploy/chart' if pipeline else 'charts/observability-demo'
    release = 'vehicle-pipeline' if pipeline else 'demo'
    namespace = 'vehicle-pipeline' if pipeline else 'observability-demo'
    values = ({'processingEnabled': 'true', 'workbench.enabled': str(enabled).lower(),
               'workbench.image': 'example.test/workbench:test', 'workbench.publicOrigin': 'https://demo.example.test'}
              if pipeline else {'vehicleWorkbench.enabled': str(enabled).lower()})
    values.update(overrides)
    result = subprocess.run(['helm', 'template', release, chart, '-n', namespace,
                             *[arg for key, value in values.items() for arg in ['--set', key + '=' + value]]],
                            cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode:
        raise ValueError(result.stderr)
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


class AckChartTests(unittest.TestCase):
    def test_default_does_not_deploy_workbench(self):
        self.assertFalse(any(d['metadata']['name'] == 'vehicle-workbench' for d in render(enabled=False)))
        main = render(pipeline=False, enabled=False)
        env = [e for d in main if d['kind'] == 'Deployment'
               for c in d['spec']['template']['spec']['containers'] for e in c.get('env', [])]
        self.assertNotIn('VEHICLE_GATEWAY_TOKEN', [e['name'] for e in env])
        self.assertIn({'name': 'VEHICLE_WORKBENCH_ENABLED', 'value': 'false'}, env)

    def test_private_service_projected_identity_and_no_local_mounts(self):
        docs = render()
        own = {d['kind']: d for d in docs if d['metadata']['name'] == 'vehicle-workbench'}
        self.assertEqual(own['Service']['spec']['type'], 'ClusterIP')
        deployment = own['Deployment']['spec']
        self.assertEqual(deployment['replicas'], 1)
        self.assertEqual(deployment['strategy']['type'], 'Recreate')
        pod = deployment['template']['spec']
        self.assertEqual(pod['serviceAccountName'], 'vehicle-workbench')
        self.assertTrue(pod['automountServiceAccountToken'])
        self.assertNotIn('hostPath', str(pod))
        container = pod['containers'][0]
        self.assertTrue(container['securityContext']['readOnlyRootFilesystem'])
        env = {e['name']: e for e in container['env']}
        self.assertEqual(env['VEHICLE_GATEWAY_TOKEN']['valueFrom']['secretKeyRef']['key'], 'gateway-token')
        self.assertIn('.svc.cluster.local:8080/api/report', env['VEHICLE_REPORT_URL']['value'])
        self.assertNotIn('VEHICLE_KUBECONFIG', env)
        rules = own['Role']['rules']
        self.assertFalse(any('*' in str(r) or 'secrets' in r['resources'] or 'pods/exec' in r['resources'] for r in rules))
        self.assertFalse(any(d['kind'] == 'ClusterRole' for d in docs))
        self.assertFalse(any(d['metadata']['name'] == 'vehicle-demo-fault-state' for d in docs))
        self.assertFalse(any(d['metadata']['name'] == 'vehicle-demo-fault-worker' for d in docs))
        allow = next(d for d in docs if d['metadata']['name'] == 'vehicle-workbench-gateway')
        peer = allow['spec']['ingress'][0]['from'][0]
        self.assertEqual(peer['namespaceSelector']['matchLabels']['kubernetes.io/metadata.name'], 'observability-demo')
        self.assertEqual(peer['podSelector']['matchLabels']['app.kubernetes.io/component'], 'gateway-service')

    def test_gateway_is_only_main_service_with_hop_secret(self):
        for d in render(pipeline=False):
            if d['kind'] != 'Deployment':
                continue
            for c in d['spec']['template']['spec']['containers']:
                env = {e['name']: e for e in c.get('env', [])}
                if c['name'] == 'gateway-service':
                    self.assertIn('VEHICLE_WORKBENCH_URL', env)
                    self.assertEqual(env['VEHICLE_GATEWAY_TOKEN']['valueFrom']['secretKeyRef'],
                                     {'name': 'vehicle-workbench-gateway', 'key': 'gateway-token'})
                else:
                    self.assertNotIn('VEHICLE_GATEWAY_TOKEN', env)
                if c['name'] == 'order-service':
                    self.assertEqual(env['VEHICLE_WORKBENCH_ENABLED']['value'], 'true')

    def test_missing_configuration_fails_render(self):
        for values in [{'workbench.image': ''}, {'workbench.image': 'example/workbench:latest'},
                       {'workbench.publicOrigin': ''}, {'workbench.publicOrigin': 'http://demo.test'},
                       {'workbench.secretName': ''}, {'processingEnabled': 'false'}]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                render(**values)


if __name__ == '__main__':
    unittest.main()
