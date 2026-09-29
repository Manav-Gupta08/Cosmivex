import { expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, appendFile, rename, unlink, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function verifyFilesystem(page, canvasIsVisible) {
  const root = await mkdtemp(join(tmpdir(), 'universe-fs-ui-'))
  await mkdir(join(root, 'child'))
  await writeFile(join(root, 'seed.txt'), 'fixture')
  try {
    await page.getByRole('button', { name: 'Filesystem view', exact: true }).click()
    await expect(page.getByTestId('file-count')).toHaveText('0')
    await page.getByRole('textbox', { name: 'Filesystem root path' }).fill(root)
    await page.getByRole('button', { name: 'Open folder', exact: true }).click()
    await expect(page.getByTestId('file-count')).toHaveText('2', { timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Parent folder' })).toBeDisabled()
    await canvasIsVisible()
    await page.screenshot({ path: 'artifacts/native-filesystem.png' })
    await page.getByRole('button', { name: 'Filesystem list', exact: true }).click()
    await page.getByRole('button', { name: 'seed.txt', exact: true }).click()
    await expect(page.getByTestId('file-size')).toHaveText('7')
    await page.getByRole('button', { name: 'Close file details' }).click()
    await expect(async () => {
      const viewport = page.viewportSize()
      await page.mouse.click(viewport.width / 2, viewport.height / 2)
      await expect(page.getByRole('complementary', { name: 'File details' }).getByRole('heading', { name: 'seed.txt' })).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 8000 })
    await page.getByRole('button', { name: 'Close file details' }).click()
    await page.getByRole('button', { name: 'Filesystem list', exact: true }).click()
    await page.getByRole('button', { name: 'child', exact: true }).click()
    await page.getByRole('button', { name: 'Open directory', exact: true }).click()
    await expect(page.getByTestId('file-count')).toHaveText('0', { timeout: 8000 })
    await expect(page.getByRole('button', { name: 'Parent folder' })).toBeEnabled()
    await page.getByRole('button', { name: 'Parent folder' }).click()
    await expect(page.getByTestId('file-count')).toHaveText('2', { timeout: 8000 })
    await writeFile(join(root, 'created.txt'), 'hello')
    await expect(page.getByTestId('file-count')).toHaveText('3', { timeout: 8000 })
    await page.getByRole('button', { name: 'Filesystem list', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search files' }).fill('created')
    await page.getByRole('button', { name: 'created.txt', exact: true }).click()
    await expect(page.getByTestId('file-size')).toHaveText('5')
    await appendFile(join(root, 'created.txt'), '!!')
    await expect(page.getByTestId('file-size')).toHaveText('7', { timeout: 8000 })
    await rename(join(root, 'created.txt'), join(root, 'renamed.txt'))
    await expect(page.getByTestId('file-status')).toHaveText('No longer observed', { timeout: 8000 })
    await page.getByRole('button', { name: 'Close file details' }).click()
    await unlink(join(root, 'renamed.txt'))
    await expect(page.getByTestId('file-count')).toHaveText('2', { timeout: 8000 })
    await page.getByRole('button', { name: 'Filesystem list', exact: true }).click()
    await page.getByRole('tab', { name: 'Changes', exact: true }).click()
    for (const [kind, name] of [['FILE_CREATED', 'created.txt'], ['FILE_MODIFIED', 'created.txt'], ['FILE_MOVED', 'renamed.txt'], ['FILE_DELETED', 'renamed.txt']]) {
      await expect(page.locator(`.filesystem-browser li[data-kind="${kind}"][data-name="${name}"]`).first()).toBeVisible({ timeout: 8000 })
    }
    await page.screenshot({ path: 'artifacts/native-file-events.png' })
    await page.setViewportSize({ width: 400, height: 740 })
    expect(await page.getByRole('complementary', { name: 'Filesystem list' }).evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: 'artifacts/native-narrow-filesystem.png' })
    await page.setViewportSize({ width: 1360, height: 820 })
    await page.getByRole('button', { name: 'Close filesystem list' }).click()
    await page.getByRole('button', { name: 'Reset camera' }).click()
    await page.getByRole('button', { name: 'Engine diagnostics' }).click()
    const revision = await page.getByTestId('filesystem-revision').innerText()
    const sequence = BigInt(await page.getByTestId('sequence').innerText())
    await expect.poll(async () => BigInt(await page.getByTestId('sequence').innerText()) >= sequence + 6n, { timeout: 12000 }).toBe(true)
    await expect(page.getByTestId('filesystem-revision')).toHaveText(revision)
    await expect(page.getByTestId('camera-motion')).toHaveText('Still', { timeout: 10000 })
    let frames = '', stable = 0
    await expect.poll(async () => {
      const current = await page.getByTestId('frames-rendered').innerText()
      stable = current === frames ? stable + 1 : 0; frames = current
      return stable
    }, { timeout: 10000, intervals: [1000] }).toBeGreaterThanOrEqual(3)
    console.log('FILESYSTEM DIAGNOSTICS', await page.getByRole('complementary').innerText())
    await page.getByRole('button', { name: 'Close diagnostics' }).click()
    await page.getByRole('button', { name: 'Stop filesystem watch' }).click()
    await expect(page.getByTestId('file-count')).toHaveText('0', { timeout: 8000 })
    expect(await readFile(join(root, 'seed.txt'), 'utf8')).toBe('fixture')
    await page.getByRole('button', { name: 'Universe view', exact: true }).click()
    console.log(JSON.stringify({ filesystemMetadata: true, realCreateModifyRenameDelete: true, scopedNavigation: true, directFilePicking: true, idleRevisionStable: true, contentsUnchanged: true }))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}