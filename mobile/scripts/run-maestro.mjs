#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');
const workspaceRoot = join(mobileRoot, '.maestro');
const flowsRoot = join(workspaceRoot, 'flows');
const pinnedVersion = readFileSync(join(workspaceRoot, 'MAESTRO_VERSION'), 'utf8').trim();

export function parseMaestroArgs(argv, env = process.env) {
  const result = {
    appId: 'com.trailhead.app',
    device: '',
    flow: '',
    tags: '',
    host: env.MAESTRO_HOST || 'auto',
    maestro: env.MAESTRO_BIN || join(env.HOME || '', '.maestro', 'bin', 'maestro'),
    windowsMaestro: env.MAESTRO_WINDOWS_BIN || '',
    windowsJavaHome: env.MAESTRO_WINDOWS_JAVA_HOME || '',
    windowsAndroidSdk: env.MAESTRO_WINDOWS_ANDROID_SDK || env.MAESTRO_WINDOWS_ANDROID_HOME || '',
    windowsCmd: env.MAESTRO_WINDOWS_CMD || '',
    doctor: false,
    dryRun: false,
  };
  const args = [...argv];
  while (args.length) {
    const flag = args.shift();
    const take = () => {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      return value;
    };
    if (flag === '--app-id') result.appId = take();
    else if (flag === '--device') result.device = take();
    else if (flag === '--flow') result.flow = take();
    else if (flag === '--tags') result.tags = take();
    else if (flag === '--host') result.host = take();
    else if (flag === '--maestro') result.maestro = take();
    else if (flag === '--windows-maestro') result.windowsMaestro = take();
    else if (flag === '--windows-java-home') result.windowsJavaHome = take();
    else if (flag === '--windows-android-sdk') result.windowsAndroidSdk = take();
    else if (flag === '--windows-cmd') result.windowsCmd = take();
    else if (flag === '--doctor') result.doctor = true;
    else if (flag === '--dry-run') result.dryRun = true;
    else if (flag === '--help' || flag === '-h') result.help = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!/^[A-Za-z][A-Za-z0-9._-]{2,127}$/.test(result.appId)) throw new Error('Invalid --app-id');
  if (result.device && !/^[A-Za-z0-9._:-]{2,128}$/.test(result.device)) throw new Error('Invalid --device');
  if (result.tags && !/^[A-Za-z0-9._,-]{1,128}$/.test(result.tags)) throw new Error('Invalid --tags');
  if (!['auto', 'native', 'windows'].includes(result.host)) throw new Error('--host must be auto, native, or windows');
  return result;
}

export function pinnedMaestroVersion(value) {
  const versions = [...String(value || '').matchAll(/\b(\d+\.\d+\.\d+)\b/g)];
  return versions.at(-1)?.[1] ?? '';
}

export function isWslEnvironment({ platform = process.platform, env = process.env, procVersion = '' } = {}) {
  return platform === 'linux' && Boolean(
    env.WSL_DISTRO_NAME
    || env.WSL_INTEROP
    || /microsoft|wsl/i.test(procVersion),
  );
}

export function chooseMaestroHost(requested, wsl) {
  if (!['auto', 'native', 'windows'].includes(requested)) throw new Error('Invalid Maestro host');
  return requested === 'auto' ? (wsl ? 'windows' : 'native') : requested;
}

export function discoverWslDistro(env = process.env, windowsRoot = '') {
  if (/^[A-Za-z0-9._-]{1,128}$/.test(env.WSL_DISTRO_NAME || '')) return env.WSL_DISTRO_NAME;
  const match = String(windowsRoot).match(/^\\\\(?:wsl\.localhost|wsl\$)\\([^\\/]+)/i);
  return match?.[1] || '';
}

