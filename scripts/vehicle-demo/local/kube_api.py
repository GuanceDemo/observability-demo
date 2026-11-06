"""Fixed-namespace Kubernetes HTTPS transport; credentials never reach the UI."""
import json
import os
from pathlib import Path
import re
import ssl
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

NAMESPACE = 'vehicle-pipeline'
STATE_NAME = 'vehicle-demo-fault-state'
SERVICE_ACCOUNT = 'vehicle-demo-fault-worker'
OWNER = 'vehicle-demo-api-control'
RESOURCES = {
    'deployment': ('/apis/apps/v1', 'deployments'),
    'cronjob': ('/apis/batch/v1', 'cronjobs'),
    'job': ('/apis/batch/v1', 'jobs'),
    'pod': ('/api/v1', 'pods'),
    'configmap': ('/api/v1', 'configmaps'),
    'serviceaccount': ('/api/v1', 'serviceaccounts'),
}


class ControlError(Exception):
    def __init__(self, code, status=0):
        super().__init__(code)
        self.status = status


def api_error(status):
    return ControlError({401: 'KUBE_UNAUTHORIZED', 403: 'KUBE_FORBIDDEN',
                         404: 'KUBE_RESOURCE_MISSING', 409: 'KUBE_CONFLICT',
                         422: 'KUBE_INVALID_RESOURCE'}.get(status, 'KUBE_API_UNAVAILABLE'), status)


class ResourceAPI:
    def __init__(self):
        self.before_write = None

    def request(self, path, method='GET', body=None, content_type='application/json', raw=False):
        raise NotImplementedError

    def path(self, kind, name=None):
        prefix, plural = RESOURCES[kind]
        if name and not re.fullmatch(r'[a-z0-9][a-z0-9.-]*', name):
            raise ControlError('INVALID_RESOURCE_NAME')
        return prefix + '/namespaces/' + NAMESPACE + '/' + plural + ('/' + name if name else '')

    def get(self, kind, name, missing_ok=False):
        try:
            return self.request(self.path(kind, name))
        except ControlError as error:
            if missing_ok and error.status == 404:
                return None
            raise

    def list(self, kind, selector=None):
        query = '?' + urlencode({'labelSelector': selector}) if selector else ''
        return self.request(self.path(kind) + query)['items']

    def can(self, group, resource, verb, name=None):
        resource, _, subresource = resource.partition('/')
        attrs = dict(namespace=NAMESPACE, group=group, resource=resource, verb=verb)
        if subresource:
            attrs['subresource'] = subresource
        if name:
            attrs['name'] = name
        result = self.request('/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', 'POST',
                              {'apiVersion': 'authorization.k8s.io/v1', 'kind': 'SelfSubjectAccessReview',
                               'spec': {'resourceAttributes': attrs}})
        return result.get('status', {}).get('allowed') is True

    def patch(self, kind, name, patch):
        allowed = {('deployment', 'vehicle-kafka'), ('deployment', 'vehicle-flink-taskmanager'),
                   ('cronjob', 'vehicle-summary')}
        if (kind, name) not in allowed:
            raise ControlError('RESOURCE_NOT_ALLOWED')
        if self.before_write:
            self.before_write()
        return self.request(self.path(kind, name), 'PATCH', patch, 'application/json-patch+json')

    def create_job(self, body):
        meta = body.get('metadata', {})
        op_id = meta.get('labels', {}).get('vehicle-local-operation', '')
        if (meta.get('namespace') != NAMESPACE or not re.fullmatch(r'[a-f0-9]{32}', op_id)
                or not re.fullmatch(r'vehicle-(?:summary-(?:fault|recover)|demo-control)-[a-f0-9]{12}(?:-[0-9]+)?', meta.get('name', ''))):
            raise ControlError('RESOURCE_NOT_ALLOWED')
        if self.before_write:
            self.before_write()
        return self.request(self.path('job'), 'POST', body)

    def replace_state(self, body):
        if body.get('metadata', {}).get('name') != STATE_NAME:
            raise ControlError('RESOURCE_NOT_ALLOWED')
        return self.request(self.path('configmap', STATE_NAME), 'PUT', body)

    def job_logs(self, name):
        job = self.get('job', name)
        pods = self.list('pod', 'job-name=' + name)
        output = []
        for pod in pods:
            if not any(ref.get('uid') == job['metadata']['uid'] for ref in pod['metadata'].get('ownerReferences', [])):
                continue
            path = self.path('pod', pod['metadata']['name']) + '/log?' + urlencode({'container': 'spark', 'tailLines': 2000, 'limitBytes': 262144})
            output.append(self.request(path, raw=True))
        return '\n'.join(output)

    def command(self, *args, body=None):
        """Small compatibility adapter for the existing, fixed fault state machine."""
        if args[:2] == ('get', 'jobs'):
            return json.dumps({'items': self.list('job')})
        if args[0] == 'get' and args[1] in RESOURCES:
            value = self.get(args[1], args[2], '--ignore-not-found' in args)
            return '' if value is None else json.dumps(value)
        if args[0] == 'patch':
            return json.dumps(self.patch(args[1], args[2], json.loads(args[-1])))
        if args[:2] == ('create', '-f'):
            return json.dumps(self.create_job(json.loads(body)))
        if args[0] == 'logs' and args[1].startswith('job/'):
            return self.job_logs(args[1][4:])
        raise ControlError('RESOURCE_NOT_ALLOWED')


