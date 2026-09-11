import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

type Step = {
  env?: Record<string, unknown>
  id?: string
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

type Job = {
  if?: string
  needs?: string | string[]
  permissions?: Record<string, unknown>
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
        arch: 'x64',
        platform: 'windows-latest',
        release_platform: 'windows',
      },
      {
        args: '--target universal-apple-darwin --bundles dmg',
        arch: 'universal',
        platform: 'macos-latest',
        release_platform: 'macos',
        targets: 'aarch64-apple-darwin,x86_64-apple-darwin',
      },
      {
        args: '--bundles appimage deb',
        arch: 'x64',
        platform: 'ubuntu-22.04',
        release_platform: 'linux',
      },
    ])
    expect(JSON.stringify(matrix)).not.toContain('android')
  })

  test('builds without a write token and hands off normalized artifacts', () => {
    const releaseJob = workflow.jobs['release-desktop']
    const checkoutStep = releaseJob.steps?.find((step) =>
      step.uses?.startsWith('actions/checkout@'),
    )
    const tauriStep = releaseJob.steps?.find((step) =>
      step.uses?.startsWith('tauri-apps/tauri-action@'),
    )
    const uploadArtifactStep = releaseJob.steps?.find((step) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    )

    expect(releaseJob.permissions).toEqual({ contents: 'read' })
    expect(checkoutStep?.with?.['persist-credentials']).toBe(false)
    expect(tauriStep?.uses).toMatch(/^tauri-apps\/tauri-action@[0-9a-f]{40}$/)
    expect(tauriStep?.env?.GITHUB_TOKEN).toBeUndefined()
    expect(tauriStep?.with?.releaseId).toBeUndefined()
    expect(tauriStep?.with?.tagName).toBeUndefined()
    expect(tauriStep?.with?.includeUpdaterJson).toBe(false)
    expect(tauriStep?.with?.releaseAssetNamePattern).toBeUndefined()
    expect(tauriStep?.with?.uploadUpdaterJson).toBeUndefined()
    expect(uploadArtifactStep?.with?.['if-no-files-found']).toBe('error')
  })

  test('uploads into the existing draft and finalizes only afterward', () => {
    const uploadJob = workflow.jobs['upload-release']
    const downloadArtifactStep = uploadJob.steps?.find((step) =>
      step.uses?.startsWith('actions/download-artifact@'),
    )
    const finalizeJob = workflow.jobs['finalize-release']
    const finalizeStep = finalizeJob.steps?.find((step) =>
      step.uses?.startsWith('changepacks/action@'),
    )
    const uploadReleaseStep = uploadJob.steps?.find((step) =>
      step.run?.includes('gh release upload'),
    )

    expect(uploadJob.needs).toEqual(['changepacks', 'release-desktop'])
    expect(uploadJob.permissions).toEqual({ contents: 'write' })
    expect(downloadArtifactStep?.with?.pattern).toBe('desktop-*')
    expect(
      uploadJob.steps?.some((step) => step.run?.includes('gh release upload')),
    ).toBe(true)
    expect(uploadReleaseStep?.env?.GH_REPO).toBe('${{ github.repository }}')
    expect(finalizeJob.needs).toEqual(['changepacks', 'upload-release'])
    expect(finalizeStep?.with?.finalize_releases).toBe(
      '${{ needs.changepacks.outputs.pending_releases }}',
    )
  })

  test('pins every reusable action to an immutable commit', () => {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses && !step.uses.startsWith('./')) {
          expect(step.uses).toMatch(/^[^@]+@[0-9a-f]{40}$/)
        }
      }
    }
  })
})
