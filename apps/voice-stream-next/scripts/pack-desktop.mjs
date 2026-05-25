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

function voiceStreamDataDir() {
  const configured = process.env.VOICE_STREAM_NEXT_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(appDir, 'server', 'data');
}

function jsonString(value) {
  return JSON.stringify(String(value ?? ''));
}

function publishDesktopDownload() {
  const releaseRoot = path.join(appDir, 'release', 'desktop');
  const packagedDir = fs
    .readdirSync(releaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('VoiceStream-'))
    .map((entry) => path.join(releaseRoot, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!packagedDir) {
    throw new Error(`No packaged desktop app was found in ${releaseRoot}`);
  }

  const outputDir = path.join(voiceStreamDataDir(), 'desktop');
  const variant = `${process.platform}-${process.arch}`;
  const variantFileName = `voice-stream-next-desktop-${variant}.tar.gz`;
  const latestFileName = 'voice-stream-next-desktop-latest.tar.gz';
  const variantFile = path.join(outputDir, variantFileName);
  const latestFile = path.join(outputDir, latestFileName);

  fs.mkdirSync(outputDir, { recursive: true });
  const result = spawnSync('tar', ['-czf', variantFile, '-C', path.dirname(packagedDir), path.basename(packagedDir)], {
    cwd: appDir,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Failed to archive desktop app ${packagedDir}`);
  }
  fs.copyFileSync(variantFile, latestFile);

  const metadata = `{
  "app": "voice-stream-next",
  "platform": "desktop",
  "variant": ${jsonString(variant)},
  "fileName": ${jsonString(latestFileName)},
  "variantFileName": ${jsonString(variantFileName)},
  "size": ${fs.statSync(latestFile).size},
  "builtAt": ${jsonString(new Date().toISOString())}
}
`;
  fs.writeFileSync(path.join(outputDir, 'latest.json'), metadata);
  console.log(`Published VoiceStream desktop archive to ${latestFile}`);
}

fs.rmSync(vendorDir, { recursive: true, force: true });
fs.mkdirSync(vendorNodeModules, { recursive: true });

try {
  copyRuntimePackage('vosk');
  runPackager();
  publishDesktopDownload();
} finally {
  fs.rmSync(vendorDir, { recursive: true, force: true });
}
