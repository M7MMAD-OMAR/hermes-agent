/**
 * PIN ENGINE — annotation mode, inside the guest page.
 *
 * Parked on a window global and driven by verbs over `executeJavaScript`, the
 * same channel `preview-tour.ts` and `preview-act.ts` use. It has to live in the
 * page rather than float over the pane because a pin follows its element
 * through scrolls and reflows, and only the page knows where its elements are.
 *
 * The overlay is built inside a shadow root so page CSS cannot restyle it and
 * page selectors cannot find it — a stray `* { display: none }` in the app
 * being reviewed should not be able to hide the review tools.
 *
 * SELF-CONTAINMENT. `pinEngineSource` stringifies the factories below into one
 * expression. Module scope does not exist in the guest page, so `pinEngineCore`
 * receives its dependencies as arguments rather than importing them, and every
 * helper it uses is declared inside its own body. See `preview-act/naming.ts`
 * for the full contract and the failure mode.
 */

import { anchorKit, type AnchorKit } from './anchor'

/** Verbs the app can send. `state` is the read side; the rest mutate. */
export type PinVerb =
  | 'arm'
  | 'disarm'
  | 'hide'
  | 'show'
  | 'state'
  | 'reattach'
  | 'comment'
  | 'resolve'
  | 'remove'
  | 'clear'
  | 'take'
  | 'deliver'
  | 'aim'
  | 'shoot'

export interface PinCommand {
  comment?: string
  /** For `shoot`: the captured crop, as a data URL. */
  data?: string
  /** For `deliver`: did it reach the chat (true) or fail to (false)? */
  delivered?: boolean
  id?: string
  /** For `deliver` in batch — every pin the panel delivered in one act, so a
   *  Send-all costs one round trip instead of one per comment. */
  ids?: string[]
  verb: PinVerb
}

/**
 * The engine body.
 *
 * `holder` is the window object the engine and its pins live on, so state
 * survives between calls; `kit` is the stringified anchor factory, already
 * built against this document.
 */
