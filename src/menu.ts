import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'

export type MenuSpec = 'separator' | { text: string; action?: () => void; enabled?: boolean; items?: MenuSpec[] }

async function build(s: MenuSpec): Promise<MenuItem | PredefinedMenuItem | Submenu> {
  if (s === 'separator') return PredefinedMenuItem.new({ item: 'Separator' })
  if (s.items) return Submenu.new({ text: s.text, enabled: s.enabled ?? true, items: await Promise.all(s.items.map(build)) })
  return MenuItem.new({ text: s.text, enabled: s.enabled ?? true, action: s.action })
}

export async function popup(spec: MenuSpec[]): Promise<void> {
  const menu = await Menu.new({ items: await Promise.all(spec.map(build)) })
  await menu.popup()
}
