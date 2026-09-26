"""Build, prepare and serve the GGgame web engine through the public adapter."""
from pathlib import Path
import argparse
import json
import signal
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[2]))
from engine_adapters.three_js import ThreeClient


def checked(result):
    print(json.dumps(result, ensure_ascii=False), flush=True)
    payload = result.get('payload', {})
    if not result['ok'] or payload.get('returncode', 0) != 0 or payload.get('timed_out', False):
        raise SystemExit(1)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['setup', 'build', 'serve', 'test', 'browser-test'])
    parser.add_argument('--port', type=int, default=4321)
    args = parser.parse_args()
    client = ThreeClient(project_path=ROOT, port=args.port)
    if not (ROOT / 'packages/a3game-playable/package.json').is_file():
        checked(client.plugin.install_framework())
    if args.command == 'setup' or not (ROOT / 'node_modules/.package-lock.json').is_file():
        checked(client.project.install_dependencies(timeout=180))
    if args.command == 'build':
        checked(client.build.project())
    elif args.command == 'test':
        checked(client.testing.run_automation_tests(script='test', report_path='.a3game/reports/vitest-report.json'))
    elif args.command == 'browser-test':
        checked(client.testing.run_automation_tests(runner='playwright', script='test:e2e', report_path='.a3game/reports/playwright-report.json', timeout=600))
    elif args.command == 'serve':
        result = checked(client.runtime.launch_dev_server())
        try:
            signal.pause()
        except KeyboardInterrupt:
            checked(client.runtime.stop_dev_server(result['payload']['process_id']))


if __name__ == '__main__':
    main()