class LocalAPI(ResourceAPI):
    def __init__(self, kubeconfig, context):
        super().__init__()
        if not context:
            raise ControlError('KUBE_CONTEXT_REQUIRED')
        path = Path(kubeconfig).expanduser()
        if not path.is_file():
            raise ControlError('KUBE_CONFIG_MISSING')
        try:
            from kubernetes import client, config
            conf = client.Configuration()
            config.load_kube_config(config_file=str(path), context=context,
                                    client_configuration=conf, persist_config=False)
            if not conf.verify_ssl or not conf.host.startswith('https://'):
                raise ControlError('KUBE_TLS_REQUIRED')
            conf.retries = 0
            self.client = client.ApiClient(conf)
        except ControlError:
            raise
        except ImportError:
            raise ControlError('KUBE_CLIENT_MISSING') from None
        except Exception:
            raise ControlError('KUBE_CONFIG_INVALID') from None

    def request(self, path, method='GET', body=None, content_type='application/json', raw=False):
        try:
            return self.client.call_api(path, method, body=body,
                                        header_params={'Accept': 'application/json', 'Content-Type': content_type},
                                        auth_settings=['BearerToken'], response_type='str' if raw else 'object',
                                        _return_http_data_only=True, _request_timeout=(5, 15))
        except Exception as error:
            status = getattr(error, 'status', 0)
            if status:
                raise api_error(status) from None
            # Only classifications leave the backend, never raw credential/config errors.
            if 'certificate' in str(error).lower() or 'ssl' in type(error).__name__.lower():
                raise ControlError('KUBE_TLS_FAILED') from None
            raise ControlError('KUBE_NETWORK_UNAVAILABLE') from None

    def close(self):
        self.client.close()


class InClusterAPI(ResourceAPI):
    """Workbench/worker use projected ServiceAccounts, never laptop credentials."""
    def __init__(self, *_unused):
        super().__init__()
        root = Path('/var/run/secrets/kubernetes.io/serviceaccount')
        self.token_file = root / 'token'
        self.tls = ssl.create_default_context(cafile=str(root / 'ca.crt'))
        self.origin = 'https://' + os.environ['KUBERNETES_SERVICE_HOST'] + ':' + os.environ.get('KUBERNETES_SERVICE_PORT_HTTPS', '443')

    def request(self, path, method='GET', body=None, content_type='application/json', raw=False):
        headers = {'Authorization': 'Bearer ' + self.token_file.read_text().strip(), 'Content-Type': content_type}
        request = Request(self.origin + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        try:
            with urlopen(request, context=self.tls, timeout=15) as response:
                data = response.read(4 * 1024 * 1024).decode()
                return data if raw else json.loads(data)
        except HTTPError as error:
            raise api_error(error.code) from None
        except (URLError, OSError):
            raise ControlError('KUBE_NETWORK_UNAVAILABLE') from None

    def close(self):
        pass  # urllib responses are closed per request; tokens are reread on every call.
