import { api } from '../api'
import { failureText } from '../copy'
import { Btn, Empty } from '../components/ui'
import { tr } from '../i18n'
import { useApp } from '../store'
import type { Failure, Folder } from '../types'

export function FolderIssue({ folder, failure }: { folder: Folder; failure: Failure }) {
  const { load, locateFolder, set } = useApp.getState()
  const retry = <Btn onClick={() => void load(folder.path)}>{tr('Try again')}</Btn>
  if (failure.code === 'permission') {
    return (
      <Empty
        icon="shield"
        title={tr('Dropzone can’t open {0}', folder.name)}
        actions={
          <>
            <Btn kind="primary" onClick={() => void api.openPrivacySettings()}>
              {tr('Open System Settings')}
            </Btn>
            {retry}
          </>
        }
      >
        {tr('macOS needs your permission first. In System Settings, open Privacy & Security, then Files and Folders, and allow Dropzone to read {0}.', folder.name)}
      </Empty>
    )
  }
  if (failure.code === 'missing' || failure.code === 'notfolder') {
    return (
      <Empty
        icon="alert"
        title={tr('{0} isn’t available', folder.name)}
        actions={
          <>
            <Btn kind="primary" onClick={() => void locateFolder(folder.path)}>
              {tr('Locate…')}
            </Btn>
            {retry}
            <Btn kind="ghost" onClick={() => set({ sheet: { type: 'remove', path: folder.path } })}>
              {tr('Remove from Dropzone…')}
            </Btn>
          </>
        }
      >
        {tr('It may have been moved or renamed, or it’s on a drive that isn’t connected.')}
      </Empty>
    )
  }
  return (
    <Empty icon="alert" title={tr('Dropzone couldn’t read {0}', folder.name)} actions={retry}>
      {failureText(failure)}
    </Empty>
  )
}
