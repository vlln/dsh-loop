// acme/loop 浏览器端 half：对话页输入框上方的活动循环状态条。经
// `conversation.input.dock`（list 槽，与 queue/todo/goal/task-status 同一
// 官方槽家族）注册。Node half 注册只读状态路由，本组件每 1s 轮询并只渲染
// 当前会话（agentId === session.sessionId）的活动 loop。
//
// 视觉对齐官方 GoalBar（Figma 1236:32276 家族）：36px 高、12px 圆角、
// --dsw-specific-tip 背景、官方 icon（IconRefreshOutline16）+ StateDot
// （ongoing 活动指示）。有循环显示「● ⟳ 循环中 · prompt · 5m · 下次 23s」，
// 无则 null。零官方改动。
import { useCallback, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { ReactNode } from 'react'
import { IconCloseOutline16, IconRefreshOutline16, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
// Context merges: slots/locale (runtime) reach this program through their
// client entries.
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// SlotMap merge: conversation.input.dock (ui-conversation) is declared by its
// contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Loop copy. */
    'loop': LoopKey
  }
}

/** Node half 只读活动 loop 路由（与 examples/loop/index.mjs 的 LOOPS_PATH 一致）。 */
const LOOPS_PATH = '/plugins/dsh-loop/loops'

/** 轮询间隔：状态条不需要亚秒刷新；60s 足够新（倒计时本地重算，不依赖轮询）。 */
const POLL_MS = 60_000

const NS = 'loop'
const zh = {
  'active': '循环中',
  'next': '下次 {countdown}',
  'loops.running': '{count} 个循环运行中',
  'open': '展开',
  'close': '收起',
  'stop': '停止循环',
} satisfies Record<string, string>
/** Loop namespace key union. */
type LoopKey = keyof typeof zh
const en = {
  'active': 'Looping',
  'next': 'next {countdown}',
  'loops.running': '{count} loop(s) running',
  'open': 'Expand',
  'close': 'Collapse',
  'stop': 'Stop loop',
} satisfies Record<string, string>

/** 布局变量对齐官方 dock 家族（ConversationRoot.module.css / GoalBar / QueueDock）。 */
const SIDE_CLEARANCE = 'var(--dsh-composer-side-clearance, 16px)'
const DOCK_INSET = 'var(--dsh-composer-dock-inset, 8px)'
const CARD_MAX = 'var(--dsh-composer-card-max-width, 780px)'

/** Node half 返回的 wire loop 视图（agentId 即宿主 session id）。 */
interface WireLoop {
  id: string
  agentId: string
  prompt: string
  intervalMs: number
  intervalText: string
  nextTickAt: number
}