function usage() {
  console.log(`Trailhead pinned Maestro runner (${pinnedVersion})

Install the exact CLI:
  bash scripts/install-maestro.sh

Verify prerequisites and the selected host bridge:
  node scripts/run-maestro.mjs --doctor

Run the safe Android smoke suite on one exact device/package:
  node scripts/run-maestro.mjs --device RFCR408DA9B --tags smoke --app-id com.trailhead.app

Run one flow:
  node scripts/run-maestro.mjs --device emulator-5554 --flow 02-search-rapid-typing.yaml

Under WSL, auto uses the pinned WSL Maestro distribution through Windows Java and
Windows ADB so it reaches Android Studio emulators. Override with --host native,
--host windows, or the MAESTRO_HOST environment variable. Windows paths may be
overridden with --windows-maestro, --windows-java-home, and --windows-android-sdk.

The runner never clears application state. Pass --dry-run to inspect the command.`);
}

function commandOutput(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, ...options });
  if (result.error) throw result.error;
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  return { status: result.status, stdout, stderr, output: `${stdout}${stderr}`.trim() };
}

function readProcVersion() {
  try {
    return readFileSync('/proc/version', 'utf8');
  } catch {
    return '';
  }
}

function outputOrEmpty(command, args) {
  try {
    const result = commandOutput(command, args);
    return result.status === 0 ? result.output.trim() : '';
  } catch {
    return '';
  }
}

function stdoutOrEmpty(command, args, options = {}) {
  try {
    const result = commandOutput(command, args, options);
    return result.status === 0 ? result.stdout.trim() : '';
  } catch {
    return '';
  }
}

function validateCmdValue(value, label) {
  const text = String(value || '');
  if (!text || /[\0\r\n"%]/.test(text)) throw new Error(`${label} contains unsupported command characters`);
  return text;
}

export function quoteWindowsCmdArg(value) {
  return `"${validateCmdValue(value, 'Windows argument')}"`;
}

export function buildWindowsMaestroCommand({ maestro, javaHome, androidSdk, timeout = '120000', args = [] }) {
  const safeMaestro = quoteWindowsCmdArg(maestro);
  const safeJavaHome = validateCmdValue(javaHome, 'Windows Java home');
  const safeAndroidSdk = validateCmdValue(androidSdk, 'Windows Android SDK');
  const safeTimeout = String(timeout || '120000');
  if (!/^\d{4,9}$/.test(safeTimeout)) throw new Error('Invalid MAESTRO_DRIVER_STARTUP_TIMEOUT');
  return [
    'setlocal DisableDelayedExpansion',
    `set "JAVA_HOME=${safeJavaHome}"`,
    `set "ANDROID_HOME=${safeAndroidSdk}"`,
    `set "ANDROID_SDK_ROOT=${safeAndroidSdk}"`,
    'set "MAESTRO_CLI_NO_ANALYTICS=true"',
    `set "MAESTRO_DRIVER_STARTUP_TIMEOUT=${safeTimeout}"`,
    `call ${safeMaestro} ${args.map(quoteWindowsCmdArg).join(' ')}`.trimEnd(),
  ].join('&&');
}

export function parseAdbDevices(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^List of devices attached/i.test(line) && !/^\* daemon/i.test(line))
    .map(line => {
      const [serial = '', state = ''] = line.split(/\s+/, 2);
      return { serial, state };
    })
    .filter(device => device.serial && device.state);
}

function windowsEnvironmentValue(cmd, name) {
  const marker = `%${name}%`;
  const value = stdoutOrEmpty(cmd, ['/d', '/s', '/c', `echo ${marker}`], { cwd: '/mnt/c/Windows' });
  return !value || value === marker || /[\r\n]/.test(value) ? '' : value;
}

function toWindowsPath(value) {
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)) return value.replaceAll('/', '\\');
  const converted = outputOrEmpty('wslpath', ['-w', resolve(value)]);
  if (!converted) throw new Error(`Could not convert path for Windows: ${value}`);
  return converted;
}

function toWslPath(value) {
  if (value.startsWith('/')) return value;
  const converted = outputOrEmpty('wslpath', ['-u', value]);
  if (!converted) throw new Error(`Could not convert Windows path for WSL: ${value}`);
  return converted;
}

