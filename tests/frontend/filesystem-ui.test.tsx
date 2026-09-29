import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FileInspector, FileSystemBrowser, FolderControls } from '../../apps/desktop/src/FileSystem'
import { useCoreStore } from '../../apps/desktop/src/state/core'
import { coreFixture, fileFixture, filesystemFixture } from './fixtures'
import { openFilesystemRoot, navigateFilesystem } from '../../apps/desktop/src/transport'

vi.mock('../../apps/desktop/src/transport', () => ({ openFilesystemRoot: vi.fn().mockResolvedValue(undefined), navigateFilesystem: vi.fn().mockResolvedValue(undefined), stopFilesystem: vi.fn().mockResolvedValue(undefined) }))
beforeEach(() => {
  vi.clearAllMocks()
  useCoreStore.getState().begin()
  useCoreStore.getState().receive({ ...coreFixture, filesystem: filesystemFixture }, 100, 1000)
})
afterEach(cleanup)

it('opens a root only after explicit submission and offers no write commands', () => {
  render(<FolderControls />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Filesystem root path' }), { target: { value: 'C:\\fixture' } })
  expect(openFilesystemRoot).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Open folder' }))
  expect(openFilesystemRoot).toHaveBeenCalledWith('C:\\fixture')
  expect(screen.getByRole('button', { name: 'Parent folder' })).toBeDisabled()
})

it('inspects metadata and disables navigation into reparse entries', () => {
  const store = useCoreStore.getState()
  store.receive({ ...coreFixture, sequence: '2', filesystem: { ...filesystemFixture, entries: [{ ...fileFixture, name: 'alias', directory: true, reparse: true, size: null }] } }, 100, 2000)
  render(<FileSystemBrowser close={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'alias' }))
  cleanup()
  render(<FileInspector />)
  expect(screen.getByRole('button', { name: 'Open directory' })).toBeDisabled()
  expect(screen.getByText('Not traversed')).toBeInTheDocument()
  expect(navigateFilesystem).not.toHaveBeenCalled()
})

it('keeps disappeared file metadata but clears it across directory scopes', () => {
  const store = useCoreStore.getState()
  store.selectFile(fileFixture.id)
  store.receive({ ...coreFixture, sequence: '2', filesystem: { ...filesystemFixture, entries: [] } }, 100, 2000)
  render(<FileInspector />)
  expect(screen.getByTestId('file-status')).toHaveTextContent('No longer observed')
  cleanup()
  store.receive({ ...coreFixture, sequence: '3', filesystem: { ...filesystemFixture, scope: '2', entries: [] } }, 100, 3000)
  expect(useCoreStore.getState().selectedFile).toBeNull()
})