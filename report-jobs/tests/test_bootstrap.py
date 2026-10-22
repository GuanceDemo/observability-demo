import base64
import contextlib
import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("bootstrap", ROOT / "scripts/report-jobs-bootstrap.py")
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BootstrapTest(unittest.TestCase):
    def calls(self, existing=None, users="0"):
        calls = []

        def kubectl(args, data=None):
            calls.append((args, data))
            if "get" in args and "mall-data-pipeline" in args:
                return json.dumps({"data": {"openlineage-token": base64.b64encode(b"fixture-token").decode()}})
            if "get" in args:
                return json.dumps(existing) if existing else ""
            if data and data.startswith("SELECT COUNT"):
                return users
            return ""
        return calls, kubectl

    def test_secrets_before_sql_and_reader_is_read_only(self):
        calls, command = self.calls()
        output = io.StringIO()
        with patch.object(bootstrap, "kubectl", command), patch("sys.argv", ["bootstrap"]), contextlib.redirect_stdout(output):
            bootstrap.main()
        secret_indices = [i for i, (args, _) in enumerate(calls) if "apply" in args]
        sql_index = next(i for i, (_, data) in enumerate(calls) if data and data.startswith("CREATE DATABASE"))
        self.assertEqual(len(secret_indices), 2)
        self.assertTrue(all(i < sql_index for i in secret_indices))
        sql = calls[sql_index][1]
        reader_grants = [line for line in sql.splitlines() if line.startswith("GRANT") and "mall_reports_reader" in line]
        self.assertEqual(len(reader_grants), 2)
        self.assertTrue(all(line.startswith("GRANT SELECT ON") for line in reader_grants))
        self.assertNotIn("DROP", sql)
        self.assertNotIn("fixture-token", output.getvalue())
        self.assertNotIn("CREATE USER", " ".join(calls[sql_index][0]))

    def test_refuse_unowned_secret_or_account(self):
        for existing, users in [(None, "1"), ({"metadata": {"labels": {}}}, "0")]:
            calls, command = self.calls(existing, users)
            with patch.object(bootstrap, "kubectl", command), patch("sys.argv", ["bootstrap"]), self.assertRaises(ValueError):
                bootstrap.main()
            self.assertFalse(any("apply" in args for args, _ in calls))


if __name__ == "__main__":
    unittest.main()
