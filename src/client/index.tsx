// acme/loop 浏览器端 half：对话页输入框上方的活动循环状态条。经
// `conversation.input.dock`（list 槽，与 queue/todo/goal/task-status 同一
// 官方槽家族）注册。Node half 注册只读状态路由，本组件每 1s 轮询并只渲染
// 当前会话（agentId === session.sessionId）的活动 loop。
//
// 视觉对齐官方 GoalBar（Figma 1236:32276 家族）：36px 高、12px 圆角、
// --dsw-specific-tip 背景、官方 icon（IconRefreshOutline16）+ StateDot
// （ongoing 活动指示）。有循环显示「● ⟳ 循环中 · prompt · 5m · 下次 23s」，
// 无则 null。零官方改动。
//
// dock 序位（list 槽按 priority → order 升序稳定排序）：todo=0 / goal=10 /
// task-status=10 / loop=15 / queue=20（终末条，紧贴输入框）。loop 必须低于
// queue 的 20，否则「消息 queued」时 queued 条会被 loop 压到非最下位置。
import { useCallback, useEffect, useState } from 'react'
import type { Context } from 'cordis'
import type { ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconCloseOutline16, IconRefreshOutline16, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Context merges: slots/locale (runtime) reach this program through their
// client entries.
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// SlotMap merges: conversation.input.dock (ui-conversation) + settings.section
// (ui-settings) + settings.plugin.item (ui-settings-plugins) are declared by
// their owners at runtime; ctx.settingsScope comes from ui-settings.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Loop copy. */
    'loop': LoopKey
    /** loop 插件设置页 copy. */
    'settings.loop': LoopSettingsKey
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

/** 设置命名空间（与 Node half 的 LOOP_SETTINGS_NAMESPACE 一致）。 */
const SETTINGS_NAMESPACE = 'dsh-loop'

/** 用户可写设置（与 Node half 的 LOOP_SETTINGS_SCHEMA 字段一致）。 */
interface LoopSettings {
  /** 把 loop 工具暴露给 agent。 */
  loop: boolean
}

/** 设置卡片字段表：每个 LoopToolField 对应 LOOP_SETTINGS_SCHEMA 的一个字段
 * （字段名 = 工具注册名）与 Node half 的 toolDefinitions 的 key——三处同源。
 * 新增工具 = 三处各加一条，设置页自动多出一行 Switch。 */
const LOOP_TOOL_FIELDS = [
  { field: 'loop', title: 'tool.loop', hint: 'tool.loopDetail' },
] as const

/** 字段名联合（目前只有 loop）。 */
export type LoopFieldName = typeof LOOP_TOOL_FIELDS[number]['field']

/** 设置页 locale 命名空间。文案对齐官方 ui-settings-plugins 卡片（同上款）。 */
const settingsNS = 'settings.loop'
const zhSettings = {
  'title': 'dsh-loop',
  'description': '把 dsh-loop 插件的 loop 工具注入模型的工具集（保存后新会话立即生效）。',
  'tool.loop': '注入 loop 工具',
  'tool.loopDetail': '向模型注入 loop 工具后，模型可自行 start / stop / status 定时循环：\n'
    + '· start <任务 prompt> [interval] — 按间隔重复投递任务；interval 形如 5m / 30s / 1h，缺省 1m\n'
    + '· stop [loop_id] — 停止指定循环；不传则停止当前会话全部循环\n'
    + '· status — 列出当前会话的活动循环（id、间隔、任务 prompt）\n'
    + '关闭后不再注入：模型看不到也调不动 loop（tools.schemas 不含它）；/loop 命令（用户侧）与状态条不受影响。',
  'readOnly': '本部署的设置为只读。',
  'expand': '展开设置',
  'collapse': '收起设置',
  'save': '保存',
  'saving': '保存中…',
  'discard': '放弃修改',
  'unsaved': '未保存',
  'saveFailed': '本部署没有接受这些值，已保留供你修改。',
} satisfies Record<string, string>
/** loop 设置页 locale key 联合。 */
type LoopSettingsKey = keyof typeof zhSettings
const enSettings = {
  'title': 'dsh-loop',
  'description': 'Injects the dsh-loop loop tool into the model (takes effect on new sessions right away).',
  'tool.loop': 'Inject loop tool',
  'tool.loopDetail': 'With the loop tool injected, the model can start / stop / status scheduled loops on its own:\n'
    + '· start <task prompt> [interval] — re-delivers the task every interval; interval like 5m / 30s / 1h, defaults to 1m\n'
    + '· stop [loop_id] — stops one loop; without loop_id, stops all loops of the current session\n'
    + '· status — lists the session\'s active loops (id, interval, task prompt)\n'
    + 'Turning it off stops the injection: loop is no longer in the model\'s tools.schemas; the /loop command (user side) and the status bar stay.',
  'readOnly': 'This deployment stores settings read-only.',
  'expand': 'Show settings',
  'collapse': 'Hide settings',
  'save': 'Save',
  'saving': 'Saving…',
  'discard': 'Discard',
  'unsaved': 'Unsaved',
  'saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
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

/** 单字段行快照（纯布尔开关：只有 checked——对开关来说「已覆盖/恢复默认」
 * 没有信息量，默认即开/关，官方徽章与恢复默认按钮省略）。 */
interface LoopFieldState {
  /** 开关的暂存或生效值。 */
  checked: boolean
}

/** 卡片快照（对齐官方 CardShell/CardFieldState 语义；每工具一个字段行）。 */
interface LoopSettingsCardState {
  /** False while the namespace is not served to this client; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Whether the form holds edits that a save would write. */
  dirty: boolean
  /** Whether a save is crossing the wire. */
  saving: boolean
  /** Whether the last save did not land as staged; cleared by the next edit or save. */
  failed: boolean
  /** Per-tool switch rows（字段名 → 行状态）。 */
  fields: Partial<Record<LoopFieldName, LoopFieldState>>
}

/**
 * 多字段布尔暂存表单：对齐官方 CardForm 语义（`edit` 暂存 → `save` 提交 /
 * `discard` 丢弃）。每个字段独立暂存（布尔）；保存把所有暂存一次性提交
 * （revision-fenced 文档变更），与官方其他插件卡片一致。
 */
class LoopSettingsForm {
  private draft: Partial<Record<LoopFieldName, boolean>> = {}
  private saving = false
  private failed = false
  private readonly listeners = new Set<() => void>()
  // 快照缓存：draft 对象每次变更整体替换（引用即失效信号），配合 scope 快照
  // 引用一并用做缓存键。
  private cache:
    | { snap: unknown; draft: Partial<Record<LoopFieldName, boolean>>; saving: boolean; failed: boolean; state: LoopSettingsCardState }
    | undefined = undefined

  /** @param scope - 已绑定的 `dsh-loop` 设置命名空间。 */
  constructor(private readonly scope: SettingsScope<LoopSettings>) {
    // 宿主侧变更（其他客户端写入、连接重置后的重读）也要驱动卡片重渲。
    this.scope.subscribe(() => this.emit())
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  // 快照必须引用稳定：useSyncExternalStore 要求内容未变时返回同一对象，
  // 否则卡片渲染会无限重渲（React #185）。输入（scope 快照引用 + 暂存状态）
  // 都没变时直接返回缓存对象。
  getSnapshot = (): LoopSettingsCardState => {
    const snap = this.scope.getSnapshot()
    if (this.cache !== undefined
      && this.cache.snap === snap
      && this.cache.draft === this.draft
      && this.cache.saving === this.saving
      && this.cache.failed === this.failed) {
      return this.cache.state
    }
    const committed = snap.value ?? {}
    const fields: Partial<Record<LoopFieldName, LoopFieldState>> = {}
    for (const { field } of LOOP_TOOL_FIELDS) {
      const staged = this.draft[field]
      const committedValue = typeof committed[field] === 'boolean' ? committed[field] : true
      fields[field] = { checked: staged ?? committedValue }
    }
    const state: LoopSettingsCardState = {
      available: snap.status !== 'unavailable',
      writable: snap.writable,
      dirty: Object.keys(this.draft).length > 0,
      saving: this.saving,
      failed: this.failed,
      fields,
    }
    this.cache = { snap, draft: this.draft, saving: this.saving, failed: this.failed, state }
    return state
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  /** 暂存一次勾选（布尔），整体替换 draft 对象使引用失效。 */
  edit = (field: LoopFieldName, checked: boolean): void => {
    this.draft = { ...this.draft, [field]: checked }
    this.failed = false
    this.emit()
  }

  /** 丢弃全部暂存。 */
  discard = (): void => {
    if (Object.keys(this.draft).length === 0) return
    this.draft = {}
    this.failed = false
    this.emit()
  }

  /** 提交全部暂存（revision-fenced 写），随后以宿主接受值重读确认。 */
  save = async (): Promise<void> => {
    const staged = Object.entries(this.draft) as [LoopFieldName, boolean][]
    if (staged.length === 0 || this.saving) return
    this.saving = true
    this.emit()
    let failed = false
    try {
      for (const [field, value] of staged) {
        await this.scope.set(field, value)
      }
    } catch {
      // 传输失败：controller 已做恢复重读，下面按快照逐字段判定。
    }
    const snap = this.scope.getSnapshot()
    const committed = snap.value ?? {}
    for (const [field, value] of staged) {
      if (typeof committed[field] !== 'boolean' || committed[field] !== value) failed = true
    }
    this.saving = false
    this.draft = {}
    this.failed = failed
    this.emit()
  }
}

/** 设置卡片注入面：快照 store + 暂存表单动作（按字段）。 */
export interface LoopSettingsInjected {
  hooks: {
    loopSettings: SnapshotStore<LoopSettingsCardState>
  }
  /** 暂存一次勾选（按字段）。 */
  edit: (field: LoopFieldName, checked: boolean) => void
  /** 提交暂存。 */
  save: () => Promise<void>
  /** 丢弃暂存。 */
  discard: () => void
}

/**
 * 官方质感 Switch（rc.8 交付物没有官方 Switch 组件——检查过 app shell 与全部
 * shipped client bundle，`role:"switch"`/`aria-checked` 零命中；官方设置控件是
 * input/select/分段按钮。所以自绘：36×20 轨道 + 14 滑块，全走 design tokens
 * ——开态 `--dsw-alias-brand-primary`，关态 `--dsw-alias-border-l2` 边框 +
 * `--dsw-alias-bg-layer-2` 底，滑块 `--dsw-alias-label-primary-inverted`；
 * focus 环用 `--dsw-alias-interactive-bg-hover`，disabled 走官方 0.4 透明度。
 * 语义：`role="switch"` + `aria-checked` + 原生按钮键盘（Enter/Space）。
 */
function OfficialSwitch(props: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}): ReactNode {
  const [focused, setFocused] = useState(false)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => { props.onChange(!props.checked) }}
      onFocus={() => { setFocused(true) }}
      onBlur={() => { setFocused(false) }}
      style={{
        position: 'relative',
        flex: 'none',
        width: 36, height: 20,
        borderRadius: 999,
        boxSizing: 'border-box',
        padding: 0,
        border: `1px solid ${props.checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
        background: props.checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
        boxShadow: focused ? '0 0 0 3px var(--dsw-alias-interactive-bg-hover)' : 'none',
        cursor: props.disabled ? 'default' : 'pointer',
        opacity: props.disabled ? 0.4 : 1,
        transition: 'background .16s, border-color .16s, box-shadow .16s, opacity .16s',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 2,
          left: props.checked ? 20 : 2,
          width: 14, height: 14,
          borderRadius: '50%',
          background: 'var(--dsw-alias-label-primary-inverted)',
          transition: 'left .16s',
        }}
      />
    </button>
  )
}

/**
 * 设置 → 插件 里的插件卡片（settings.plugin.item 槽，与官方 BashCard /
 * AgentLoopCard 完全同款 chrome：折叠头 + 未保存徽章 + 字段行 + 保存/放弃脚注；
 * rc.8 契约为 keyed 槽，key = 设置命名空间 dsh-loop）。每个工具一行官方
 * 质感 Switch（LOOP_TOOL_FIELDS 表驱动）。写库走 ctx.settingsScope 传输；
 * Node half watch 设置命名空间按工具表动态注册/注销工具，保存后新会话立即
 * 生效（`applies: 'live'`，见 index.mjs）。
 */
export function LoopSettingsCard(
  props: PropsRuntime<'settings.plugin.item'> & PropsLocale<'settings.loop'> & InjectFace<LoopSettingsInjected>,
): ReactNode {
  const { t } = props
  const state = props.useLoopSettings((s) => s)
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)

  if (!state.available) return null
  const disabled = !state.writable
  const blocked = !state.dirty || state.saving

  return (
    <li
      data-loop-settings-card=""
      onMouseEnter={() => { setHover(true) }}
      onMouseLeave={() => { setHover(false) }}
      style={{
        listStyle: 'none',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 12,
        background: open || hover ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
        borderColor: open || hover ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsw-alias-border-l2)',
        transition: 'border-color .16s, background .16s',
        boxSizing: 'border-box',
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(!open) }}
        style={{
          width: '100%', appearance: 'none', border: 0, background: 'none',
          font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary)' }}>
            {t('title')}
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }}>
            {t('description')}
          </span>
        </span>
        {state.dirty
          ? (
            <span
              style={{
                flex: 'none', borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px',
                fontWeight: 500, whiteSpace: 'nowrap', background: 'var(--dsw-alias-bg-module-platform)',
                color: 'var(--dsw-alias-label-secondary)',
              }}
            >
              {t('unsaved')}
            </span>
          )
          : null}
        <span
          style={{
            flex: 'none', display: 'flex', color: 'var(--dsw-alias-label-tertiary)',
            transition: 'transform .16s', transform: open ? 'rotate(180deg)' : 'none',
          }}
        >
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open
        ? (
          <div style={{ borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', paddingBottom: 8 }}>
            {disabled ? <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }} role="status">{t('readOnly')}</p> : null}
            <div style={{ display: 'flex', flexDirection: 'column', padding: '12px 0', gap: 0 }}>
              {LOOP_TOOL_FIELDS.map(({ field, title, hint }, index) => {
                const row = state.fields[field] ?? { checked: true }
                return (
                  <div
                    key={field}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 0',
                      borderBottom: index < LOOP_TOOL_FIELDS.length - 1 ? '1px solid var(--dsw-alias-border-l1)' : 'none',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' }}>
                        {t(title)}
                      </span>
                      <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'pre-line' }}>
                        {t(hint)}
                      </span>
                    </div>
                    <OfficialSwitch
                      checked={row.checked}
                      disabled={disabled}
                      label={t(title)}
                      onChange={(checked) => { props.edit(field, checked) }}
                    />
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
              {state.failed ? <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' }} role="status">{t('saveFailed')}</p> : null}
              <button
                type="button"
                disabled={blocked}
                onClick={() => { props.discard() }}
                style={{
                  appearance: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
                  padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: 'pointer',
                  background: 'none', color: 'var(--dsw-alias-label-secondary)',
                  opacity: blocked ? 0.4 : 1,
                }}
              >
                {t('discard')}
              </button>
              <button
                type="button"
                disabled={blocked}
                onClick={() => { void props.save() }}
                style={{
                  appearance: 'none', border: '1px solid transparent', borderRadius: 8,
                  padding: '5px 14px', font: 'inherit', fontSize: 13, lineHeight: 1.5, cursor: 'pointer',
                  background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)',
                  opacity: blocked ? 0.4 : 1,
                }}
              >
                {state.saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}

/** 需要此插件声明的服务：slots + locale + 设置传输（settingsScope/connection/remote）。 */
export const inject = ['slots', 'locale', 'settingsScope', 'connection', 'remote']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'loop: dictionaries')
  ctx.effect(() => ctx.locale.register(settingsNS, { zh: zhSettings, en: enSettings }), 'loop: settings dictionaries')
  // 0806 slots 契约：注册走 ctx.slots.inject（等待槽声明、随声明坍缩自动移除）。
  // dock 序位：queue 是官方「终末条」（order 20，紧贴输入框，见 ui-conversation
  // QueueDock 契约）。loop 必须排在它之前（15，位于 goal/task-status 的 10 带
  // 与 queue 的 20 之间）——若与 queue 同 order 20，稳定排序下谁先注册谁靠上，
  // loop 会压到最底，导致「消息 queued」时 queued 条不在最下（贴输入框）位置。
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'loop',
      order: 15,
      locale: NS,
    }, LoopBar))

  // 设置 → 插件卡片（settings.plugin.item，ConfigurablePluginsTab 声明槽）：
  // rc.8 契约为 keyed 槽，key = 本插件设置命名空间（渲染方按命名空间列表
  // entryKey 挑选卡片）。「dsh-loop」卡片控制是否把 loop 工具注入模型工具集，
  // 与 Node half 的 LOOP_SETTINGS_NAMESPACE/SCHEMA 对应；保存后新会话立即生效。
  const scope = ctx.settingsScope.bind<LoopSettings>({ namespace: SETTINGS_NAMESPACE })
  const loopForm = new LoopSettingsForm(scope)
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({
      name: 'settings.plugin.item',
      key: SETTINGS_NAMESPACE,
      locale: settingsNS,
      inject: (): LoopSettingsInjected => ({
        hooks: {
          loopSettings: {
            getSnapshot: loopForm.getSnapshot,
            subscribe: loopForm.subscribe,
          },
        },
        edit: loopForm.edit,
        save: loopForm.save,
        discard: loopForm.discard,
      }),
    }, LoopSettingsCard))
}
