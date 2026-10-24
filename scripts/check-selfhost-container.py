#!/usr/bin/env python3
"""Exercise the production image with disposable, synthetic local Docker resources."""
import argparse
import json
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--image', required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args()
    prefix = 'tasks-fixture-' + uuid.uuid4().hex[:12]
    db_name, app_name = prefix + '-db', prefix + '-http'
    receipt = {'scope': 'synthetic-local-container', 'image': args.image, 'cleanup': False}
    password, auth = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    resources = []
    network_created = False

    def docker(*command: str, timeout=120) -> str:
        result = subprocess.run(['docker', *command], capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError('docker ' + command[0] + ' failed: ' + result.stderr[-700:])
        return result.stdout.strip()

    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='tasks-fixture-env-') as folder:
        env_file = Path(folder) / 'app.env'
        env_file.write_text('\n'.join([
            'NODE_ENV=production', 'APP_URL=https://tasks.example.test',
            'DATABASE_URL=postgresql://fixture:' + password + '@pg:5432/fixture',
            'AUTH_SECRET=' + auth, 'TASKS_DEPLOYMENT_ID=synthetic-container',
            'LINEAR_QUEUE_DRIVER=postgres', 'BOOTSTRAP_EMAIL=owner@example.test',
            'BOOTSTRAP_NAME=Acceptance', 'BOOTSTRAP_PASSWORD=' + password,
            'WORKSPACE_NAME=Synthetic acceptance', 'WORKSPACE_SLUG=synthetic',
        ]) + '\n')
        env_file.chmod(0o600)
        pg_env = Path(folder) / 'pg.env'
        pg_env.write_text('POSTGRES_USER=fixture\nPOSTGRES_DB=fixture\nPOSTGRES_PASSWORD=' + password + '\n')
        pg_env.chmod(0o600)
        try:
            docker('network', 'create', prefix)
            network_created = True
            docker('run', '-d', '--name', db_name, '--network', prefix, '--network-alias', 'pg', '--env-file', str(pg_env), 'postgres:17')
            resources.append(db_name)
            for _ in range(45):
                try:
                    docker('exec', db_name, 'pg_isready', '-U', 'fixture', '-d', 'fixture')
                    break
                except RuntimeError:
                    time.sleep(1)
            else:
                raise RuntimeError('Fixture PostgreSQL did not become ready')
            docker('run', '--rm', '--network', prefix, '--env-file', str(env_file), args.image, 'bun', 'scripts/db.mjs', 'migrate')
            docker('run', '-d', '--name', app_name, '--network', prefix, '--env-file', str(env_file),
                   '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=64m', '--cap-drop=ALL',
                   '--security-opt=no-new-privileges:true', '-p', '127.0.0.1::8080', args.image)
            resources.append(app_name)
            address = docker('port', app_name, '8080/tcp').splitlines()[0]
            base = 'http://' + address
            cookie = ''

            def request(path, method='GET', data=None, authenticated=True):
                headers = {'Origin': 'https://tasks.example.test', 'x-tickets-csrf': '1'}
                if cookie and authenticated:
                    headers['Cookie'] = cookie
                if data is not None:
                    headers['Content-Type'] = 'application/json'
                req = urllib.request.Request(base + path, method=method, headers=headers,
                    data=None if data is None else json.dumps(data).encode())
                try:
                    response = urllib.request.urlopen(req, timeout=20)
                except urllib.error.HTTPError as error:
                    response = error
                raw = response.read().decode()
                return response.status, response.headers, json.loads(raw) if raw.startswith('{') else raw

            for _ in range(30):
                try:
                    status, _, ready = request('/api/ready')
                    break
                except (urllib.error.URLError, ConnectionError):
                    time.sleep(1)
            else:
                raise RuntimeError('Production HTTP process did not start')
            assert status == 503 and ready['code'] == 'OWNER_SETUP_REQUIRED', (status, ready)
            receipt['startupDidNotBootstrapOwner'] = True
            docker('run', '--rm', '--network', prefix, '--env-file', str(env_file), args.image, 'bun', 'scripts/db.mjs', 'bootstrap')
            assert request('/api/ready')[0] == 200
            assert request('/api/v1/me', authenticated=False)[0] == 401
            status, headers, _ = request('/api/auth/login', 'POST', {'email': 'owner@example.test', 'password': password})
            assert status == 200
            cookie = headers['set-cookie'].split(';')[0]
            status, _, catalog = request('/api/v1/catalog')
            assert status == 200 and catalog['teams']
            status, _, issue = request('/api/v1/issues', 'POST', {'title': 'Synthetic container acceptance', 'description': 'Preserved across HTTP restart', 'team_id': catalog['teams'][0]['id']})
            assert status == 201, (status, issue)
            status, _, issue = request('/api/v1/issues/' + issue['id'], 'PATCH', {'version': issue['version'], 'title': 'Updated synthetic acceptance'})
            assert status == 200
            status, _, _ = request('/api/v1/issues/' + issue['id'] + '/comments', 'POST', {'body': 'Persistent synthetic discussion'})
            assert status in (200, 201)
            assert request('/tasks/' + issue['key'])[0] == 200
            docker('restart', '--time', '30', app_name)
            restarted_address = docker('port', app_name, '8080/tcp').splitlines()[0]
            receipt['dynamicPortChangedOnRestart'] = restarted_address != address
            base = 'http://' + restarted_address
            for _ in range(30):
                try:
                    if request('/api/ready')[0] == 200:
                        break
                except (urllib.error.URLError, ConnectionError):
                    pass
                time.sleep(1)
            status, _, after = request('/api/v1/issues/' + issue['key'])
            assert status == 200 and after['id'] == issue['id']
            assert after['title'] == 'Updated synthetic acceptance'
            assert any(c['body'] == 'Persistent synthetic discussion' for c in after['comments'])
            receipt.update({'ready': True, 'anonymousDenied': True, 'loginCreateEditComment': True,
                            'sessionAndDataSurvivedHttpRestart': True, 'codeAndUuidResolveSameIssue': True,
                            'imageUser': docker('image', 'inspect', args.image, '--format', '{{.Config.User}}')})
        finally:
            for name in reversed(resources):
                docker('rm', '-fv', name)
            if network_created:
                docker('network', 'rm', prefix)
            receipt['cleanup'] = True
            args.receipt.write_text(json.dumps(receipt, indent=2) + '\n')
            args.receipt.chmod(0o600)
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
