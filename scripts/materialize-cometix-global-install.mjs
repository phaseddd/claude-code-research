#!/usr/bin/env node
// 将 @cometix/claude-code 的某个 npm 版本安装到一个隔离的 global prefix。
//
// 目标不是复刻 Cometix 的构建链路，而是沉淀 npm 发布物执行
// `npm install -g @cometix/claude-code@<version>` 之后的真实产物形态。
//
// 输出约定：
//   <out>/<version>/install-summary.json   本项目自己的安装记录
//   <out>/<version>/global-prefix/         严格对标 npm global prefix 的产物目录
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { delimiter, join, resolve, sep } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const DEFAULT_PACKAGE = '@cometix/claude-code';

// npm 的 global install 会把命令 shim 放在 prefix 根目录，把包放在
// prefix/node_modules 下。这里固定使用 global-prefix 作为隔离 prefix 名称。
const PRODUCT_DIR = 'global-prefix';

function usage() {
  return `Usage:
  node scripts/materialize-cometix-global-install.mjs --version <x.y.z> --out <folder> [--force]

Example:
  node scripts/materialize-cometix-global-install.mjs --version 2.1.199 --out artifacts --force

Output:
  <folder>/<version>/
    install-summary.json
    global-prefix/
      node_modules/
      claude
      claude.cmd
      claude.ps1
`;
}

// 只解析脚本自己需要的参数。--package 保留为调试入口，默认始终处理
// @cometix/claude-code，日常使用只需要 --version / --out / --force。
function parseArgs(argv) {
  const flags = {
    force: false,
    packageName: DEFAULT_PACKAGE,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--version' && argv[i + 1]) flags.version = argv[++i];
    else if (arg === '--out' && argv[i + 1]) flags.out = argv[++i];
    else if (arg === '--force') flags.force = true;
    else if (arg === '--package' && argv[i + 1]) flags.packageName = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return flags;
}

function isWindows() {
  return process.platform === 'win32';
}

function quoteCmdArg(arg) {
  const value = String(arg);
  return /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

// Windows 下 npm 通常是 npm.cmd。execFileSync 直接执行 npm 时，在某些
// PATH/扩展名解析场景会遇到 ENOENT，所以这里显式找 npm.cmd。
function findNpmCommand() {
  if (!isWindows()) return 'npm';

  const candidates = [];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    candidates.push(join(dir, 'npm.cmd'));
  }
  candidates.push('D:\\Node\\npm.cmd', 'D:\\Node\\node_global\\npm.cmd');

  return candidates.find((candidate) => existsSync(candidate)) ?? 'npm.cmd';
}

// 统一的同步命令执行封装。这里故意使用同步调用：每一步都是安装流水线的
// 强顺序阶段，失败时应立即中止后续写入。
function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding,
    stdio: options.stdio ?? 'pipe',
    timeout: options.timeout ?? 600_000,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });
}

// Windows 下通过 cmd.exe 调 npm.cmd；非 Windows 直接执行 npm。
// 这样脚本可以跨 PowerShell/cmd/pwsh 调用，避免依赖当前 shell 的别名规则。
function runNpm(args, options = {}) {
  if (!isWindows()) {
    return run('npm', args, options);
  }

  const commandLine = [findNpmCommand(), ...args].map(quoteCmdArg).join(' ');
  return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', commandLine], options);
}

// 使用本次隔离 prefix 里生成的 claude shim 做最终验收。
// 这比直接 node cli.js 更贴近用户真实执行 `claude` 命令时的路径。
function runShim(prefixDir, args, options = {}) {
  if (!isWindows()) {
    return run(join(prefixDir, 'claude'), args, options);
  }

  const commandLine = [join(prefixDir, 'claude.cmd'), ...args].map(quoteCmdArg).join(' ');
  return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', commandLine], options);
}

// 对会被删除或写入的路径做父子关系校验，避免 --force 时误删目标目录外的内容。
function assertChild(parent, child) {
  const parentResolved = resolve(parent).toLowerCase();
  const childResolved = resolve(child).toLowerCase();
  if (childResolved !== parentResolved && !childResolved.startsWith(parentResolved + sep)) {
    throw new Error(`Refusing to operate outside target directory: ${child}`);
  }
}

// 准备 <out>/<version>。只有调用方已经确认 npm 上存在该版本后，才允许进入这里。
// 这能避免 Claude Code 跳号时，--force 先删旧目录再发现版本不存在。
async function prepareVersionDir(versionDir, force) {
  if (existsSync(versionDir)) {
    if (!force) {
      throw new Error(`Output version directory already exists: ${versionDir}\nUse --force to replace it.`);
    }
    await rm(versionDir, { recursive: true, force: true });
  }
  await mkdir(versionDir, { recursive: true });
}

