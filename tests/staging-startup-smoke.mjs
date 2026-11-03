import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const repo = process.cwd();
const profile = await mkdtemp(join(tmpdir(), 'uyym-staging-startup-smoke-'));
const baseEnv = {
  SystemRoot: process.env.SystemRoot || 'C:\\Windows',
  WINDIR: process.env.WINDIR || 'C:\\Windows',
  COMSPEC: process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
  PATH: 'C:\\Program Files\\nodejs;C:\\Windows\\System32',
  TEMP: profile,
  TMP: profile,
  USERPROFILE: process.env.USERPROFILE || profile,
  LOCALAPPDATA: profile,
};
const syntheticSecret = 'synthetic-only-oauth-canary-not-a-real-secret';
const syntheticServiceAccount = Buffer.from(JSON.stringify({
  type: 'service_account',
  client_email: 'uyym-staging-reader@uyym-academy-drive.iam.gserviceaccount.com',
  token_uri: 'https://oauth2.googleapis.com/token',
  private_key: '-----BEGIN PRIVATE KEY-----\nSYNTHETIC-ONLY-NOT-A-REAL-KEY\n-----END PRIVATE KEY-----',
})).toString('base64');
const children = [];
const childExit = new Map();
const childLogs = new Map();
let stage = 'initialize';
let failure = 'none';

function launch(args, env) {
  const child = spawn(process.execPath, args, {cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe']});
  childLogs.set(child, '');
  child.stdout?.on('data', chunk => childLogs.set(child, (childLogs.get(child) + chunk.toString()).slice(-4096)));
  child.stderr.on('data', chunk => childLogs.set(child, (childLogs.get(child) + chunk.toString()).slice(-4096)));
  child.once('exit', (code, signal) => childExit.set(child, {code, signal}));
  children.push(child);
  return child;
}

async function waitForHttp(url, child) {
  let lastError = 'none';
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('LOCAL_CHILD_EXITED');
    try {
      const response = await fetch(url);
      return response;
    } catch (error) {
      lastError = String(error?.cause?.code || error?.code || error?.name || 'FETCH_FAILED');
      await delay(250);
    }
  }
  throw new Error(`LOCAL_STARTUP_TIMEOUT_${lastError}`);
}

async function assertPortFree(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
  });
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(1000)]);
  }
}

let passed = false;
try {
  stage = 'port safety preflight';
  await assertPortFree(5174);
  await assertPortFree(18878);

  stage = 'synthetic service and Vite launch';
  const serviceEnv = {
    ...baseEnv,
    NODE_ENV: 'test',
    UYYM_UI_DRIVE_STAGING: '1',
    UYYM_STAGING_OWNER_EMAIL: 'owner@example.test',
    UYYM_STAGING_OAUTH_CLIENT_ID: '123456-test.apps.googleusercontent.com',
    UYYM_STAGING_OAUTH_CLIENT_SECRET: syntheticSecret,
    UYYM_STAGING_OAUTH_ENCRYPTION_KEY: 'ab'.repeat(32),
    UYYM_STAGING_SERVICE_ACCOUNT_BASE64: syntheticServiceAccount,
  };
  const viteEnv = {
    ...baseEnv,
    NODE_ENV: 'development',
    VITE_SYNTHETIC_SECRET_CANARY: syntheticSecret,
    UYYM_STAGING_OAUTH_CLIENT_SECRET: syntheticSecret,
    UYYM_STAGING_SERVICE_ACCOUNT_BASE64: syntheticServiceAccount,
  };

  const backend = launch(['--import', 'tsx', 'tests/ui-fixture.ts'], serviceEnv);
  const vite = launch(['node_modules/vite/bin/vite.js', '--config', 'tests/ui-vite.config.ts'], viteEnv);

  stage = 'isolated backend readiness';
  const fixtureResponse = await waitForHttp('http://127.0.0.1:18878/__ui/staging-login', backend);
  stage = 'Vite loopback readiness';
  const webResponse = await waitForHttp('http://127.0.0.1:5174/', vite);
  stage = 'local HTTP verification';
  assert.equal(webResponse.status, 200);
  assert.equal(fixtureResponse.status, 200);
  const html = await webResponse.text();
  const fixtureBody = await fixtureResponse.json();
  assert.match(html, /\/src\/main\.tsx/);
  assert.equal(fixtureBody.synthetic_only, true);

  stage = 'synthetic teacher login and approved-browser gate';
  const {publicKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const jwk = publicKey.export({format: 'jwk'});
  const login = await fetch('http://127.0.0.1:18878/api/auth/login', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({phone: fixtureBody.teacher.phone, password: fixtureBody.teacher.password, public_key: jwk, label: 'Synthetic smoke browser'}),
  });
  assert.equal(login.status, 200);
  const loginStatus = await login.json();
  assert.equal(loginStatus.user.role, 'TEACHER');
  assert.equal(loginStatus.device_status, 'pending', 'staging must retain production browser approval checks');

  const clientModuleResponse = await fetch('http://127.0.0.1:5174/src/main.tsx');
  stage = 'browser secret exclusion verification';
  assert.equal(clientModuleResponse.status, 200);
  const clientModule = await clientModuleResponse.text();
  for (const marker of [syntheticSecret, syntheticServiceAccount, 'UYYM_STAGING_SERVICE_ACCOUNT_BASE64']) {
    assert.equal(clientModule.includes(marker), false);
  }
  passed = true;
} catch (error) {
  passed = false;
  failure = String(error?.message || 'UNKNOWN').replace(/[^A-Za-z0-9_. -]/g, '_').slice(0, 100);
} finally {
  for (const child of children.reverse()) await stop(child);
  await rm(profile, {recursive: true, force: true});
}

if (!passed) {
  const earlyExit = [...childExit.values()].map(x => x.signal ? 'signal' : `exit-${x.code}`).join(',') || 'none';
  const safeLog = [...childLogs.values()].join('\n').replaceAll(syntheticSecret, '[synthetic-secret-redacted]').replaceAll(syntheticServiceAccount, '[synthetic-key-redacted]').replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[synthetic-private-key-redacted]').replace(/[^A-Za-z0-9_.: /\r\n-]/g, '_').slice(-1200).trim();
  process.stderr.write(`SYNTHETIC_STAGING_STARTUP=FAIL stage=${stage} reason=${failure} child=${earlyExit}${safeLog ? ` detail=${safeLog}` : ''}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('SYNTHETIC_STAGING_STARTUP=PASS\n');
}
