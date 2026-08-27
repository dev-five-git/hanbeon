import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'

import { collectReleaseAssets } from '../../scripts/ci/collect-release-assets'

const testRoot = mkdtempSync(join(tmpdir(), 'hanbeon-release-assets-'))

afterAll(() => {
  rmSync(testRoot, { force: true, recursive: true })
})

describe('collectReleaseAssets', () => {
  test('copies Windows installers to stable ASCII release names', () => {
    const nsis = join(testRoot, '한번_0.1.1_x64-setup.exe')
    const msi = join(testRoot, '한번_0.1.1_x64_ko-KR.msi')
    const outputDir = join(testRoot, 'windows-output')
    writeFileSync(nsis, 'nsis')
    writeFileSync(msi, 'msi')

    const outputs = collectReleaseAssets({
      arch: 'x64',
      artifactPaths: [nsis, msi],
      outputDir,
      platform: 'windows',
      version: '0.1.1',
    })

    expect(outputs.map((path) => path.replaceAll('\\', '/'))).toEqual([
      `${outputDir.replaceAll('\\', '/')}/hanbeon-0.1.1-windows-x64-msi.msi`,
      `${outputDir.replaceAll('\\', '/')}/hanbeon-0.1.1-windows-x64-nsis.exe`,
    ])
    expect(readFileSync(outputs[0], 'utf8')).toBe('msi')
    expect(readFileSync(outputs[1], 'utf8')).toBe('nsis')
  })

  test('rejects an incomplete bundle set', () => {
    const appImage = join(testRoot, 'hanbeon.AppImage')
    writeFileSync(appImage, 'appimage')

    expect(() =>
      collectReleaseAssets({
        arch: 'x64',
        artifactPaths: [appImage],
        outputDir: join(testRoot, 'linux-output'),
        platform: 'linux',
        version: '0.1.1',
      }),
    ).toThrow('Expected appimage, deb bundles')
  })
})