async function readInstalledVersion(packageDir) {
  const packageJsonPath = join(packageDir, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  return packageJson.version;
}

// 预检查 npm registry 是否真的存在这个版本。
//
// 设计原因：
// - Claude Code/Cometix 可能跳号，用户输入的版本不一定存在。
// - 预检查必须发生在 prepareVersionDir 之前，保护已有版本产物。
// - npm view 也会写 cache/log，因此给它单独分配系统临时 cache，并在 finally 中清理。
async function resolvePublishedVersion(packageSpec, expectedVersion) {
  const preflightCacheDir = await mkdtemp(join(tmpdir(), 'cometix-npm-view-'));
  try {
    const resolved = runNpm([
      'view',
      packageSpec,
      'version',
      '--cache',
      preflightCacheDir,
      '--no-audit',
      '--fund=false',
    ], {
      encoding: 'utf8',
      timeout: 60_000,
    }).trim();
    if (resolved !== expectedVersion) {
      throw new Error(`npm resolved ${packageSpec} to ${resolved}, expected ${expectedVersion}`);
    }
    return resolved;
  } catch (error) {
    const message = [
      `Package version is not available from npm: ${packageSpec}`,
      'Nothing was installed and the version output directory was not modified.',
      '',
      'Useful checks:',
      `  npm view ${packageSpec} version`,
      `  npm view ${DEFAULT_PACKAGE} versions --json`,
    ].join('\n');
    error.message = `${message}\n\nOriginal error:\n${error.message}`;
    throw error;
  } finally {
    await rm(preflightCacheDir, { recursive: true, force: true });
  }
}

async function ensureExists(path) {
  await stat(path);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.version || !args.out) {
    throw new Error(`Missing required arguments.\n${usage()}`);
  }

  const outRoot = resolve(args.out);
  const versionDir = join(outRoot, args.version);
  const prefixDir = join(versionDir, PRODUCT_DIR);
  const cacheDir = join(prefixDir, '.npm-cache');
  const packageDir = join(prefixDir, 'node_modules', '@cometix', 'claude-code');
  const packageSpec = `${args.packageName}@${args.version}`;

  // 这些 assert 不会创建目录，只是确认后续写入/删除边界都在目标 outRoot 内。
  assertChild(outRoot, versionDir);
  assertChild(versionDir, prefixDir);
  assertChild(prefixDir, cacheDir);

  // 先查版本，再动产物目录。这是处理“跳号”的关键保护。
  console.log(`[0] Check npm package version: ${packageSpec}`);
  const registryVersion = await resolvePublishedVersion(packageSpec, args.version);

  // 记录真实全局 prefix，后面写入 summary。它用于证明本脚本没有改动 npm 全局配置。
  const realGlobalPrefixBefore = runNpm(['config', 'get', 'prefix'], {
    encoding: 'utf8',
    timeout: 30_000,
  }).trim();

  console.log(`[1] Prepare output: ${versionDir}`);
  await prepareVersionDir(versionDir, args.force);
  await mkdir(prefixDir, { recursive: true });

  // 这里是脚本的核心：保留 -g 的真实安装行为，只把 prefix 指向隔离目录。
  // --cache 也放进 prefix 下面，安装结束后删除，避免默认 npm cache 留下副产物。
  console.log(`[2] npm install -g --prefix ${prefixDir} ${packageSpec}`);
  runNpm([
    'install',
    '-g',
    '--prefix',
    prefixDir,
    '--cache',
    cacheDir,
    '--no-audit',
    '--fund=false',
    packageSpec,
  ], {
    stdio: 'inherit',
    timeout: 900_000,
  });

  // 验收 global prefix 的关键产物：包目录、真实 cli.js/vendor、命令 shim。
  console.log('[3] Validate installed global-prefix product');
  await ensureExists(packageDir);
  await ensureExists(join(packageDir, 'cli.js'));
  await ensureExists(join(packageDir, 'vendor'));
  await ensureExists(join(prefixDir, isWindows() ? 'claude.cmd' : 'claude'));

  const installedVersion = await readInstalledVersion(packageDir);
  if (installedVersion !== args.version) {
    throw new Error(`Installed package version mismatch: expected ${args.version}, got ${installedVersion}`);
  }

  // 用 shim 跑 --version，确认 npm 生成的命令入口和包内 CLI 能连起来。
  const cliVersion = runShim(prefixDir, ['--version'], {
    encoding: 'utf8',
    timeout: 60_000,
  }).trim();
  if (!cliVersion.includes(args.version)) {
    throw new Error(`claude --version did not include ${args.version}: ${cliVersion}`);
  }

  console.log('[4] Remove isolated npm cache');
  assertChild(prefixDir, cacheDir);
  await rm(cacheDir, { recursive: true, force: true });

  // 再读一次真实全局 prefix；summary 中 before/after 一致时，可以证明没有污染真实全局环境。
  const realGlobalPrefixAfter = runNpm(['config', 'get', 'prefix'], {
    encoding: 'utf8',
    timeout: 30_000,
  }).trim();

  // summary 放在版本目录下，而不是 global-prefix 里。global-prefix 保持为纯 npm 安装产物。
  await writeFile(join(versionDir, 'install-summary.json'), JSON.stringify({
    package: args.packageName,
    version: args.version,
    registryVersion,
    packageSpec,
    generatedAt: new Date().toISOString(),
    productDir: prefixDir,
    packageDir,
    commandShim: isWindows()
      ? join(prefixDir, 'claude.cmd')
      : join(prefixDir, 'claude'),
    cliVersion,
    npmCacheRemoved: !existsSync(cacheDir),
    realGlobalPrefixBefore,
    realGlobalPrefixAfter,
  }, null, 2) + '\n');

  console.log('');
  console.log('Done.');
  console.log(`Version directory: ${versionDir}`);
  console.log(`Global-prefix product: ${prefixDir}`);
  console.log(`Package directory: ${packageDir}`);
  console.log(`Version check: ${cliVersion}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
