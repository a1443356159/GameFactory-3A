"""GGgame task-owned execution entry; engine work uses the public ThreeClient."""
from pathlib import Path
import argparse
import json
import os
import signal
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parents[1]))
from engine_adapters.three_js import ThreeClient


def checked(result):
    print(json.dumps(result, ensure_ascii=False), flush=True)
    payload = result.get('payload', {})
    if not result['ok'] or payload.get('returncode', 0) != 0 or payload.get('timed_out', False):
        raise SystemExit(1)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['serve', 'build', 'test', 'browser-test', 'setup'], nargs='?', default='serve')
    parser.add_argument('--port', type=int, default=None)
    args = parser.parse_args()
    client = ThreeClient(project_path=ROOT / 'native', port=args.port)
    if not (ROOT / 'native/packages/a3game-playable/package.json').is_file():
        checked(client.plugin.install_framework())
    if args.command == 'setup' or not (ROOT / 'native/node_modules/.package-lock.json').is_file():
        checked(client.project.install_dependencies(timeout=180))
    checked(client.project.validate())
    if args.command == 'serve':
        result = checked(client.runtime.launch_dev_server())
        (ROOT / '.tmp').mkdir(exist_ok=True)
        (ROOT / '.tmp/runtime.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print('GGgame: ' + result['payload']['dev_server_url'])
        try:
            signal.pause()
        except KeyboardInterrupt:
            checked(client.runtime.stop_dev_server(result['payload']['process_id']))
    elif args.command == 'build':
        checked(client.build.project())
    elif args.command == 'test':
        checked(client.testing.run_automation_tests())
    elif args.command == 'browser-test':
        os.environ['GGGAME_URL'] = client.get_environment_info()['payload']['dev_server_url']
        checked(client.testing.run_automation_tests(runner='playwright', timeout=220))


if __name__ == '__main__':
    main()