/** 会话级轮询 hook：每 POLL_MS 拉取 Node half 路由，返回该会话的活动 loop。 */
function useSessionLoops(sessionId: string): WireLoop[] {
  const [loops, setLoops] = useState<WireLoop[]>([])
  useEffect(() => {
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(`${LOOPS_PATH}?sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: 'application/json' } })
        if (!res.ok) return
        const data = (await res.json()) as { loops?: WireLoop[] }
        if (alive && Array.isArray(data.loops)) setLoops(data.loops)
      } catch {
        // 瞬态网络错误：保持上一帧，下轮重试。
      }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, POLL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [sessionId])
  return loops
}

/** 下一次 tick 倒计时（秒）；已过则显示 0。 */
function countdownTo(nextTickAt: number): number {
  return Math.max(0, Math.ceil((nextTickAt - Date.now()) / 1000))
}

/**
 * 对话页输入框上方的活动循环状态条：仅 Chat 视图显示（`[data-chat-flow=""]`
 * 探针），轮询该会话活动 loop。有则单行展示（官方 dock 卡片视觉）；无则 null。
 */
export function LoopBar(
  props: PropsRuntime<'conversation.input.dock'> & PropsLocale<'loop'>,
): ReactNode {
  const { t, session } = props
  const loops = useSessionLoops(session.sessionId)
  const [inChat, setInChat] = useState(false)
  const [open, setOpen] = useState(false)
  const [stopping, setStopping] = useState<string | null>(null)

  /** 停止指定 loop（POST Node half 路由）；成功后轮询下一轮自然消失。 */
  const stopLoop = useCallback(async (id: string): Promise<void> => {
    if (stopping !== null) return
    setStopping(id)
    try {
      await fetch(LOOPS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    } catch {
      // 网络错误：保持状态条，用户可重试。
    } finally {
      setStopping(null)
    }
  }, [stopping])

  // 对话页探针：flow 列存在性（navbar/task-status 同信号）。body 级 observer
  // 只跑 querySelector，回调轻量；view 切换（flow 移除/重建）都触发。
  useEffect(() => {
    const check = (): void => {
      setInChat(document.querySelector('[data-chat-flow=""]') !== null)
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [])

  if (!inChat) return null
  if (loops.length === 0) return null

  // 多 loop 折叠（参考 task-status）：单条直接显示；多条默认折叠为计数
  // header，点击展开列表。
  const bar = (loop: WireLoop): ReactNode => {
    const countdown = countdownTo(loop.nextTickAt)
    const countdownText = countdown > 0 ? `${countdown}s` : 'now'
    return (
      <div
        key={loop.id}
        data-loop-bar=""
        style={{
          boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%',
          // 高度由内容撑开（对齐官方 TodoPanel：body padding 上下 6px +
          // 24px 行高 + border ≈ 38px），不设固定 height——固定 height 会
          // 与 To-dos 卡片的实际高度产生 2px 级偏差。
          padding: '6px 12px',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 12,
          background: 'var(--dsw-specific-tip)',
          fontSize: 13,
          fontFamily: 'system-ui',
        }}
      >
        {/* 活动指示：ongoing 像素点 + 循环 icon */}
        <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 8 }}>
          <StateDot state="ongoing" size={10} />
          <span style={{ display: 'inline-flex', flex: 'none', color: 'var(--dsw-alias-label-tertiary)' }}>
            <IconRefreshOutline16 size={14} />
          </span>
        </span>
        {/* 状态标签（13/24 medium，与 Todo/Queue 标题同族）+ loop id */}
        <span style={{
          flex: 'none', fontSize: 13, lineHeight: '24px', fontWeight: 500,
          color: 'var(--dsw-alias-label-primary)',
        }}>
          {t('active')}
          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: 'var(--dsw-alias-label-caption)' }}>{loop.id}</span>
        </span>
        {/* prompt：主文本，省略号截断 */}
        <span style={{
          flex: 1, minWidth: 0, overflow: 'hidden', fontSize: 13, lineHeight: '20px',
          color: 'var(--dsw-alias-label-primary-dimmed)', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {loop.prompt}
        </span>
        {/* 间隔 + 倒计时 */}
        <span style={{ flex: 'none', fontSize: 12, lineHeight: '20px', color: 'var(--dsw-alias-label-caption)', whiteSpace: 'nowrap' }}>
          {loop.intervalText} · {t('next', { countdown: countdownText })}
        </span>
        {/* 停止按钮：官方 queue/action 同款（Tooltip + icon button，右侧） */}
        <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center' }}>
          <Tooltip label={t('stop')} side="bottom" delayMs={500}>
            <button
              type="button"
              aria-label={t('stop')}
              disabled={stopping === loop.id}
              onClick={() => { void stopLoop(loop.id) }}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 24, height: 24, padding: 0, border: 'none', borderRadius: 6,
                background: 'transparent', cursor: 'pointer', flex: 'none',
                color: 'var(--dsw-alias-label-tertiary)',
                transition: 'background .15s ease, color .15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,140,.12))'
                e.currentTarget.style.color = 'var(--dsw-alias-label-primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--dsw-alias-label-tertiary)'
              }}
            >
              <IconCloseOutline16 size={14} />
            </button>
          </Tooltip>
        </span>
      </div>
    )
  }

  // 单条：直接显示完整 bar。
  if (loops.length === 1) {
    const single = loops[0]
    return (
      <div data-loop-dock="" style={{
        boxSizing: 'border-box',
        width: `calc(100% - 2 * ${SIDE_CLEARANCE} - 4 * ${DOCK_INSET})`,
        maxWidth: `calc(${CARD_MAX} - 4 * ${DOCK_INSET})`,
        margin: '0 auto',
      }}>
        {single !== undefined ? bar(single) : null}
      </div>
    )
  }

  // 多条：折叠为计数 header（dock 卡片视觉，对齐 task-status 折叠）。
  const card = (body: ReactNode): ReactNode => (
    <div
      data-loop-dock=""
      style={{
        boxSizing: 'border-box',
        width: `calc(100% - 2 * ${SIDE_CLEARANCE} - 4 * ${DOCK_INSET})`,
        maxWidth: `calc(${CARD_MAX} - 4 * ${DOCK_INSET})`,
        margin: '0 auto',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 12,
        background: 'var(--dsw-specific-tip)',
        overflow: 'hidden',
        fontSize: 13,
        fontFamily: 'system-ui',
      }}
    >
      {body}
    </div>
  )

  const header = (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 12px', cursor: 'pointer',
      }}
      onClick={() => { setOpen(v => !v) }}
    >
      <span style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 8 }}>
        <StateDot state="ongoing" size={10} />
        <span style={{ display: 'inline-flex', flex: 'none', color: 'var(--dsw-alias-label-tertiary)' }}>
          <IconRefreshOutline16 size={14} />
        </span>
      </span>
      <span style={{ flex: 1, fontSize: 13, lineHeight: '24px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>
        {t('loops.running', { count: loops.length })}
      </span>
      <span style={{ flex: 'none', fontSize: 12, color: 'var(--dsw-alias-label-caption)' }}>
        {open ? t('close') : t('open')}
      </span>
    </div>
  )

  return card(
    <>
      {header}
      {open && (
        <div style={{ maxHeight: 180, overflowY: 'auto', borderTop: '1px solid var(--dsw-alias-border-l1)', padding: '4px 0' }}>
          {loops.map(loop => (
            <div key={loop.id} style={{ padding: '2px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 'none', fontSize: 12, color: 'var(--dsw-alias-label-caption)', whiteSpace: 'nowrap' }}>{loop.id}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary-dimmed)', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {loop.prompt}
              </span>
              <span style={{ flex: 'none', fontSize: 12, color: 'var(--dsw-alias-label-caption)', whiteSpace: 'nowrap' }}>
                {loop.intervalText} · {t('next', { countdown: countdownTo(loop.nextTickAt) > 0 ? `${countdownTo(loop.nextTickAt)}s` : 'now' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </>,
  )
}

/** 需要此插件声明的服务：slots + locale。 */
export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'loop: dictionaries')
  // 0806 slots 契约：注册走 ctx.slots.inject（等待槽声明、随声明坍缩自动移除）。
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'loop',
      order: 20,
      locale: NS,
    }, LoopBar))
}
