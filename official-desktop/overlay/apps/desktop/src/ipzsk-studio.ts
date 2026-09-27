/**
 * The IPZSK web studio as two native views, signed in with the desktop session: the main pane over the
 * image panel and the studio sidebar (`?pane=nav`) over the desktop sidebar. The site keeps them in step.
 */
import { WebContentsView, session, shell, type BrowserWindow, type Session } from 'electron'
import { IPZSK_ORIGIN } from './ipzsk-auth.ts'
import { platformBounds, type PlatformBounds } from './platform-view.ts'

export { IPZSK_STUDIO_IPC } from './ipzsk-studio-ipc.ts'
// IPZSK_STUDIO_URL points the views at a local site dev server (e.g. http://localhost:5174/studio).
export const IPZSK_STUDIO_URL = process.env.IPZSK_STUDIO_URL || 'https://ipzsk.com/studio'
/** Appended to the views' user agent; the site switches to its desktop layout on it. */
export const IPZSK_DESKTOP_UA = 'IPZSK-Desktop'
const SITE_ORIGIN = new URL(IPZSK_STUDIO_URL).origin
// In-memory partition: the injected session cookie is never written to disk by these views.
const PARTITION = 'ipzsk-studio'

/** Main pane rectangle, and the sidebar one (null while the desktop sidebar is collapsed). */
export interface IpzskStudioLayout { main: PlatformBounds; nav: PlatformBounds | null }

export function studioLayout(value: unknown): IpzskStudioLayout {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid studio layout')
  const { main, nav } = value as Record<string, unknown>
  return { main: platformBounds(main), nav: nav === null ? null : platformBounds(nav) }
}

/** One studio per window; hiding keeps its state, a new session or owner reloads it. */
export class IpzskStudioView {
  private views: { main: WebContentsView; nav: WebContentsView } | undefined
  private owner: BrowserWindow | undefined
  private cookie = ''

  async open(owner: BrowserWindow, layout: IpzskStudioLayout, cookie: string): Promise<void> {
    if (this.views && (this.owner !== owner || this.cookie !== cookie)) await this.dispose()
    if (!this.views) await this.create(owner, cookie)
    this.setBounds(layout)
  }

  setBounds(layout: IpzskStudioLayout): void {
    if (!this.views) return
    this.views.main.setBounds(layout.main)
    this.views.main.setVisible(true)
    if (layout.nav) this.views.nav.setBounds(layout.nav)
    this.views.nav.setVisible(layout.nav !== null)
  }

  close(): void {
    this.views?.main.setVisible(false)
    this.views?.nav.setVisible(false)
  }

  async dispose(): Promise<void> {
    const views = this.views
    const owner = this.owner
    this.views = undefined
    this.owner = undefined
    this.cookie = ''
    for (const view of views ? [views.main, views.nav] : []) {
      if (owner && !owner.isDestroyed()) owner.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    await session.fromPartition(PARTITION).clearStorageData()
  }

  private async create(owner: BrowserWindow, cookie: string): Promise<void> {
    const browserSession = session.fromPartition(PARTITION)
    await setSessionCookie(browserSession, IPZSK_ORIGIN, cookie)
    // A dev server proxies /api on its own origin, so it needs the cookie there too.
    if (SITE_ORIGIN !== 'https://ipzsk.com') await setSessionCookie(browserSession, SITE_ORIGIN, cookie)
    const nav = new URL(IPZSK_STUDIO_URL)
    nav.searchParams.set('pane', 'nav')
    this.views = { main: this.view(owner, browserSession, IPZSK_STUDIO_URL), nav: this.view(owner, browserSession, nav.href) }
    // Transparent, so the desktop sidebar's own material shows through the nav pane.
    this.views.nav.setBackgroundColor('#00000000')
    this.owner = owner
    this.cookie = cookie
    owner.once('closed', () => { if (this.owner === owner) void this.dispose() })
  }

  private view(owner: BrowserWindow, browserSession: Session, url: string): WebContentsView {
    const view = new WebContentsView({ webPreferences: {
      session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
    } })
    // Other pages (payment, docs) open in the system browser, without the embedded session.
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      if (target.startsWith('https://')) void shell.openExternal(target).catch(() => undefined)
      return { action: 'deny' }
    })
    const guard = (event: { preventDefault(): void }, target: string): void => {
      try { if (new URL(target).origin === SITE_ORIGIN) return } catch { /* invalid URL: block */ }
      event.preventDefault()
      if (target.startsWith('https://')) void shell.openExternal(target).catch(() => undefined)
    }
    view.webContents.on('will-navigate', guard)
    view.webContents.on('will-redirect', guard)
    view.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
    view.webContents.setUserAgent(`${view.webContents.getUserAgent()} ${IPZSK_DESKTOP_UA}`)
    view.setVisible(false)
    owner.contentView.addChildView(view)
    void view.webContents.loadURL(url).catch(() => undefined)
    return view
  }
}

/** Put the desktop login cookie (`name=value`) in the studio partition for one origin. */
async function setSessionCookie(target: Session, url: string, cookie: string): Promise<void> {
  const split = cookie.indexOf('=')
  if (split < 1) throw new Error('登录已失效，请重新登录 IPZSK。')
  await target.cookies.set({
    url, name: cookie.slice(0, split), value: cookie.slice(split + 1),
    secure: true, httpOnly: true, sameSite: 'lax',
  })
}