function existingWindowsPath(candidates, requiredChild = '') {
  for (const rawCandidate of candidates.filter(Boolean)) {
    try {
      const candidate = toWindowsPath(rawCandidate);
      const check = requiredChild ? win32.join(candidate, requiredChild) : candidate;
      if (existsSync(toWslPath(check))) return candidate;
    } catch {
      // Continue through the deterministic candidate list.
    }
  }
  return '';
}

function resolveWindowsCmd(explicit) {
  const candidates = [
    explicit,
    '/mnt/c/Windows/System32/cmd.exe',
    '/mnt/c/Windows/system32/cmd.exe',
  ].filter(Boolean);
  const command = candidates
    .map(candidate => {
      if (existsSync(candidate)) return candidate;
      try {
        const converted = toWslPath(candidate);
        return existsSync(converted) ? converted : '';
      } catch {
        return '';
      }
    })
    .find(Boolean) || 'cmd.exe';
  const probe = stdoutOrEmpty(command, ['/d', '/s', '/c', 'echo trailhead-maestro'], { cwd: '/mnt/c/Windows' });
  if (probe !== 'trailhead-maestro') throw new Error('Windows cmd.exe is unavailable from WSL. Use --host native or --windows-cmd.');
  return command;
}

function resolveWindowsRuntime(options) {
  const cmd = resolveWindowsCmd(options.windowsCmd);
  const windowsRoot = toWindowsPath('/');
  const distro = discoverWslDistro(process.env, windowsRoot);
  if (!distro) throw new Error('Could not determine the active WSL distribution. Set WSL_DISTRO_NAME or use --host native.');

  const userProfile = windowsEnvironmentValue(cmd, 'USERPROFILE');
  const programFiles = windowsEnvironmentValue(cmd, 'ProgramFiles');
  const localAppData = windowsEnvironmentValue(cmd, 'LOCALAPPDATA');
  const windowsJavaEnv = windowsEnvironmentValue(cmd, 'JAVA_HOME');
  const windowsAndroidRoot = windowsEnvironmentValue(cmd, 'ANDROID_SDK_ROOT');
  const windowsAndroidHome = windowsEnvironmentValue(cmd, 'ANDROID_HOME');
  const maestroSibling = options.maestro ? `${options.maestro}.bat` : '';

  const maestro = existingWindowsPath([
    options.windowsMaestro,
    userProfile && win32.join(userProfile, '.maestro', 'bin', 'maestro.bat'),
    maestroSibling,
    join(process.env.HOME || '', '.maestro', 'bin', 'maestro.bat'),
  ]);
  if (!maestro) {
    throw new Error('Pinned Windows Maestro launcher was not found. Run bash scripts/install-maestro.sh or pass --windows-maestro.');
  }

  const javaHome = existingWindowsPath([
    options.windowsJavaHome,
    windowsJavaEnv,
    programFiles && win32.join(programFiles, 'Android', 'Android Studio', 'jbr'),
    localAppData && win32.join(localAppData, 'Programs', 'Android Studio', 'jbr'),
  ], win32.join('bin', 'java.exe'));
  if (!javaHome) {
    throw new Error('Windows Java 17+ was not found. Pass --windows-java-home (Android Studio jbr is supported).');
  }

  const androidSdk = existingWindowsPath([
    options.windowsAndroidSdk,
    windowsAndroidRoot,
    windowsAndroidHome,
    localAppData && win32.join(localAppData, 'Android', 'Sdk'),
  ], win32.join('platform-tools', 'adb.exe'));
  if (!androidSdk) {
    throw new Error('Windows Android SDK/ADB was not found. Pass --windows-android-sdk.');
  }

  return {
    host: 'windows',
    distro,
    command: cmd,
    cwd: '/mnt/c/Windows',
    maestro,
    javaHome,
    androidSdk,
    javaCommand: toWslPath(win32.join(javaHome, 'bin', 'java.exe')),
    adbCommand: toWslPath(win32.join(androidSdk, 'platform-tools', 'adb.exe')),
    mapPath: toWindowsPath,
    invocation(args) {
      const input = `${buildWindowsMaestroCommand({
        maestro,
        javaHome,
        androidSdk,
        timeout: process.env.MAESTRO_DRIVER_STARTUP_TIMEOUT || '120000',
        args,
      })}\r\nexit /b %ERRORLEVEL%\r\n`;
      return {
        command: cmd,
        args: ['/d', '/q'],
        input,
      };
    },
  };
}

