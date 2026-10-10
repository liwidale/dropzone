import { AnimatePresence, motion } from 'motion/react'
import { FileList } from '../components/FileList'
import { Inspector } from '../components/Inspector'
import { PRESET_LABEL } from '../components/Toolbar'
import { Btn, Empty, Seg } from '../components/ui'
import { tr } from '../i18n'
import { Icon } from '../icons'
import { KINDS } from '../kinds'
import { folderOf, useApp } from '../store'
import { useVisible } from '../visible'

export function Files() {
  const folder = useApp(folderOf)!
  const scope = useApp((s) => s.scope)
  const kind = useApp((s) => s.kind)
  const preset = useApp((s) => s.preset)
  const query = useApp((s) => s.query)
  const inspector = useApp((s) => s.inspector)
  const total = useApp((s) => s.snapshots[s.current!]?.data?.entries.length ?? 0)
  const visible = useVisible()
  const { set, go } = useApp.getState()
  const filtered = !!(kind || preset || query)
  const protectedCount = visible.filter((e) => e.project != null).length

  return (
    <div className="files">
      <div className="files-main">
        <div className="filterbar">
          {preset ? (
            <span className="token">
              {PRESET_LABEL[preset]}
              <button type="button" aria-label={tr('Clear filter')} onClick={() => go('files', { kind: null, preset: null })}>
                <Icon name="close" size={9} strokeWidth={2} />
              </button>
            </span>
          ) : (
            <Seg
              label={tr('Show')}
              value={scope}
              onChange={(v) => set({ scope: v, selection: [] })}
              options={[
                { value: 'all', label: tr('Everything') },
                { value: 'top', label: tr('Top level only') },
              ]}
            />
          )}
          {kind && (
            <span className="token">
              <span className="dot" style={{ background: KINDS[kind].color }} />
              {KINDS[kind].many}
              <button type="button" aria-label={tr('Clear filter')} onClick={() => go('files', { kind: null, preset: null })}>
                <Icon name="close" size={9} strokeWidth={2} />
              </button>
            </span>
          )}
          {protectedCount > 0 && (
            <span className="filter-note" title={tr('Sorting and duplicate cleanup never touch files inside code projects. Moving them by hand asks first.')}>
              <Icon name="code" size={12} />
              {tr('{0} file in code projects is protected|{0} files in code projects are protected', protectedCount)}
            </span>
          )}
        </div>
        {visible.length ? (
          <FileList entries={visible} location={scope === 'all' || !!preset} rootName={folder.name} />
        ) : total === 0 ? (
          <Empty icon="folder" title={tr('{0} is empty', folder.name)}>
            {tr('Files you download or save here show up in Dropzone right away.')}
          </Empty>
        ) : (
          <Empty
            icon="search"
            title={tr('No matches')}
            actions={
              filtered || scope === 'top' ? (
                <Btn
                  onClick={() => {
                    set({ query: '', scope: 'all' })
                    go('files', { kind: null, preset: null })
                  }}
                >
                  {tr('Show all files')}
                </Btn>
              ) : undefined
            }
          >
            {query ? tr('Nothing in {0} matches “{1}”.', folder.name, query) : tr('Nothing here fits this filter right now.')}
          </Empty>
        )}
      </div>
      <AnimatePresence initial={false}>
        {inspector && (
          <motion.div
            className="insp-wrap"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Inspector />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