export function pinEngineCore(doc: Document, holder: Record<string, unknown>, command: PinCommand, kit: AnchorKit) {
  const STATE_KEY = '__hermesPinState'
  const now = () => Date.now()

  // Declared in here, not at module scope: this body is stringified into the
  // guest page, where a reference to anything outside it is a ReferenceError
  // reported only as "Script failed to execute".
  //
  // Longest edge of an attached image and of its thumbnail. A UI screenshot is
  // legible far below its native size and the model reads it just as well.
  const SHOT_MAX_EDGE = 1400
  const THUMB_MAX_EDGE = 96
  /** Enough for a before, an after and a reference. More in one comment is a
   *  sign it wanted to be two comments. */
  const MAX_SHOTS = 4

  const state = (holder[STATE_KEY] as Record<string, unknown> | undefined) ?? {
    armed: false,
    bubbleOpen: false,
    deliver: [],
    drag: null,
    hidden: false,
    pending: [],
    pins: [],
    rev: 0,
    seq: 0,
    shotData: {}
  }

  holder[STATE_KEY] = state

  // A seeded state predates these fields. Nothing else re-checks them, so this
  // is the one place they are guaranteed to exist.
  if (!state.shotData) {
    state.shotData = {}
  }

  if (!state.pending) {
    state.pending = []
  }

  if (!state.deliver) {
    state.deliver = []
  }

  if (typeof state.rev !== 'number') {
    state.rev = 0
  }

  /** Every mutation the panel could care about bumps this. The panel compares
   *  it across polls so an idle page costs no re-render, no book merge and no
   *  localStorage write — with several review windows open at once, that idle
   *  saving is most of the feature's footprint. */
  const bump = () => {
    state.rev = (state.rev as number) + 1
  }

  const pins = state.pins as Record<string, unknown>[]
  const shotData = state.shotData as Record<string, string>
  const pending = state.pending as string[]
  /** Delivery requests the bubble queued for the panel (see PinDeliverRequest). */
  const deliver = state.deliver as { id: string; mode: 'now' | 'queue' }[]

  /** The bubble asks the panel to send this comment — now, or as queue. */
  const requestDeliver = (id: string, mode: 'now' | 'queue') => {
    if (!deliver.some(entry => entry.id === id && entry.mode === mode)) {
      deliver.push({ id, mode })
      bump()
    }
  }

  // ---- overlay -----------------------------------------------------------

  const HOST_ID = 'hermes-pin-host'

  const host = () => {
    let node = doc.getElementById(HOST_ID) as HTMLElement | null

    if (node && node.shadowRoot) {
      return node
    }

    node = doc.createElement('div')
    node.id = HOST_ID
    // Fixed and non-interactive by default: the overlay must not eat clicks
    // when annotation mode is off, or the page becomes unusable the moment the
    // engine has been injected once.
    node.setAttribute('style', 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;')
    const root = node.attachShadow({ mode: 'open' })
    const style = doc.createElement('style')
    style.textContent = [
      '.hl{position:fixed;border:2px solid #d99a5b;background:rgba(217,154,91,.14);',
      'border-radius:3px;pointer-events:none;transition:all .04s linear}',
      '.pin{position:fixed;width:22px;height:22px;border-radius:50% 50% 50% 2px;',
      'background:#d99a5b;color:#1c1b19;font:600 12px/22px system-ui;text-align:center;',
      'pointer-events:auto;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.4);transform:translate(-4px,-26px)}',
      '.pin.resolved{background:#7fc08e}',
      '.pin.delivered{background:#5b9dd9;color:#f2f6fa}',
      '.pin.orphan{background:#8a8a8a}',
      '.box{position:fixed;border:2px dashed #d99a5b;background:rgba(217,154,91,.1);pointer-events:none}',
      // The bubble sizes itself to the page it is floating over: comfortable on
      // a desktop layout, still inside the margins on a 320px phone viewport.
      '.bubble{position:fixed;width:min(304px,calc(100vw - 24px));background:#1c1b19;',
      'color:#eae7e1;border:1px solid #35322e;border-radius:12px;padding:10px;',
      'pointer-events:auto;box-shadow:0 10px 34px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.04) inset;',
      'font:13px/1.5 system-ui,sans-serif;box-sizing:border-box}',
      '.bubble *{box-sizing:border-box}',
      // Head: the pin's own number and what it is fastened to, so an open
      // bubble is never ambiguous about which marker it belongs to.
      // Head: the pin's number and a way out. No target label — it rendered
      // the clicked element's own text, truncated mid-phrase, telling the
      // user nothing the marker they just placed does not already say.
      '.head{display:flex;align-items:center;margin:0 0 8px}',
      '.head b{display:inline-flex;align-items:center;justify-content:center;min-width:20px;',
      'height:20px;padding:0 5px;border-radius:6px;background:rgba(217,154,91,.16);',
      'color:#d99a5b;font:700 11px system-ui}',
      '.head .shut{margin-inline-start:auto;width:24px;height:24px;padding:4px}',
      '.bubble textarea{display:block;width:100%;min-height:56px;max-height:168px;',
      'background:#131211;color:#f0ede8;border:1px solid #35322e;border-radius:8px;',
      // No resize grip: it drew a corner wart and the field grows on its own.
      'padding:8px;font:13px/1.5 system-ui,sans-serif;resize:none;outline:none;',
      // The guest page's own scrollbar is whatever Chromium gives that site —
      // on a plain page that is the chunky legacy bar WITH stepper arrows, and
      // it lands inside a 304px bubble looking like a piece of another app.
      // Styled here rather than left alone: the field is ours, so its scrollbar
      // has to be too. Deliberately NOT the standard `scrollbar-width`/
      // `scrollbar-color`: setting either makes Chromium ignore every
      // ::-webkit-scrollbar rule below and draw its own thin bar instead — the
      // gutter measured 10px with both present, and the thumb colour and the
      // dropped stepper arrows went with it. The preview guest is always
      // Chromium, so the pseudo-elements alone are the honest mechanism.
      'padding-inline-end:2px}',
      '.bubble textarea::placeholder{color:#6f6a63}',
      // Half the gutter is transparent border, so the thumb reads as a 4px
      // hairline with breathing room instead of a bar wedged against the text.
      '.bubble textarea::-webkit-scrollbar{width:8px;height:8px}',
      '.bubble textarea::-webkit-scrollbar-track{background:transparent}',
      '.bubble textarea::-webkit-scrollbar-thumb{background:#3b3833;border-radius:8px;',
      'border:2px solid transparent;background-clip:content-box}',
      '.bubble textarea:hover::-webkit-scrollbar-thumb{background:#565149;background-clip:content-box}',
      // The stepper arrows are the loudest part of the legacy bar and nobody
      // clicks them in a 168px-tall field.
      '.bubble textarea::-webkit-scrollbar-button{display:none;width:0;height:0}',
      '.bubble textarea::-webkit-scrollbar-corner{background:transparent}',
      '.bubble textarea:focus{border-color:#d99a5b;box-shadow:0 0 0 3px rgba(217,154,91,.16)}',
      '.row{display:flex;align-items:center;gap:6px;margin-top:9px}',
      // Attach/delete sit left, deliver sits right: the two committing
      // actions are together, away from the destructive one.
      '.gap{flex:1 1 auto}',
      '.bubble button{border:1px solid #35322e;border-radius:8px;background:#26241f;',
      'color:#eae7e1;font:600 12px system-ui,sans-serif;cursor:pointer;padding:6px 12px;',
      'display:inline-flex;align-items:center;justify-content:center;gap:5px;transition:background .12s}',
      '.bubble button:hover{background:#312e28}',
      '.bubble button:focus-visible{outline:2px solid #d99a5b;outline-offset:1px}',
      // Every footer action is an icon. Weight carries the meaning instead of
      // words: send is filled, queue is tonal, attach/delete are ghosts.
      '.bubble button.icon{padding:6px;width:30px;height:30px;background:transparent;border-color:transparent;color:#a09a91}',
      '.bubble button.icon:hover{background:#26241f;color:#eae7e1}',
      '.bubble button.icon.danger:hover{background:#3a2020;color:#ef9a9a}',
      '.bubble button.icon.tonal{background:rgba(217,154,91,.14);border-color:transparent;color:#d99a5b}',
      '.bubble button.icon.tonal:hover{background:rgba(217,154,91,.24)}',
      '.bubble button.icon.go{background:#d99a5b;border-color:#d99a5b;color:#1c1b19}',
      '.bubble button.icon.go:hover{background:#e4a869}',
      '.bubble button:active{transform:scale(.96)}',
      '.bubble svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;',
      'stroke-linecap:round;stroke-linejoin:round}',
      '.strip{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.strip figure{position:relative;margin:0;width:52px;height:40px;border-radius:7px;',
      'overflow:hidden;border:1px solid #35322e;background:#0e0d0c}',
      '.strip img{width:100%;height:100%;object-fit:cover;display:block}',
      '.strip span{position:absolute;top:2px;inset-inline-end:2px;width:16px;height:16px;',
      'line-height:15px;text-align:center;border-radius:50%;background:rgba(12,11,10,.82);',
      'color:#fff;font:700 11px system-ui;cursor:pointer;opacity:0;transition:opacity .12s}',
      '.strip figure:hover span{opacity:1}',
      '@keyframes hermes-pin-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}',
      '@keyframes hermes-pin-full{0%,100%{transform:none}30%{transform:translateX(-3px)}70%{transform:translateX(3px)}}',
      '.bubble{animation:hermes-pin-in .15s ease-out}',
      '.strip.full{animation:hermes-pin-full .18s ease-in-out}',
      '@media (prefers-reduced-motion:reduce){',
      '.bubble{animation-name:none}.strip.full{animation:none}',
      '.bubble button:active{transform:none}}',
      '.bubble.over{border-color:#d99a5b;box-shadow:0 0 0 3px rgba(217,154,91,.2)}',
      // A marker whose comment carries an image says so, so the strip is not a
      // surprise waiting inside a bubble nobody reopens.
      '.pin.shot::after{content:"";position:absolute;right:-2px;bottom:-2px;width:7px;',
      'height:7px;border-radius:50%;background:#eae7e1;box-shadow:0 0 0 1.5px #1c1b19}'
    ].join('')
    root.append(style)
    doc.body.append(node)

    return node
  }

  const shadow = () => host().shadowRoot as ShadowRoot

  const clearLayer = (selector: string) => {
    for (const node of Array.from(shadow().querySelectorAll(selector))) {
      node.remove()
    }
  }

  const fractionToBox = (rect: { h: number; w: number; x: number; y: number }) => {
    const view = doc.defaultView
    const width = Math.max(1, doc.documentElement.scrollWidth)
    const height = Math.max(1, doc.documentElement.scrollHeight)

    return {
      height: rect.h * height,
      left: rect.x * width - (view ? view.scrollX : 0),
      top: rect.y * height - (view ? view.scrollY : 0),
      width: rect.w * width
    }
  }

  /**
   * Where a pin sits in the viewport right now, or null if it sits nowhere.
   *
   * Shared by the marker paint and by `aim`, so the crop the user gets back
   * frames exactly the box their marker is sitting on. Two independent
   * answers here would show up as a screenshot that misses the thing it is
   * supposed to be a screenshot of.
   */
  const boxOf = (pin: Record<string, unknown>): null | { height: number; left: number; top: number; width: number } => {
    if (pin.kind === 'element' && pin.anchor) {
      const match = kit.resolve(pin.anchor as never)

      if (!match.element) {
        return null
      }

      const live = match.element.getBoundingClientRect()

      return { height: live.height, left: live.left, top: live.top, width: live.width }
    }

    return pin.region ? fractionToBox(pin.region as never) : null
  }

  /** Redraw every pin marker where its element currently is. */
  const paint = () => {
    clearLayer('.pin')

    // Hidden means hidden. The user closed the panel to get their page back,
    // and leaving markers floating over it is the same complaint again.
    if (state.hidden) {
      return
    }

    const root = shadow()
    pins.forEach((pin, index) => {
      const marker = doc.createElement('div')
      const shots = (pin.shots as unknown[] | undefined) ?? []
      marker.className =
        'pin' +
        (pin.resolved ? ' resolved' : '') +
        // Delivered outranks resolved in the paint: the user already knows it
        // arrived, so "sent" is the state the marker should describe.
        (pin.delivered ? ' delivered' : '') +
        (pin.orphaned ? ' orphan' : '') +
        (shots.length ? ' shot' : '')
      marker.textContent = pin.delivered ? '✓' + String(index + 1) : String(index + 1)
      marker.dataset.pin = String(pin.id)

      const box = boxOf(pin)

      if (!box) {
        // An orphan has nowhere to sit. Keeping it off-screen rather than at
        // 0,0 avoids a pile of grey markers in the corner that look like a bug.
        return
      }

      marker.style.left = box.left + 'px'
      marker.style.top = box.top + 'px'
      root.append(marker)
    })
  }

  /** A bubble is showing: reported so the panel's poll tightens while the
   *  user is mid-comment, and its shortcuts do not sit on a 700 ms wait. */
  const closeBubble = () => {
    if (state.bubbleOpen) {
      state.bubbleOpen = false
      bump()
    }

    clearLayer('.bubble')
  }

  /**
   * Shrink an image and hand back a data URL.
   *
   * Two passes per attachment: one bounded copy that goes to the model, one
   * thumbnail small enough to ride in every state report and every navigation
   * seed without being felt. A pasted retina screenshot is several megabytes
   * and none of them buy the model anything.
   */
  const shrink = (
    source: string,
    edge: number,
    quality: number,
    done: (data: null | string, w: number, h: number) => void
  ) => {
    const image = new Image()

    image.onload = () => {
      const scale = Math.min(1, edge / Math.max(1, Math.max(image.width, image.height)))
      const w = Math.max(1, Math.round(image.width * scale))
      const h = Math.max(1, Math.round(image.height * scale))
      const canvas = doc.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')

      // No 2D context means no canvas at all (jsdom, a locked-down page). The
      // original is worse but correct; refusing the paste would be worse still.
      if (!ctx) {
        done(source, image.width || w, image.height || h)

        return
      }

      ctx.drawImage(image, 0, 0, w, h)

      try {
        done(canvas.toDataURL('image/jpeg', quality), w, h)
      } catch {
        done(source, w, h)
      }
    }

    image.onerror = () => done(null, 0, 0)
    image.src = source
  }

  /**
   * Where to open a comment, given where the user clicked and what they clicked.
   *
   * `avoid` is the pinned element's box. Opening on top of the thing being
   * commented on is the one placement that is always wrong — you cannot look at
   * the problem while you describe it — so the bubble goes under it when there
   * is room and above it when there is not, falling back to the cursor for
   * region pins, which have no element to dodge.
   */
  const openBubble = (
    pinId: string,
    left: number,
    top: number,
    avoid?: { bottom: number; left: number; top: number } | null
  ) => {
    closeBubble()
    const pin = pins.find(entry => entry.id === pinId)

    if (!pin) {
      return
    }

    const view = doc.defaultView
    const bubble = doc.createElement('div')
    bubble.className = 'bubble'

    /**
     * Put the bubble where it fits.
     *
     * Measured after every change rather than clamped against a guessed size:
     * the bubble grows when an image is added, and a hardcoded height puts it
     * half off the bottom of the window the moment it does.
     */
    const place = () => {
      const box = bubble.getBoundingClientRect()
      const vw = view ? view.innerWidth : 800
      const vh = view ? view.innerHeight : 600
      const width = box.width || 250
      const height = box.height || 140
      let x = left
      let y = top

      if (avoid) {
        x = avoid.left
        y = avoid.bottom + 10

        // No room underneath: sit above it instead of hanging off the fold.
        if (y + height + 8 > vh) {
          y = avoid.top - height - 10
        }
      }

      bubble.style.left = Math.max(8, Math.min(x, vw - width - 8)) + 'px'
      bubble.style.top = Math.max(8, Math.min(y, vh - height - 8)) + 'px'
    }

    /** A stroke icon, drawn rather than imported — the guest page has no icon
     *  font and no way to reach the app's. */
    const icon = (path: string) => {
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      const shape = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
      shape.setAttribute('d', path)
      svg.append(shape)

      return svg
    }

    const head = doc.createElement('div')
    head.className = 'head'
    const badge = doc.createElement('b')
    badge.textContent = String(pins.indexOf(pin) + 1)
    // No target label. It rendered the clicked element's own text, which on a
    // heading like "Commitment Trust Innovation Expertise Continual…" is a
    // truncated fragment that tells the user nothing they cannot see by
    // looking at the marker they just placed.
    const shut = doc.createElement('button')
    shut.className = 'icon shut'
    shut.title = 'Close'
    shut.setAttribute('aria-label', 'Close')
    shut.append(icon('M6 6l12 12M18 6L6 18'))
    head.append(badge, shut)

    const area = doc.createElement('textarea')
    area.value = String(pin.comment || '')
    // The comment is the user's own language, and this app is used in Arabic.
    // `auto` aligns and places the caret per what they actually type instead of
    // forcing every comment to read left-to-right.
    area.setAttribute('dir', 'auto')

    /** Grow with the text, up to the CSS cap, then scroll. */
    const grow = () => {
      area.style.height = 'auto'
      area.style.height = Math.min(168, Math.max(56, area.scrollHeight)) + 'px'
    }

    const strip = doc.createElement('div')
    strip.className = 'strip'

    const shotsOf = () => (pin.shots as Record<string, unknown>[] | undefined) ?? []

    const drawStrip = () => {
      strip.textContent = ''

      for (const shot of shotsOf()) {
        const figure = doc.createElement('figure')
        const thumb = doc.createElement('img')
        thumb.src = String(shot.thumb || '')
        const drop = doc.createElement('span')
        drop.textContent = '×'
        drop.title = 'Remove image'
        drop.addEventListener('click', event => {
          event.stopPropagation()
          const list = shotsOf().filter(entry => entry.id !== shot.id)
          pin.shots = list
          delete shotData[String(shot.id)]
          bump()
          drawStrip()
          paint()
        })
        figure.append(thumb, drop)
        strip.append(figure)
      }

      place()
    }

    /** Take a File list from a paste, a drop or the picker. */
    const ingest = (files: ArrayLike<File> | null) => {
      if (!files) {
        return
      }

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]

        if (!file || !String(file.type || '').startsWith('image/')) {
          continue
        }

        if (shotsOf().length >= MAX_SHOTS) {
          // Wordless: the strip pulses instead of a sentence appearing under
          // the comment. The attach button is disabled at the cap too, so
          // this only fires for a paste or a drop, which cannot be disabled.
          strip.classList.remove('full')
          void strip.offsetWidth
          strip.classList.add('full')

          break
        }

        const reader = new FileReader()

        reader.onload = () => {
          const source = String(reader.result || '')

          if (!source) {
            return
          }

          shrink(source, SHOT_MAX_EDGE, 0.85, (full, w, h) => {
            if (!full) {
              return
            }

            shrink(full, THUMB_MAX_EDGE, 0.5, thumb => {
              const id = 'shot-' + now().toString(36) + '-' + Math.round(Math.random() * 1e6).toString(36)
              // The bytes stay here only until the app drains them; the pin
              // itself never carries more than the thumbnail.
              shotData[id] = full
              pending.push(id)
              pin.shots = shotsOf().concat([{ h, id, thumb: thumb || full, w }])
              bump()
              drawStrip()
              paint()
            })
          })
        }

        reader.readAsDataURL(file)
      }
    }

    const picker = doc.createElement('input')
    picker.type = 'file'
    picker.accept = 'image/*'
    picker.multiple = true
    picker.style.display = 'none'
    picker.addEventListener('change', () => {
      ingest(picker.files)
      picker.value = ''
    })

    const row = doc.createElement('div')
    row.className = 'row'
    const add = doc.createElement('button')
    add.className = 'icon'
    add.title = 'Attach image'
    add.append(icon('M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6'))
    const remove = doc.createElement('button')
    remove.className = 'icon danger'
    remove.title = 'Delete'
    remove.append(icon('M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13'))
    /** Park it in the conversation's queue — drains after the current turn. */
    const enqueue = doc.createElement('button')
    enqueue.className = 'icon tonal'
    enqueue.title = 'Queue · Ctrl+Shift+Enter'
    enqueue.setAttribute('aria-label', 'Queue')
    enqueue.append(icon('M4 7h11M4 12h11M4 17h7M17 14v6M14 17h6'))
    /** Send straight to the chat — the panel delivers and marks it done.
     *  The one primary control: delivering is what the bubble is FOR, and the
     *  loudest button used to be `Done`, which delivered nothing. */
    const send = doc.createElement('button')
    send.className = 'icon go'
    send.title = 'Send · Ctrl+Enter'
    send.setAttribute('aria-label', 'Send')
    send.append(icon('M4 12l16-8-6 8 6 8z'))

    add.addEventListener('click', event => {
      event.stopPropagation()
      picker.click()
    })
    shut.addEventListener('click', event => {
      event.stopPropagation()
      // Nothing to save here: `input` above has already written every
      // keystroke into the pin. Closing is closing.
      closeBubble()
      paint()
    })
    // Sending and queueing are COMMITTING acts: the bubble closes the moment
    // the request is written, the same way Done closes it. The panel picks the
    // request up on its next read and reports success or failure in a toast —
    // an open bubble with no comment left in it after a Send read as "did that
    // even go?" and made the comment look still-active until it was deleted
    // by hand, which is exactly what delivery is supposed to replace.
    const requestAndClose = (mode: 'now' | 'queue') => {
      pin.comment = area.value
      requestDeliver(String(pinId), mode)
      closeBubble()
      paint()
    }

    send.addEventListener('click', event => {
      event.stopPropagation()
      requestAndClose('now')
    })
    enqueue.addEventListener('click', event => {
      event.stopPropagation()
      requestAndClose('queue')
    })
    remove.addEventListener('click', event => {
      event.stopPropagation()
      const index = pins.findIndex(entry => entry.id === pinId)

      if (index !== -1) {
        for (const shot of shotsOf()) {
          delete shotData[String(shot.id)]
        }

        pins.splice(index, 1)
      }

      closeBubble()
      paint()
    })

    // Keep the comment as it is typed. Losing a paragraph to an Escape pressed
    // out of habit is not a trade worth making for a tidier save path.
    area.addEventListener('input', () => {
      pin.comment = area.value
      bump()
      grow()
      place()
    })

    // Typing in the page must not reach the page. A review comment containing
    // "d" should not trigger the app's own keyboard shortcut for it.
    for (const type of ['keydown', 'keyup', 'keypress', 'paste']) {
      area.addEventListener(type, event => event.stopPropagation())
    }

    area.addEventListener('keydown', event => {
      // `event.code` (physical key), not `event.key`: on the Arabic m17n
      // layout Enter is still Enter, but every other letter is not — and the
      // user's standing rule is that shortcuts must work on both layouts.
      const enter = event.code === 'Enter' || event.key === 'Enter'

      if ((event.metaKey || event.ctrlKey) && enter && event.shiftKey) {
        // Queue it: the conversation is busy or the user wants ordering.
        event.preventDefault()
        requestAndClose('queue')
      } else if ((event.metaKey || event.ctrlKey) && enter) {
        // Send now: the panel delivers it and closes the bubble.
        event.preventDefault()
        requestAndClose('now')
      } else if (event.key === 'Enter' && !event.shiftKey) {
        // Plain Enter has ALWAYS closed the bubble (the save above); keep it.
        event.preventDefault()
        pin.comment = area.value
        closeBubble()
        paint()
      }
    })

    area.addEventListener('paste', event => {
      const data = (event as ClipboardEvent).clipboardData
      const files = data ? data.files : null

      if (!files || !files.length) {
        return
      }

      // Otherwise the filename lands in the textarea as text next to the image.
      event.preventDefault()
      ingest(files)
    })

    bubble.addEventListener('dragover', event => {
      event.preventDefault()
      event.stopPropagation()
      bubble.classList.add('over')
    })
    bubble.addEventListener('dragleave', () => bubble.classList.remove('over'))
    bubble.addEventListener('drop', event => {
      event.preventDefault()
      event.stopPropagation()
      bubble.classList.remove('over')
      const data = (event as DragEvent).dataTransfer
      ingest(data ? data.files : null)
    })

    // Quiet actions first, the committing one pushed to the end by CSS: the
    // eye lands on Done, and Delete is never a neighbour of it.
    const gap = doc.createElement('span')
    gap.className = 'gap'
    row.append(add, remove, gap, enqueue, send)
    bubble.append(head, area, strip, row, picker)
    shadow().append(bubble)
    state.bubbleOpen = true
    bump()
    grow()
    drawStrip()
    area.focus()
    // Put the caret after the existing text rather than selecting all of it,
    // so reopening a comment to add a sentence does not risk wiping it.
    area.setSelectionRange(area.value.length, area.value.length)
  }

  // ---- annotation mode ---------------------------------------------------

  /**
   * Is this gesture ours?
   *
   * Everything the overlay draws lives in the shadow root, so a click on the
   * comment bubble's Save button arrives at the document listeners first. The
   * swallowers below must let it through or the bubble's own controls stop
   * working the moment annotation mode is on.
   */
  const insideOverlay = (event: Event) => {
    const node = doc.getElementById(HOST_ID)

    if (!node) {
      return false
    }

    const path = typeof event.composedPath === 'function' ? event.composedPath() : []

    for (const step of path) {
      if (step === node) {
        return true
      }
    }

    return false
  }

  const targetAt = (x: number, y: number): Element | null => {
    // The host is pointer-events:none at the root, but a marker inside it is
    // not, so ask the page what is under the cursor with the host discounted.
    const found = doc.elementFromPoint(x, y)

    if (!found || found.id === HOST_ID) {
      return null
    }

    return found
  }

  /**
   * Stop the page acting on a gesture that was meant for us.
   *
   * `preventDefault` on mouseup does NOT cancel the click the browser
   * synthesises afterwards, so commenting on a link still followed it. This is
   * the listener that actually holds the page still; the mouseup one only
   * suppresses the default action of the press itself.
   */
  const onClick = (event: MouseEvent) => {
    if (!state.armed || insideOverlay(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
  }

  const onMove = (event: MouseEvent) => {
    if (!state.armed) {
      return
    }

    if (state.drag) {
      const drag = state.drag as { x0: number; y0: number }
      clearLayer('.box')
      const box = doc.createElement('div')
      box.className = 'box'
      box.style.left = Math.min(drag.x0, event.clientX) + 'px'
      box.style.top = Math.min(drag.y0, event.clientY) + 'px'
      box.style.width = Math.abs(event.clientX - drag.x0) + 'px'
      box.style.height = Math.abs(event.clientY - drag.y0) + 'px'
      shadow().append(box)

      return
    }

    clearLayer('.hl')
    const el = targetAt(event.clientX, event.clientY)

    if (!el) {
      return
    }

    const rect = el.getBoundingClientRect()
    const highlight = doc.createElement('div')
    highlight.className = 'hl'
    highlight.style.left = rect.left + 'px'
    highlight.style.top = rect.top + 'px'
    highlight.style.width = rect.width + 'px'
    highlight.style.height = rect.height + 'px'
    shadow().append(highlight)
  }

  const onDown = (event: MouseEvent) => {
    if (!state.armed || insideOverlay(event)) {
      return
    }

    state.drag = { x0: event.clientX, y0: event.clientY }
  }

  const addPin = (entry: Record<string, unknown>) => {
    state.seq = (state.seq as number) + 1
    entry.id = 'pin-' + state.seq + '-' + now().toString(36)
    entry.createdAt = now()
    entry.resolved = false
    entry.pageUrl = doc.location ? doc.location.href : ''
    pins.push(entry)
    bump()

    return entry.id as string
  }

  const onUp = (event: MouseEvent) => {
    if (!state.armed || insideOverlay(event)) {
      return
    }

    let placedOver: { bottom: number; left: number; top: number } | null = null
    const drag = state.drag as { x0: number; y0: number } | null
    state.drag = null
    clearLayer('.box')

    if (!drag) {
      return
    }

    // Suppress the page's own click. Annotation mode is a review overlay, not a
    // way to accidentally submit the form you are commenting on.
    event.preventDefault()
    event.stopPropagation()

    const dx = Math.abs(event.clientX - drag.x0)
    const dy = Math.abs(event.clientY - drag.y0)
    const view = doc.defaultView
    const width = Math.max(1, doc.documentElement.scrollWidth)
    const height = Math.max(1, doc.documentElement.scrollHeight)

    let id: string

    if (dx > 6 || dy > 6) {
      // A drag: a region, for images, charts and canvases where no node means
      // what the user is pointing at.
      const left = Math.min(drag.x0, event.clientX) + (view ? view.scrollX : 0)
      const top = Math.min(drag.y0, event.clientY) + (view ? view.scrollY : 0)
      id = addPin({
        comment: '',
        kind: 'region',
        region: { h: dy / height, w: dx / width, x: left / width, y: top / height },
        target: Math.round(dx) + '×' + Math.round(dy) + ' region'
      })
    } else {
      const el = targetAt(event.clientX, event.clientY)

      if (!el) {
        return
      }

      const box = el.getBoundingClientRect()
      placedOver = { bottom: box.bottom, left: box.left, top: box.top }
      const anchor = kit.capture(el)
      id = addPin({
        anchor,
        comment: '',
        kind: 'element',
        matchedBy: 'placed',
        target: anchor.label || anchor.role
      })
    }

    clearLayer('.hl')
    paint()
    openBubble(id, event.clientX + 14, event.clientY + 14, placedOver)
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && state.armed) {
      if (shadow().querySelector('.bubble')) {
        closeBubble()
      } else {
        disarm()
      }
    }
  }

  const onPinClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    const id = target && target.dataset ? target.dataset.pin : null

    if (!id) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    // Reopening: find the element again so the comment dodges it just as it did
    // when it was placed.
    const pin = pins.find(entry => entry.id === id)
    const match = pin && pin.kind === 'element' && pin.anchor ? kit.resolve(pin.anchor as never) : null
    const box = match?.element ? match.element.getBoundingClientRect() : null
    openBubble(
      id,
      event.clientX + 14,
      event.clientY + 14,
      box ? { bottom: box.bottom, left: box.left, top: box.top } : null
    )
  }

  const onScroll = () => paint()

  const arm = () => {
    if (state.armed) {
      return
    }

    state.armed = true
    // Arming is a request to see what you are annotating.
    state.hidden = false
    host().setAttribute('style', 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;cursor:crosshair;')
    doc.documentElement.style.cursor = 'crosshair'
    // Capture phase, so the page cannot swallow the gesture before we see it.
    doc.addEventListener('mousemove', onMove, true)
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('mouseup', onUp, true)
    doc.addEventListener('click', onClick as EventListener, true)
    doc.addEventListener('keydown', onKey, true)
    const view = doc.defaultView

    if (view) {
      view.addEventListener('scroll', onScroll, true)
      view.addEventListener('resize', onScroll, true)
    }

    state.handlers = { onClick, onDown, onKey, onMove, onScroll, onUp }
    bump()
    paint()
  }

  const disarm = () => {
    if (!state.armed) {
      return
    }

    state.armed = false
    state.drag = null
    doc.documentElement.style.cursor = ''
    const handlers = state.handlers as Record<string, EventListener> | undefined

    if (handlers) {
      doc.removeEventListener('mousemove', handlers.onMove, true)
      doc.removeEventListener('mousedown', handlers.onDown, true)
      doc.removeEventListener('mouseup', handlers.onUp, true)
      doc.removeEventListener('click', handlers.onClick, true)
      doc.removeEventListener('keydown', handlers.onKey, true)
      const view = doc.defaultView

      if (view) {
        view.removeEventListener('scroll', handlers.onScroll, true)
        view.removeEventListener('resize', handlers.onScroll, true)
      }
    }

    clearLayer('.hl')
    clearLayer('.box')
    closeBubble()
    bump()
    paint()
  }

  /**
   * Put the page back the way the user found it, without losing anything.
   *
   * Closing the panel has to be a full retreat: disarmed, no markers, no
   * highlight, cursor back to normal. Anything less and the next click on a
   * link is swallowed by a review overlay the user believes they dismissed —
   * which is exactly the trap they hit.
   */
  const hide = () => {
    disarm()
    state.hidden = true
    clearLayer('.pin')
    closeBubble()
    bump()
  }

  const show = () => {
    state.hidden = false
    bump()
    paint()
  }

  /**
   * Re-run the ladder over every pin.
   *
   * Called after a navigation or reload. A pin whose element is gone is marked
   * orphaned and kept — the comment is the user's writing, and throwing it away
   * because a build changed the DOM would lose real work.
   */
  const reattach = () => {
    for (const pin of pins) {
      if (pin.kind !== 'element' || !pin.anchor) {
        continue
      }

      const match = kit.resolve(pin.anchor as never)
      pin.orphaned = !match.element
      pin.matchedBy = match.how

      if (match.element) {
        // Re-capture from the element we just found, so the anchor tracks the
        // page forward instead of decaying against the version it was placed on.
        pin.anchor = kit.capture(match.element)
      }
    }

    bump()
    paint()
  }

  // Markers stay clickable even when disarmed, so a comment can be reopened
  // without re-entering annotation mode. Bound once per page.
  if (!state.wired) {
    shadow().addEventListener('click', onPinClick as EventListener, true)
    state.wired = true
  }

  /** Full image bytes, for the one verb that asks for them. */
  let taken: null | string = null
  let aimed: null | { height: number; left: number; top: number; width: number } = null

  switch (command.verb) {
    case 'arm':
      arm()

      break

    case 'disarm':
      disarm()

      break

    case 'hide':
      hide()

      break

    case 'show':
      show()

      break

    case 'reattach':
      reattach()

      break
    case 'comment': {
      const pin = pins.find(entry => entry.id === command.id)

      if (pin) {
        pin.comment = String(command.comment ?? '')
        bump()
      }

      break
    }

    case 'resolve': {
      const pin = pins.find(entry => entry.id === command.id)

      if (pin) {
        pin.resolved = !pin.resolved
        bump()
      }

      paint()

      break
    }

    case 'remove': {
      const index = pins.findIndex(entry => entry.id === command.id)

      if (index !== -1) {
        for (const shot of (pins[index].shots as Record<string, unknown>[] | undefined) ?? []) {
          delete shotData[String(shot.id)]
        }

        pins.splice(index, 1)
        bump()
      }

      paint()

      break
    }

    case 'clear':
      pins.splice(0, pins.length)

      for (const key of Object.keys(shotData)) {
        delete shotData[key]
      }

      pending.splice(0, pending.length)
      closeBubble()
      bump()
      paint()

      break
    /**
     * Delivery is the END of a pin's life in the page: the comment left for
     * the chat (sent or queued), so the marker and the pending list must not
     * keep it around — that leftover was the "still active, delete it by
     * hand" report. A failed delivery (false) rolls the flag back instead, so
     * the comment stays pending. `ids` delivers a whole batch in one call.
     * No id and no ids: an ACK — the panel took the bubble's requests, so
     * drop them. Dropping BEFORE the panel acts would lose a request that
     * failed mid-flight; the panel acks first, then runs, and a request that
     * arrives again was re-queued by a bubble click, not a lost ack.
     */
    case 'deliver': {
      const ids = command.ids ?? (command.id !== undefined ? [command.id] : [])

      for (const id of ids) {
        const index = pins.findIndex(entry => entry.id === id)

        if (index === -1) {
          continue
        }

        if (command.delivered === false) {
          // Rollback: the send failed, the comment goes back to pending.
          pins[index].delivered = false
        } else {
          const shots = (pins[index].shots as Record<string, unknown>[] | undefined) ?? []

          for (const shot of shots) {
            const shotId = String(shot.id)
            delete shotData[shotId]
            const slot = pending.indexOf(shotId)

            if (slot !== -1) {
              pending.splice(slot, 1)
            }
          }

          pins.splice(index, 1)
        }
      }

      if (ids.length) {
        bump()
      }

      if (!command.id && !command.ids) {
        deliver.splice(0, deliver.length)
        bump()
      }

      paint()

      break
    }

    /**
     * Hand one image's bytes to the app and forget them here.
     *
     * The page is a bad place to keep megabytes: a navigation drops them, and
     * anything still here rides along in the next state report. The app takes
     * them the moment it hears about them and becomes the only owner.
     */
    case 'take': {
      const id = String(command.id ?? '')
      taken = shotData[id] ?? null
      delete shotData[id]
      const slot = pending.indexOf(id)

      if (slot !== -1) {
        pending.splice(slot, 1)
      }

      bump()

      break
    }

    /**
     * Line up a crop of one pin's target, and get out of the frame.
     *
     * The app owns the camera — only the host can reach Chromium's capture —
     * so the page's job is to say WHERE and to make sure nothing of ours is
     * in the shot. Hiding the whole overlay host, rather than the markers
     * one by one, is what guarantees that: the bubble, the layer and every
     * marker live inside it, so one `display:none` clears all of them and
     * there is no new element that can be forgotten here later.
     *
     * `shoot` is the other half and MUST run even if the capture failed, or
     * the page is left invisible-overlay. The host brackets it in a finally.
     */
    case 'aim': {
      const pin = pins.find(entry => entry.id === command.id)
      aimed = pin ? boxOf(pin) : null

      if (aimed) {
        host().style.display = 'none'
      }

      break
    }

    /**
     * Adopt a captured crop as the pin's own image and show the overlay again.
     *
     * The shrink is asynchronous (an Image has to decode first), so the shot
     * lands on a later poll rather than in this report. That is the same
     * path a pasted image takes, deliberately: one way for bytes to become a
     * shot means one place where the cap, the thumbnail and the pending list
     * can be got wrong.
     */
    case 'shoot': {
      host().style.display = ''
      const pin = pins.find(entry => entry.id === command.id)
      const source = String(command.data ?? '')

      if (pin && source) {
        shrink(source, SHOT_MAX_EDGE, 0.85, (full, w, h) => {
          if (!full) {
            return
          }

          shrink(full, THUMB_MAX_EDGE, 0.5, thumb => {
            const shotId = 'shot-' + now().toString(36) + '-' + Math.round(Math.random() * 1e6).toString(36)
            shotData[shotId] = full
            pending.push(shotId)
            const held = (pin.shots as Record<string, unknown>[] | undefined) ?? []
            pin.shots = held.concat([{ h, id: shotId, thumb: thumb || full, w }])
            bump()
            paint()
          })
        })
      }

      paint()

      break
    }

    case 'state':

    default:
      break
  }

  return {
    /** Viewport box the host should capture, in answer to `aim`. */
    aim: aimed,
    armed: state.armed === true,
    /** The comment bubble is on screen — the panel tightens its poll while
     *  this holds, so the bubble's shortcuts land within a beat. */
    bubbleOpen: state.bubbleOpen === true,
    // The bubble's delivery requests ride every report; the panel drains them
    // and asks the engine to clear them (a `deliver` with no id acks the lot).
    deliver: deliver.slice(),
    hidden: state.hidden === true,
    // Announced on EVERY report, not just while annotating. An image pasted
    // and then left alone — Escape, or the panel closed — still has to reach
    // the app before the next navigation drops the page holding it.
    pendingShots: pending.slice(),
    pins: JSON.parse(JSON.stringify(pins)),
    rev: state.rev as number,
    shot: taken,
    url: doc.location ? doc.location.href : ''
  }
}

/** One injectable expression: the anchor factory, then the engine over it. */
export function pinEngineSource(): string {
  return `(function (doc, holder, command) {
  var kit = (${anchorKit.toString()})(doc);
  return (${pinEngineCore.toString()})(doc, holder, command, kit);
})`
}
