import { describe, test, expect, vi } from 'vitest'
import {
  loadElfFromFile,
  loadElfFromUrl,
  loadElfFromGithubRelease,
  buildGithubReleaseUrl,
  parseGithubReleaseSpec,
} from '@/lib/emulator/elfSources'

describe('loadElfFromFile', () => {
  test('reads the file into an ArrayBuffer', async () => {
    const data = new Uint8Array([1, 2, 3, 4])
    const file = new File([data], 'test.elf', { type: 'application/octet-stream' })
    const { buffer, descriptor } = await loadElfFromFile(file)
    expect(new Uint8Array(buffer)).toEqual(data)
    expect(descriptor.kind).toBe('file')
    expect(descriptor.label).toBe('test.elf')
    expect(descriptor.detail).toContain('4')
  })
})

describe('loadElfFromUrl', () => {
  test('fetches an ArrayBuffer', async () => {
    const data = new Uint8Array([10, 20, 30]).buffer
    const fakeFetch: typeof fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => data,
    } as Response))
    const { buffer, descriptor } = await loadElfFromUrl(
      'https://example.com/path/main.elf',
      fakeFetch,
    )
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array(data))
    expect(descriptor.kind).toBe('url')
    expect(descriptor.label).toBe('main.elf')
  })

  test('throws on non-2xx', async () => {
    const fakeFetch: typeof fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response))
    await expect(
      loadElfFromUrl('https://example.com/missing.elf', fakeFetch),
    ).rejects.toThrow(/404/)
  })

  test('label falls back to host when URL has no path', async () => {
    const data = new ArrayBuffer(8)
    const fakeFetch: typeof fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => data,
    } as Response))
    const { descriptor } = await loadElfFromUrl('https://example.com/', fakeFetch)
    expect(descriptor.label).toBe('example.com')
  })
})

describe('parseGithubReleaseSpec', () => {
  test('parses a well-formed spec', () => {
    expect(parseGithubReleaseSpec('synth/firmware@v1.2.3/main.elf')).toEqual({
      owner: 'synth',
      repo: 'firmware',
      tag: 'v1.2.3',
      asset: 'main.elf',
    })
  })

  test('allows deep asset paths', () => {
    expect(
      parseGithubReleaseSpec('o/r@tag/build/output.elf'),
    ).toEqual({ owner: 'o', repo: 'r', tag: 'tag', asset: 'build/output.elf' })
  })

  test('rejects bad specs', () => {
    expect(parseGithubReleaseSpec('not a spec')).toBeNull()
    expect(parseGithubReleaseSpec('owner/repo')).toBeNull()
    expect(parseGithubReleaseSpec('owner@tag/asset')).toBeNull()
  })
})

describe('buildGithubReleaseUrl', () => {
  test('constructs the direct-download URL', () => {
    const url = buildGithubReleaseUrl('synth', 'firmware', 'v1.0', 'main.elf')
    expect(url).toBe(
      'https://github.com/synth/firmware/releases/download/v1.0/main.elf',
    )
  })

  test('URL-encodes special characters', () => {
    const url = buildGithubReleaseUrl('org', 'repo', 'v1.0 beta', 'asset.elf')
    expect(url).toContain('v1.0%20beta')
  })
})

describe('loadElfFromGithubRelease', () => {
  test('builds the URL and fetches', async () => {
    const data = new Uint8Array(16).buffer
    const fakeFetch: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      expect(url).toContain(
        'github.com/synth/firmware/releases/download/v1.0/main.elf',
      )
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => data,
      } as Response
    })
    const { descriptor } = await loadElfFromGithubRelease(
      'synth/firmware@v1.0/main.elf',
      fakeFetch,
    )
    expect(descriptor.kind).toBe('github-release')
    expect(descriptor.label).toBe('synth/firmware@v1.0')
    expect(descriptor.detail).toContain('main.elf')
  })

  test('throws on bad spec', async () => {
    await expect(
      loadElfFromGithubRelease('not-a-spec'),
    ).rejects.toThrow(/Invalid GitHub release spec/)
  })
})
