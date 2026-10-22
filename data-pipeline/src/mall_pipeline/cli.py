import argparse
import signal

from .config import Config
from .lineage import log
from .transport import HttpSink
from .worker import Worker


def interrupted(signum: int, frame: object) -> None:
    raise KeyboardInterrupt


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the mall analytics demonstration")
    parser.add_argument(
        "--mode",
        choices=["normal", "recovery", "fail-clean", "fail-aggregate", "slow", "replay"],
        default="normal",
    )
    parser.add_argument("--delay-seconds", type=int, default=30)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, interrupted)
    worker = None
    try:
        config = Config.from_env()
        worker = Worker(config, HttpSink(config))
        code = worker.run(args.mode, args.delay_seconds)
    except (Exception, KeyboardInterrupt) as error:
        log("pipeline_error", error_type=type(error).__name__)
        code = 1
    finally:
        if worker:
            worker.close()
    raise SystemExit(code)


if __name__ == "__main__":
    main()
