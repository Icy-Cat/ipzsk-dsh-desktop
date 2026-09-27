/**
 * The image panel is the IPZSK web studio: this placeholder reports its rectangle and
 * IPZSK Desktop lays its native, signed-in studio view over it while the panel is open.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ImageGenController } from './controller.ts'

interface StudioBounds { x: number; y: number; width: number; height: number }
/** main: this panel; nav: the desktop sidebar's region area, where the studio sidebar goes (null when collapsed). */
interface StudioLayout { main: StudioBounds; nav: StudioBounds | null }
interface StudioBridge {
  open(layout: StudioLayout): Promise<void>
  setBounds(layout: StudioLayout): Promise<void>
  close(): Promise<void>
}

const SIDEBAR_REGION_SELECTOR = '[data-dsh-imagegen-sidebar-root] [class*="regionArea"]'
/** Collapsed sidebar: the expand toggle sits in this frame seat at the top-left of the content (ui-layout AppFrame). */
const LEADING_SEAT_SELECTOR = '[class*="leadingSeat"]'
const rectOf = (element: Element): StudioBounds => {
  const rect = element.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

const studioBridge = (): StudioBridge | undefined => (globalThis as { ipzskStudio?: StudioBridge }).ipzskStudio

export function StudioHost({ controller }: { controller: ImageGenController }) {
  const open = useSyncExternalStore(fn => controller.subscribe(fn), () => controller.getSnapshot().panelOpen)
  const viewport = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const bridge = studioBridge()

  // The studio has its own layout; the side-by-side chat column stays collapsed.
  useEffect(() => {
    document.documentElement.dataset.dshImagegenChatCollapsed = '1'
    return () => { delete document.documentElement.dataset.dshImagegenChatCollapsed }
  }, [])

  useEffect(() => {
    const element = viewport.current
    if (!open || !bridge || !element) return
    let closed = false
    const region = document.querySelector(SIDEBAR_REGION_SELECTOR)
    const layout = (): StudioLayout => {
      // A collapsed sidebar is a narrow icon rail: no room for the studio sidebar.
      const nav = region?.isConnected ? rectOf(region) : null
      if (nav && nav.width >= 160) return { main: rectOf(element), nav }
      // Native views paint over the page, so keep the seat (sidebar expand toggle) row clear, like a title bar.
      const main = rectOf(element)
      const seat = document.querySelector(LEADING_SEAT_SELECTOR)?.getBoundingClientRect()
      const top = seat && seat.height > 0 ? seat.bottom + 8 : main.y
      return { main: top > main.y ? { ...main, y: top, height: Math.max(0, main.y + main.height - top) } : main, nav: null }
    }
    const fail = () => { if (!closed) setFailed(true) }
    setFailed(false)
    void bridge.open(layout()).catch(fail)
    const sync = () => { void bridge.setBounds(layout()).catch(fail) }
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    if (region) observer.observe(region)
    window.addEventListener('resize', sync)
    return () => {
      closed = true
      observer.disconnect()
      window.removeEventListener('resize', sync)
      // Window teardown may remove the IPC receiver before React unmounts.
      void bridge.close().catch(() => undefined)
    }
  }, [open, bridge])

  const message = !bridge ? '请在 IPZSK Desktop 中使用创作工作台。' : failed ? '创作工作台打开失败，请检查网络或重新登录后重试。' : undefined
  return (
    <div ref={viewport} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      {message && <p style={{ color: 'var(--dsw-alias-text-l2)', fontSize: 13 }}>{message}</p>}
    </div>
  )
}
