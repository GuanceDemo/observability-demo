#!/usr/bin/env python3
"""Offline contracts for external Agent injection; never talks to a cluster."""
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent


def render(*settings, ok=True):
    args = ['helm', 'template', 'demo', 'charts/observability-demo', '--namespace', 'observability-demo', '--show-only', 'templates/java-deployments.yaml']
    for setting in settings:
        args.extend(['--set-string', setting])
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    if not ok:
        return result
    return [part for part in result.stdout.split('---') if 'kind: Deployment' in part]


class InjectionContracts(unittest.TestCase):
    def test_plain_business_images(self):
        for service in ['gateway', 'order', 'inventory', 'payment', 'game']:
            text = (ROOT / f'{service}-service/Dockerfile').read_text()
            self.assertNotIn('dd-java-agent', text)
            self.assertNotIn('javaagent', text)
            self.assertIn('ENTRYPOINT ["java", "-jar", "/app/app.jar"]', text)

    def test_portable_init_and_preserved_identity(self):
        docs = render()
        self.assertEqual(len(docs), 5)
        for text in docs:
            self.assertEqual(text.count('-javaagent:'), 1)
            self.assertIn('admission.datakit/ddtrace.enabled: "false"', text)
            self.assertIn('name: ddtrace-init', text)
            self.assertIn('dd-lib-java-init:v1.65.6-ext', text)
            self.assertIn('runAsUser: 10001', text)
            for key in ['DD_SERVICE', 'DD_VERSION', 'DD_ENV', 'DD_AGENT_HOST', 'DD_TAGS', 'DD_JMXFETCH_ENABLED', 'DD_PROFILING_ENABLED']:
                self.assertIn('name: ' + key, text)
            self.assertIn('value: "2.4.1"', text)

    def test_operator_exclusive_and_version_rollout(self):
        for text in render('ddtrace.mode=operator', 'ddtrace.version=v1.65.6-ext'):
            self.assertIn('admission.datakit/ddtrace-language: java', text)
            self.assertIn('admission.datakit/java-lib.version: "v1.65.6-ext"', text)
            self.assertIn('admission.datakit/ddtrace.enabled: "true"', text)
            self.assertNotIn('initContainers:', text)
            self.assertNotIn('JAVA_TOOL_OPTIONS', text)
            self.assertNotIn('name: ddtrace-agent', text)
        self.assertIn('java-lib.version: "v1.66.0-ext"', render('ddtrace.mode=operator', 'ddtrace.version=v1.66.0-ext')[0])

    def test_reject_double_or_missing_agent(self):
        for settings in [('image.tag=2.3.12',), ('image.tag=2.3.12', 'ddtrace.mode=operator'), ('ddtrace.mode=legacy',), ('ddtrace.mode=typo',), ('ddtrace.version=bad:tag',), ('ddtrace.version=latest',)]:
            self.assertNotEqual(render(*settings, ok=False).returncode, 0)
        for text in render('image.tag=2.3.6', 'ddtrace.mode=legacy'):
            self.assertNotIn('initContainers:', text)
            self.assertNotIn('JAVA_TOOL_OPTIONS', text)
            self.assertIn('admission.datakit/ddtrace.enabled: "false"', text)

    def test_compose_external_agent_dependencies(self):
        result = subprocess.check_output(['docker', 'compose', '--env-file', '.env.example', 'config', '--format', 'json'], cwd=ROOT, text=True)
        services = json.loads(result)['services']
        self.assertIn('v1.65.6-ext', services['ddtrace-init']['image'])
        self.assertEqual(services['ddtrace-init']['user'], '0:0')
        self.assertTrue(services['ddtrace-init']['read_only'])
        for service in ['gateway', 'order', 'inventory', 'payment', 'game']:
            item = services[service + '-service']
            self.assertEqual(item['depends_on']['ddtrace-init']['condition'], 'service_completed_successfully')
            self.assertEqual(item['environment']['JAVA_TOOL_OPTIONS'], '-javaagent:/datadog-lib/dd-java-agent.jar')
            mount = next(v for v in item['volumes'] if v['target'] == '/datadog-lib')
            self.assertTrue(mount['read_only'])

    def test_rule_is_scoped(self):
        rule = json.loads((ROOT / 'observability/datakit-operator/demo-ddtrace-rule.json').read_text())
        self.assertEqual(rule['namespace_selectors'], ['^observability-demo$'])
        self.assertTrue(rule['check_annotation'])
        self.assertIn('admission.datakit/ddtrace-language=java', rule['label_selectors'][0])
        self.assertNotIn('DD_VERSION', rule['envs'])


if __name__ == '__main__':
    unittest.main()
