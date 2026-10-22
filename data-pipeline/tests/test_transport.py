import json

import pytest
import requests

from mall_pipeline.transport import DeliveryError, HttpSink, retry_delay


def response(status, body=None):
    result = requests.Response()
    result.status_code = status
    result._content = json.dumps(body or {}).encode()
    result.headers["Retry-After"] = "0"
    return result


def test_retry_preserves_payload_and_authorization(config, monkeypatch):
    sink = HttpSink(config)
    attempts = []
    responses = iter(
        [response(429), response(503), response(200, {"error_code": "dataway.cached"})]
    )

    def post(url, **kwargs):
        attempts.append((url, kwargs))
        return next(responses)

    monkeypatch.setattr(sink.session, "post", post)
    sink.send('{"run": "same-id"}')
    assert len(attempts) == 3
    assert all(a[1]["data"] == attempts[0][1]["data"] for a in attempts)
    assert all(a[1]["allow_redirects"] is False for a in attempts)
    assert attempts[0][0].endswith("/v1/write/openlineage")
    assert "private-test" not in attempts[0][0]
    assert sink.session.headers["X-Token"] == "private-test-token"
    assert "Authorization" not in sink.session.headers


@pytest.mark.parametrize("status", [301, 400, 401, 403, 413, 415, 422])
def test_permanent_errors_do_not_retry_or_disclose_response(config, monkeypatch, status):
    sink = HttpSink(config)
    calls = []

    def post(*args, **kwargs):
        calls.append(1)
        return response(status, {"message": "private-token-secret"})

    monkeypatch.setattr(sink.session, "post", post)
    with pytest.raises(DeliveryError, match=f"^http_{status}$"):
        sink.send("{}")
    assert len(calls) == 1


def test_network_exception_is_redacted(config, monkeypatch):
    sink = HttpSink(config)

    def post(*args, **kwargs):
        raise requests.ConnectionError("private-token-secret")

    monkeypatch.setattr(sink.session, "post", post)
    monkeypatch.setattr("mall_pipeline.transport.time.sleep", lambda _: None)
    with pytest.raises(DeliveryError, match="^network_error$"):
        sink.send("{}")
    assert retry_delay(1, "999") == 10
    assert retry_delay(1, "-1") == 0


def test_missing_token_diagnostic_is_safe(config, monkeypatch):
    sink = HttpSink(config)
    monkeypatch.setattr(
        sink.session,
        "post",
        lambda *args, **kwargs: response(
            400, {"error_code": "dataway.emptyToken", "message": "private-token-secret"}
        ),
    )
    with pytest.raises(DeliveryError, match="^http_400_missing_token$"):
        sink.send("{}")