function resolveNativeRuntime(options) {
  const javaCandidates = [
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', 'java'),
    process.env.HOME && join(process.env.HOME, '.local', 'bin', 'java'),
    '/usr/bin/java',
  ].filter(Boolean);
  const javaCommand = javaCandidates.find(candidate => existsSync(candidate)) || 'java';
  return {
    host: 'native',
    distro: '',
    command: options.maestro,
    cwd: mobileRoot,
    maestro: options.maestro,
    javaCommand,
    env: javaCommand === 'java' ? {} : { JAVA_HOME: dirname(dirname(javaCommand)) },
    mapPath: value => value,
    invocation: args => ({ command: options.maestro, args }),
  };
}

function resolveRuntime(options) {
  const host = chooseMaestroHost(options.host, isWslEnvironment({ procVersion: readProcVersion() }));
  return host === 'windows' ? resolveWindowsRuntime(options) : resolveNativeRuntime(options);
}

function verifyTooling(runtime) {
  if (runtime.host === 'native') {
    if (!existsSync(runtime.maestro) && !process.env.MAESTRO_BIN) {
      throw new Error(`Maestro was not found at ${runtime.maestro}. Run: bash scripts/install-maestro.sh`);
    }
    const java = commandOutput(runtime.javaCommand, ['-version']);
    const javaMajor = Number(java.output.match(/version "(\d+)/)?.[1] ?? 0);
    if (java.status !== 0 || javaMajor < 17) throw new Error(`Java 17 or newer is required; found: ${java.output || 'unavailable'}`);
    const maestroResult = commandOutput(runtime.maestro, ['--version'], {
      env: { ...process.env, ...runtime.env },
    });
    const actual = pinnedMaestroVersion(maestroResult.output);
    if (maestroResult.status !== 0 || actual !== pinnedVersion) {
      throw new Error(`Expected Maestro ${pinnedVersion}; found ${actual || 'unavailable'} at ${runtime.maestro}.`);
    }
    return { host: runtime.host, java: java.output.split(/\r?\n/)[0], maestro: actual, binary: runtime.maestro };
  }

  const java = commandOutput(runtime.javaCommand, ['-version']);
  const javaMajor = Number(java.output.match(/version "(\d+)/)?.[1] ?? 0);
  if (java.status !== 0 || javaMajor < 17) throw new Error(`Windows Java 17 or newer is required; found: ${java.output || 'unavailable'}`);
  const invocation = runtime.invocation(['--version']);
  const maestroResult = commandOutput(invocation.command, invocation.args, { cwd: runtime.cwd, input: invocation.input });
  const actual = pinnedMaestroVersion(maestroResult.output);
  if (maestroResult.status !== 0 || actual !== pinnedVersion) {
    throw new Error(
      `Expected Maestro ${pinnedVersion}; found ${actual || 'unavailable'} at ${runtime.maestro}`
      + ` (exit ${maestroResult.status ?? 'unknown'}: ${maestroResult.output || 'no output'}).`,
    );
  }
  const adb = commandOutput(runtime.adbCommand, ['version']);
  if (adb.status !== 0 || !/^Android Debug Bridge version/m.test(adb.output)) {
    throw new Error(`Windows ADB is unavailable at ${runtime.adbCommand}.`);
  }
  return {
    host: runtime.host,
    wsl_distro: runtime.distro,
    java: java.output.split(/\r?\n/)[0],
    maestro: actual,
    binary: runtime.maestro,
    adb: adb.output.split(/\r?\n/)[0],
  };
}

function verifyExactDevice(runtime, serial) {
  if (runtime.host !== 'windows') return { serial, transport: 'native-maestro' };
  const result = commandOutput(runtime.adbCommand, ['devices', '-l']);
  if (result.status !== 0) throw new Error('Windows ADB could not enumerate attached devices.');
  const matches = parseAdbDevices(result.output).filter(device => device.serial === serial);
  if (matches.length !== 1 || matches[0].state !== 'device') {
    const visible = parseAdbDevices(result.output).map(device => `${device.serial}:${device.state}`).join(', ') || 'none';
    throw new Error(`Exact device ${serial} is not ready in Windows ADB (visible: ${visible}).`);
  }
  return { serial, transport: 'windows-adb' };
}

function flowTarget(flow) {
  if (!flow) return workspaceRoot;
  const target = resolve(flowsRoot, flow);
  const inside = relative(flowsRoot, target);
  if (!inside || inside.startsWith('..') || target === flowsRoot || !target.endsWith('.yaml')) {
    throw new Error('--flow must name one YAML file inside .maestro/flows');
  }
  if (!existsSync(target)) throw new Error(`Flow was not found: ${target}`);
  return target;
}

function gitSha() {
  const result = commandOutput('git', ['-C', repoRoot, 'rev-parse', 'HEAD']);
  return result.status === 0 && /^[a-f0-9]{40}$/.test(result.output) ? result.output : null;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function buildArguments(options, runtime, target, output) {
  const mapped = value => runtime.mapPath(value);
  return [
    '--no-ansi',
    `--device=${options.device}`,
    'test',
    '-e',
    `APP_ID=${options.appId}`,
    ...(options.tags ? [`--include-tags=${options.tags}`] : []),
    `--debug-output=${mapped(join(output, 'debug'))}`,
    `--test-output-dir=${mapped(join(output, 'artifacts'))}`,
    '--format=JUNIT',
    `--output=${mapped(join(output, 'junit.xml'))}`,
    mapped(target),
  ];
}

function main() {
  const options = parseMaestroArgs(process.argv.slice(2));
  if (options.help) return usage();
  const runtime = resolveRuntime(options);
  if (options.doctor) {
    console.log(JSON.stringify({ pinnedVersion, ...verifyTooling(runtime) }, null, 2));
    return;
  }
  if (!options.device) throw new Error('--device is required so Maestro cannot select a random attached target.');
  const target = flowTarget(options.flow);
  const output = join(repoRoot, 'output', 'maestro', `${timestamp()}--${options.device}`);
  const args = buildArguments(options, runtime, target, output);
  const invocation = runtime.invocation(args);
  if (options.dryRun) {
    console.log(JSON.stringify({
      pinnedVersion,
      host: runtime.host,
      wslDistro: runtime.distro || null,
      command: invocation.command,
      args: invocation.args,
      stdin: invocation.input || null,
      target: runtime.mapPath(target),
    }, null, 2));
    return;
  }
  const tooling = verifyTooling(runtime);
  const deviceGuard = verifyExactDevice(runtime, options.device);
  mkdirSync(output, { recursive: true });
  const evidence = {
    schema_version: 1,
    started_at: new Date().toISOString(),
    git_sha: gitSha(),
    app_id: options.appId,
    device: options.device,
    device_guard: deviceGuard,
    target: relative(mobileRoot, target),
    tags: options.tags ? options.tags.split(',') : [],
    tooling,
  };
  writeFileSync(join(output, 'run.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: runtime.cwd,
    env: {
      ...process.env,
      ...runtime.env,
      MAESTRO_CLI_NO_ANALYTICS: 'true',
      MAESTRO_DRIVER_STARTUP_TIMEOUT: process.env.MAESTRO_DRIVER_STARTUP_TIMEOUT || '120000',
    },
    input: invocation.input,
    stdio: invocation.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  evidence.finished_at = new Date().toISOString();
  evidence.exit_code = result.status;
  writeFileSync(join(output, 'run.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Maestro runner failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
