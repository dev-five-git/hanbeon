import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

type ReleasePlatform = 'linux' | 'macos' | 'windows'

type CollectReleaseAssetsOptions = {
  arch: string
  artifactPaths: string[]
  outputDir: string
  platform: ReleasePlatform
  version: string
}

const bundleByExtension: Record<ReleasePlatform, Record<string, string>> = {
  linux: {
    '.appimage': 'appimage',
    '.deb': 'deb',
  },
  macos: {
    '.dmg': 'dmg',
  },
  windows: {
    '.exe': 'nsis',
    '.msi': 'msi',
  },
}

export function collectReleaseAssets({
  arch,
  artifactPaths,
  outputDir,
  platform,
  version,
}: CollectReleaseAssetsOptions): string[] {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`)
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z_-]*$/.test(arch)) {
    throw new Error(`Invalid release architecture: ${arch}`)
  }

  const platformBundles = bundleByExtension[platform]
  const expectedBundles = Object.values(platformBundles).sort()
  const artifacts = artifactPaths.map((sourcePath) => {
    if (!statSync(sourcePath).isFile()) {
      throw new Error(`Release artifact is not a file: ${sourcePath}`)
    }

    const extension = extname(sourcePath)
    const bundle = platformBundles[extension.toLowerCase()]
    if (!bundle) {
      throw new Error(`Unexpected ${platform} release artifact: ${sourcePath}`)
    }

    return { bundle, extension, sourcePath }
  })

  const actualBundles = artifacts.map(({ bundle }) => bundle).sort()
  if (JSON.stringify(actualBundles) !== JSON.stringify(expectedBundles)) {
    throw new Error(
      `Expected ${expectedBundles.join(', ')} bundles for ${platform}, received ${actualBundles.join(', ') || 'none'}`,
    )
  }

  mkdirSync(outputDir, { recursive: true })

  return artifacts
    .sort((left, right) => left.bundle.localeCompare(right.bundle))
    .map(({ bundle, extension, sourcePath }) => {
      const outputPath = join(
        outputDir,
        `hanbeon-${version}-${platform}-${arch}-${bundle}${extension}`,
      )
      copyFileSync(sourcePath, outputPath)
      return outputPath
    })
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

if (import.meta.main) {
  const platform = requiredEnvironmentVariable('RELEASE_PLATFORM')
  if (!(platform in bundleByExtension)) {
    throw new Error(`Unsupported release platform: ${platform}`)
  }

  const artifactPaths = JSON.parse(
    requiredEnvironmentVariable('TAURI_ARTIFACT_PATHS'),
  ) as unknown
  if (
    !Array.isArray(artifactPaths) ||
    artifactPaths.some((path) => typeof path !== 'string')
  ) {
    throw new Error('TAURI_ARTIFACT_PATHS must be a JSON array of file paths')
  }

  const outputPaths = collectReleaseAssets({
    arch: requiredEnvironmentVariable('RELEASE_ARCH'),
    artifactPaths,
    outputDir: requiredEnvironmentVariable('RELEASE_OUTPUT_DIR'),
    platform: platform as ReleasePlatform,
    version: requiredEnvironmentVariable('RELEASE_VERSION'),
  })

  for (const outputPath of outputPaths) {
    console.info(outputPath)
  }
}
