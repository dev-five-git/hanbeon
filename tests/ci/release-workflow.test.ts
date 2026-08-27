import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

type Step = {
  id?: string
  uses?: string
  with?: Record<string, unknown>
}

type Job = {
  if?: string
  needs?: string | string[]
  strategy?: {
    matrix?: {
      include?: Array<Record<string, unknown>>
    }
  }
  steps?: Step[]
}

type Workflow = {
  jobs: Record<string, Job & { outputs?: Record<string, unknown> }>
}

const repositoryRoot = resolve(import.meta.dir, '../..')
const workflow = Bun.YAML.parse(
  readFileSync(resolve(repositoryRoot, '.github/workflows/ci.yml'), 'utf8'),
) as Workflow
const tauriConfig = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'apps/desktop/src-tauri/tauri.conf.json'),
    'utf8',
  ),
) as {
  bundle: { icon: string[]; windows: { wix: { language: string } } }
  version: string
}
const rootPackage = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as { private?: boolean }

describe('desktop release workflow', () => {
  test('uses the changepacks package version for Tauri bundles', () => {
    expect(tauriConfig.version).toBe('../../../package.json')
  })

  test('includes native installer icons', () => {
    expect(tauriConfig.bundle.icon).toContain('icons/icon.ico')
    expect(tauriConfig.bundle.icon).toContain('icons/icon.icns')
    expect(tauriConfig.bundle.windows.wix.language).toBe('ko-KR')
  })

  test('exports the draft release receipt', () => {
    const changepacksStep = workflow.jobs.changepacks.steps?.find((step) =>
      step.uses?.startsWith('changepacks/action@'),
    )

    expect(rootPackage.private).toBe(true)
    expect(changepacksStep?.with?.publish).toBe(true)
    expect(workflow.jobs.changepacks.outputs?.pending_releases).toBe(
      '${{ steps.changepacks.outputs.pending_releases }}',
    )
  })

  test('builds only the approved desktop bundles', () => {
    const releaseJob = workflow.jobs['release-desktop']
    const matrix = releaseJob.strategy?.matrix?.include

    expect(releaseJob.if).toContain('pending_releases')
    expect(matrix).toEqual([
      {
        args: '--bundles nsis msi',
        platform: 'windows-latest',
      },
      {
        args: '--target universal-apple-darwin --bundles dmg',
        platform: 'macos-latest',
        targets: 'aarch64-apple-darwin,x86_64-apple-darwin',
      },
      {
        args: '--bundles appimage deb',
        platform: 'ubuntu-22.04',
      },
    ])
    expect(JSON.stringify(matrix)).not.toContain('android')
  })

  test('uploads into the existing draft and finalizes after all builds', () => {
    const releaseJob = workflow.jobs['release-desktop']
    const tauriStep = releaseJob.steps?.find((step) =>
      step.uses?.startsWith('tauri-apps/tauri-action@'),
    )
    const finalizeJob = workflow.jobs['finalize-release']
    const finalizeStep = finalizeJob.steps?.find((step) =>
      step.uses?.startsWith('changepacks/action@'),
    )

    expect(tauriStep?.uses).toMatch(/^tauri-apps\/tauri-action@[0-9a-f]{40}$/)
    expect(tauriStep?.with?.releaseId).toContain('pending_releases')
    expect(tauriStep?.with?.releaseDraft).toBe(true)
    expect(finalizeJob.needs).toEqual(['changepacks', 'release-desktop'])
    expect(finalizeStep?.with?.finalize_releases).toBe(
      '${{ needs.changepacks.outputs.pending_releases }}',
    )
  })
})
