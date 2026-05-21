import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(appDir, '../..');
const requireFromApp = createRequire(path.join(appDir, 'package.json'));
const vendorDir = path.join(appDir, '.desktop-vendor');
const vendorNodeModules = path.join(vendorDir, 'node_modules');
const copied = new Set();

function packageRoot(packageName, fromDir = appDir) {
  const packageJson = requireFromApp.resolve(`${packageName}/package.json`, { paths: [fromDir, repoRoot] });
  return path.dirname(packageJson);
}

function copyRuntimePackage(packageName, fromDir = appDir) {
  const source = packageRoot(packageName, fromDir);
  const manifestPath = path.join(source, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const key = `${manifest.name}@${manifest.version || source}`;
  if (copied.has(key)) return;
  copied.add(key);

  const target = path.join(vendorNodeModules, ...manifest.name.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter: (entry) => !entry.includes(`${path.sep}.git${path.sep}`) && !entry.endsWith(`${path.sep}.git`),
  });

  const dependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
  for (const dependencyName of Object.keys(dependencies)) {
    copyRuntimePackage(dependencyName, source);
  }
}

function runPackager() {
  const modelPath = path.resolve(repoRoot, 'apps/voice-stream/android/app/src/main/assets/model-en-us');
  const args = [
    '.',
    'VoiceStream',
    '--out',
    'release/desktop',
    '--overwrite',
    `--extra-resource=${modelPath}`,
    `--extra-resource=${vendorNodeModules}`,
    '--protocol=voicestream',
    '--protocol-name=VoiceStream',
    "--ignore=^/(android|docs|gradle|release|server|web|dist|\\.desktop-vendor)(/|$)",
    "--ignore=^/(build.gradle.kts|settings.gradle.kts|gradle.properties|gradlew|gradlew.bat)$",
  ];
  const result = spawnSync('electron-packager', args, {
    cwd: appDir,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

fs.rmSync(vendorDir, { recursive: true, force: true });
fs.mkdirSync(vendorNodeModules, { recursive: true });

try {
  copyRuntimePackage('vosk');
  runPackager();
} finally {
  fs.rmSync(vendorDir, { recursive: true, force: true });
}
