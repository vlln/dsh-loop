// vlln/loop 浏览器端 half：对话页输入框上方的活动循环状态条 + 插件包页配置卡片。
// 状态条经 `conversation.input.dock`（list 槽，与 queue/todo/goal/task-status 同一
// 官方槽家族）注册。Node half 注册只读状态路由，本组件按 POLL_MS 轮询并只渲染
// 当前会话（agentId === session.sessionId）的活动 loop；轮询同时带 ctx.locale 的
// 当前语言（`?lang=`）——宿主没有 locale 服务，Node half 的用户可见文案靠这条
// 回传选语言（见 relayLanguage）。
//
// 视觉对齐官方 GoalBar（同槽邻居 `dsh-client-ui-goal` 的 GoalBar.module.css 的
// `.bar`）：无边框 + `--dsw-radius-md` 圆角 + 36px 行高 + `--dsw-elevation-panel`
// 阴影（描边走 `--dsw-elevation-stroke-color`）+ `--dsw-specific-menu` 表面与
// `--dsw-menu-backdrop-filter` 模糊，行内节奏 padding 4px 5px 4px 12px / gap 10。
// 官方 icon（IconRefreshOutlineRegular 14px）+ StateDot（ongoing 活动指示）。
// 有循环显示「● ⟳ 循环中 · prompt · 5m · 下次 23s」，无则 null。零官方改动。
//
// dock 序位（list 槽按 priority → order 升序稳定排序）：todo=0 / goal=10 /
// task-status=10 / loop=15 / queue=20（终末条，紧贴输入框）。loop 必须低于
// queue 的 20，否则「消息 queued」时 queued 条会被 loop 压到非最下位置。
//
// 配置卡片经官方 `plugins.bundle.config`（keyed 槽，key = bundle 包名
// `@vlln/dsh-loop`）注册在 Plugins 页本 bundle 的包页描述与行清单之间；
// 传输走 `ctx.configForms.get(<条目 id>)`（条目 id `dsh-loop` 即设置命名空间，
// 由 Node half 导出的 Config schema 声明）。旧 settingsScope /
// settings.plugin.item 缝已退役，本插件不再引用。
//
// `/loop` 菜单行的**图标 + 本地化标题**经 `commandUi.candidates` 出口贴面（见
// installCommandRowFace）：官方只给六个一等公民宿主命令配了行外观，第三方宿主命令
// 没有注册入口，同名客户端贡献会 fail loud。贴面只重写本插件那一行，上游改动时
// 自动降级为官方回退外观（裸名字 + 宿主 description，无图标）。
import { useCallback, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { CSSProperties, ReactNode } from 'react'
import {
  IconCloseOutlineRegular, IconRefreshOutlineRegular, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Context merges: slots/locale (runtime) reach this program through their
// client entries.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// SlotMap merges: conversation.input.dock (ui-conversation) +
// plugins.bundle.config (ui-plugin-manager) are declared by their owners at
// runtime; ctx.configForms comes from ui-settings.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

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

/**
 * Node half 界面语言的回传源：宿主没有 locale 服务（语言偏好只在浏览器侧），
 * Node half 的用户可见文案（命令面板 description、命令回执）靠本 half 在既有的
 * /loops 轮询上带 `?lang=` 得知。取值来自 ctx.locale 快照的 active；白名单外的
 * 语言（如语言包新增的 id）按 'en' 回传，Node half 侧另有同样的白名单兜底。
 * 语言变化即通知订阅者就地重发一次轮询（不等下一个 POLL_MS 周期，也不新增轮询）。
 */
const RELAYED_LANGUAGES = ['zh', 'en']
const DEFAULT_UI_LANGUAGE = 'en'
let relayedLanguage = DEFAULT_UI_LANGUAGE
const languageListeners = new Set<() => void>()

/** 记录一次语言变化并通知订阅者（值未变时不通知）。 */
function relayLanguage(active: string): void {
  const next = RELAYED_LANGUAGES.includes(active) ? active : DEFAULT_UI_LANGUAGE
  if (next === relayedLanguage) return
  relayedLanguage = next
  for (const listener of languageListeners) listener()
}

/** 订阅回传语言：语言变化时重渲（轮询 effect 依赖它，随即便地重发一次）。 */
function useRelayedLanguage(): string {
  const [language, setLanguage] = useState(relayedLanguage)
  useEffect(() => {
    const listener = (): void => { setLanguage(relayedLanguage) }
    languageListeners.add(listener)
    listener()
    return () => { languageListeners.delete(listener) }
  }, [])
  return language
}

const NS = 'loop'
const zh = {
  'active': '循环中',
  'next': '下次 {countdown}',
  'loops.running': '{count} 个循环运行中',
  'open': '展开',
  'close': '收起',
  'stop': '停止循环',
  'cmd.label': '循环',
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
  'cmd.label': 'Loop',
} satisfies Record<string, string>

/**
 * 设置命名空间 = 声明 `Config` schema 的条目 id（cordis.patch.yml 的 insert
 * 条目 id，与 Node half 的 LOOP_SETTINGS_NAMESPACE 一致）。
 */
const SETTINGS_NAMESPACE = 'dsh-loop'

/**
 * 插件包页的槽 key = bundle 包名（`plugins.bundle.config` 按包名挑选条目，
 * 与设置命名空间（条目 id）不是同一个字符串）。
 */
const BUNDLE_PACKAGE = '@vlln/dsh-loop'

/** 用户可写设置（与 Node half 的 LOOP_SETTINGS_SCHEMA 字段一致）。 */
interface LoopSettings {
  /** 把 loop 工具暴露给 agent。 */
  loop: boolean
}

/** 设置卡片字段表：每个 LoopToolField 对应 LOOP_SETTINGS_SCHEMA 的一个字段
 * （字段名 = 工具注册名 = mutate 写路径的叶）与 Node half 的 toolDefinitions 的
 * key——三处同源。新增工具 = 三处各加一条，设置页自动多出一行 Switch。 */
const LOOP_TOOL_FIELDS = [
  { path: 'loop', title: 'tool.loop', hint: 'tool.loopDetail' },
] as const

/** 字段名联合（目前只有 loop）。 */
export type LoopFieldName = typeof LOOP_TOOL_FIELDS[number]['path']

/** 设置页 locale 命名空间（包页 chrome 由官方页面画，文案只需字段与脚注）。 */
const settingsNS = 'settings.loop'
const zhSettings = {
  'description': '把 dsh-loop 插件的 loop 工具注入模型的工具集（保存后新会话立即生效）。',
  'tool.loop': '注入 loop 工具',
  'tool.loopDetail': '向模型注入 loop 工具后，模型可自行 start / stop / status 定时循环：\n'
    + '· start <任务 prompt> [interval] — 按间隔重复投递任务；interval 形如 5m / 30s / 1h，缺省 1m\n'
    + '· stop [loop_id] — 停止指定循环；不传则停止当前会话全部循环\n'
    + '· status — 列出当前会话的活动循环（id、间隔、任务 prompt）\n'
    + '关闭后不再注入：模型看不到也调不动 loop（tools.schemas 不含它）；/loop 命令（用户侧）与状态条不受影响。',
  'readOnly': '本部署的设置为只读。',
  'save': '保存',
  'saving': '保存中…',
  'discard': '放弃修改',
  'unsaved': '未保存',
  'saveFailed': '本部署没有接受这些值，已保留供你修改。',
} satisfies Record<string, string>
/** loop 设置页 locale key 联合。 */
type LoopSettingsKey = keyof typeof zhSettings
const enSettings = {
  'description': 'Injects the dsh-loop loop tool into the model (takes effect on new sessions right away).',
  'tool.loop': 'Inject loop tool',
  'tool.loopDetail': 'With the loop tool injected, the model can start / stop / status scheduled loops on its own:\n'
    + '· start <task prompt> [interval] — re-delivers the task every interval; interval like 5m / 30s / 1h, defaults to 1m\n'
    + '· stop [loop_id] — stops one loop; without loop_id, stops all loops of the current session\n'
    + '· status — lists the session\'s active loops (id, interval, task prompt)\n'
    + 'Turning it off stops the injection: loop is no longer in the model\'s tools.schemas; the /loop command (user side) and the status bar stay.',
  'readOnly': 'This deployment stores settings read-only.',
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

/** 会话级轮询 hook：每 POLL_MS 拉取 Node half 路由（带当前语言回传），返回该会话的活动 loop。
 *  语言变化时依赖变化 → effect 重跑 → 立即再拉一次（语言翻转不滞后一个轮询周期）。 */
function useSessionLoops(sessionId: string, language: string): WireLoop[] {
  const [loops, setLoops] = useState<WireLoop[]>([])
  useEffect(() => {
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const query = `sessionId=${encodeURIComponent(sessionId)}&lang=${encodeURIComponent(language)}`
        const res = await fetch(`${LOOPS_PATH}?${query}`, { headers: { accept: 'application/json' } })
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
  }, [sessionId, language])
  return loops
}

/** 下一次 tick 倒计时（秒）；已过则显示 0。 */
function countdownTo(nextTickAt: number): number {
  return Math.max(0, Math.ceil((nextTickAt - Date.now()) / 1000))
}

// ── dock 卡片 chrome（规格来源：同槽官方邻居 GoalBar.module.css 的 `.bar`）──
// 单循环 bar 与多循环折叠卡共用同一表面：无边框 + md 圆角 + elevation 阴影
// （描边色走 `--dsw-elevation-stroke-color`）+ meta 面 + backdrop 模糊。
// fallback 沿用本仓既有写法（官方 token 缺失时退回旧外观：12px 圆角 / 旧 tip
// 底色 / 无模糊与阴影），不新增猜测值。
const BAR_RADIUS = 'var(--dsw-radius-md, 12px)'
const BAR_SHADOW = 'var(--dsw-elevation-panel, none)'
const BAR_SURFACE_BG = 'var(--dsw-specific-menu, var(--dsw-specific-tip))'
const BAR_SURFACE_BLUR = 'var(--dsw-menu-backdrop-filter, none)'

/** 卡片本体（不含高度：单循环/header 行 36px，多循环卡由 header + 展开列表撑开）。 */
const CARD_CHROME = {
  position: 'relative',
  isolation: 'isolate',
  boxSizing: 'border-box',
  width: '100%',
  border: 0,
  borderRadius: BAR_RADIUS,
  boxShadow: BAR_SHADOW,
  // elevation-panel 的 1px 描边走这个变量（goal 同款）。
  '--dsw-elevation-stroke-color': 'var(--dsw-alias-border-l1)',
} as CSSProperties

/** 36px 行：官方 `.bar` 的高度/内边距/间隙。 */
const ROW_CHROME = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  boxSizing: 'border-box',
  height: 36,
  padding: '4px 5px 4px 12px',
} as CSSProperties

const GLYPH_STYLE = {
  display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 8,
  color: 'var(--dsw-alias-label-tertiary)',
} as CSSProperties
const LABEL_STYLE = {
  flex: 'none', fontSize: 13, lineHeight: '24px', fontWeight: 500,
  color: 'var(--dsw-alias-label-primary)',
} as CSSProperties
const OBJECTIVE_STYLE = {
  flex: 1, minWidth: 0, overflow: 'hidden', fontSize: 13, lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary-dimmed)', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
} as CSSProperties
const CAPTION_STYLE = {
  flex: 'none', fontSize: 12, lineHeight: '20px',
  color: 'var(--dsw-alias-label-caption)', whiteSpace: 'nowrap',
} as CSSProperties
const LOOP_ID_STYLE = {
  marginLeft: 6, fontSize: 11, fontWeight: 400, color: 'var(--dsw-alias-label-caption)',
} as CSSProperties
const ACTIONS_STYLE = {
  display: 'flex', flex: 'none', alignItems: 'center', gap: 10,
} as CSSProperties

/**
 * 卡片表面层：官方 `.bar:before` 的内联等价物（本插件不注入 CSS，没有伪元素）。
 * 绝对定位 + `z-index:-1` + 父级 `isolation:isolate` → 压在本体背景之下、内容
 * 之上，`border-radius:inherit` 跟随卡片圆角。
 */
function BarSurface(): ReactNode {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0, zIndex: -1, borderRadius: 'inherit',
        background: BAR_SURFACE_BG, backdropFilter: BAR_SURFACE_BLUR, pointerEvents: 'none',
      }}
    />
  )
}

/**
 * 官方 icon 按钮（goal `.iconBtn`）：28×28 圆形、tertiary 色、hover 转
 * `--dsw-alias-interactive-bg-hover` + secondary 色、disabled 降 0.4。
 * Tooltip 走 portal（卡片 `overflow:hidden` 裁不了它）。
 */
function BarIconButton(props: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}): ReactNode {
  const disabled = props.disabled === true
  return (
    <Tooltip label={props.label} side="bottom" delayMs={500} portal>
      <button
        type="button"
        aria-label={props.label}
        disabled={disabled}
        onClick={props.onClick}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, padding: 0, border: 'none', borderRadius: 999, flex: 'none',
          background: 'transparent', cursor: disabled ? 'default' : 'pointer',
          color: 'var(--dsw-alias-label-tertiary)', opacity: disabled ? 0.4 : 1,
          transition: 'background .15s ease, color .15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,140,.12))'
          e.currentTarget.style.color = 'var(--dsw-alias-label-secondary)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--dsw-alias-label-tertiary)'
        }}
      >
        {props.children}
      </button>
    </Tooltip>
  )
}

/** 活动指示 glyph（官方 `.goalGlyph` 的位置与配色）：ongoing 像素点 + 循环 icon。 */
function LoopGlyph(): ReactNode {
  return (
    <span style={GLYPH_STYLE}>
      <StateDot state="ongoing" size={10} />
      <IconRefreshOutlineRegular size={14} />
    </span>
  )
}

/**
 * 对话页输入框上方的活动循环状态条：仅 Chat 视图显示（`[data-chat-flow=""]`
 * 探针），轮询该会话活动 loop。有则单行展示（官方 dock 卡片视觉）；无则 null。
 */
export function LoopBar(
  props: PropsRuntime<'conversation.input.dock'> & PropsLocale<'loop'>,
): ReactNode {
  const { t, session } = props
  const language = useRelayedLanguage()
  const loops = useSessionLoops(session.sessionId, language)
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
      <div key={loop.id} data-loop-bar="" style={{ ...CARD_CHROME, ...ROW_CHROME }}>
        <BarSurface />
        <LoopGlyph />
        {/* 状态标签（13/24 medium，官方 `.label`）+ loop id */}
        <span style={LABEL_STYLE}>
          {t('active')}
          <span style={LOOP_ID_STYLE}>{loop.id}</span>
        </span>
        {/* prompt：主文本（官方 `.objective`），省略号截断 */}
        <span style={OBJECTIVE_STYLE}>{loop.prompt}</span>
        {/* 间隔 + 倒计时（goal 无此段，沿用本插件 caption 节奏） */}
        <span style={CAPTION_STYLE}>
          {loop.intervalText} · {t('next', { countdown: countdownText })}
        </span>
        {/* 停止按钮：官方 `.actions` + `.iconBtn` */}
        <span style={ACTIONS_STYLE}>
          <BarIconButton
            label={t('stop')}
            disabled={stopping === loop.id}
            onClick={() => { void stopLoop(loop.id) }}
          >
            <IconCloseOutlineRegular size={14} />
          </BarIconButton>
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

  // 多条：折叠为计数 header（与单循环 bar 同一 chrome；展开区同一表面，
  // overflow:hidden 让列表被卡片圆角裁切，分隔线走同族 border token）。
  const card = (body: ReactNode): ReactNode => (
    <div
      data-loop-dock=""
      style={{
        boxSizing: 'border-box',
        width: `calc(100% - 2 * ${SIDE_CLEARANCE} - 4 * ${DOCK_INSET})`,
        maxWidth: `calc(${CARD_MAX} - 4 * ${DOCK_INSET})`,
        margin: '0 auto',
      }}
    >
      <div style={{ ...CARD_CHROME, overflow: 'hidden' }}>
        <BarSurface />
        {body}
      </div>
    </div>
  )

  const header = (
    <div
      // 右侧是文字而非 28px 控件，故右内边距用文本档 12px（官方 5px 是控件档）。
      style={{ ...ROW_CHROME, paddingRight: 12, cursor: 'pointer' }}
      onClick={() => { setOpen(v => !v) }}
    >
      <LoopGlyph />
      <span style={{ ...LABEL_STYLE, flex: 1 }}>{t('loops.running', { count: loops.length })}</span>
      <span style={CAPTION_STYLE}>{open ? t('close') : t('open')}</span>
    </div>
  )

  return card(
    <>
      {header}
      {open && (
        <div style={{ maxHeight: 180, overflowY: 'auto', borderTop: '1px solid var(--dsw-alias-border-l1)', padding: '4px 0' }}>
          {loops.map(loop => (
            <div key={loop.id} style={{ padding: '2px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={CAPTION_STYLE}>{loop.id}</span>
              <span style={OBJECTIVE_STYLE}>{loop.prompt}</span>
              <span style={CAPTION_STYLE}>
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

/** 卡片快照（对齐官方 CardForm 语义；每工具一个字段行）。 */
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
 * 多字段布尔暂存表单：对齐官方 ConfigForm 语义（`edit` 暂存 → `save` 单次
 * revision-fenced 提交 → `discard` 丢弃）。
 * 写路径用官方 mutate 的数组叶路径（可任意深）：字段名即 schema 叶名，工具
 * 字段若将来嵌套也不必整组合并写。CAS 基线 revision 在首次暂存时取（暂存期间
 * 他人写入 → 保存被拒 → failed），save/discard 后清空。
 * 快照必须引用稳定：useSyncExternalStore 要求内容未变时返回同一对象，否则
 * 卡片渲染会无限重渲（React #185）；draft 对象每次变更整体替换（引用即失效
 * 信号）。保存后按宿主接受值逐字段确认——布尔叶等值比较即可。
 */
class LoopSettingsForm {
  private draft: Partial<Record<LoopFieldName, boolean>> = {}
  private saving = false
  private failed = false
  /** 首次暂存时的 scope revision（CAS 基线；save/discard 后清空）。 */
  private baselineRevision: number | undefined = undefined
  private readonly listeners = new Set<() => void>()
  private offScope: (() => void) | undefined = undefined
  private cache:
    | { snap: unknown; draft: Partial<Record<LoopFieldName, boolean>>; saving: boolean; failed: boolean; state: LoopSettingsCardState }
    | undefined = undefined

  /** @param scope - 已绑定的 `dsh-loop` 设置命名空间（ctx.configForms.get(条目 id)）。 */
  constructor(private readonly scope: ConfigForm<LoopSettings>) {
    // 宿主侧变更（其他客户端写入、连接重置后的重读）也要驱动卡片重渲。
    this.offScope = this.scope.subscribe(() => this.emit())
  }

  /** 退订 scope（注册方 dispose 时调用；幂等）。 */
  dispose = (): void => {
    if (this.offScope === undefined) return
    this.offScope()
    this.offScope = undefined
    this.listeners.clear()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

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
    for (const { path } of LOOP_TOOL_FIELDS) {
      const staged = this.draft[path]
      const committedValue = typeof committed[path] === 'boolean' ? committed[path] : true
      fields[path] = { checked: staged ?? committedValue }
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

  /** 暂存一次勾选（按叶路径；首次暂存记 CAS 基线 revision）。 */
  edit = (field: LoopFieldName, checked: boolean): void => {
    if (this.baselineRevision === undefined) this.baselineRevision = this.scope.getSnapshot().revision
    this.draft = { ...this.draft, [field]: checked }
    this.failed = false
    this.emit()
  }

  /** 丢弃全部暂存。 */
  discard = (): void => {
    if (Object.keys(this.draft).length === 0) return
    this.draft = {}
    this.baselineRevision = undefined
    this.failed = false
    this.emit()
  }

  /** 提交全部暂存（单次 revision-fenced mutate），随后以宿主接受值重读确认。 */
  save = async (): Promise<void> => {
    const staged = Object.entries(this.draft) as [LoopFieldName, boolean][]
    if (staged.length === 0 || this.saving) return
    this.saving = true
    this.emit()
    let failed = false
    try {
      const ops = staged.map(([path, value]) => ({ op: 'set' as const, path: [path], value }))
      const accepted = await this.scope.mutate(ops, this.baselineRevision)
      if (accepted !== true) failed = true
    } catch {
      // 传输失败：controller 已做恢复重读，下面按快照逐字段判定。
      failed = true
    }
    if (!failed) {
      const committed = this.scope.getSnapshot().value ?? {}
      for (const [field, value] of staged) {
        if (committed[field] !== value) failed = true
      }
    }
    this.saving = false
    this.draft = {}
    this.baselineRevision = undefined
    this.failed = failed
    this.emit()
  }
}

/** 设置卡片注入面：快照 store + 暂存表单动作（按字段）。store 面即
 * `{ getSnapshot, subscribe }`（平台快照契约，槽渲染方以 useSyncExternalStore
 * 消费）。 */
export interface LoopSettingsInjected {
  hooks: {
    loopSettings: {
      getSnapshot: () => LoopSettingsCardState
      subscribe: (listener: () => void) => () => void
    }
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
 * 插件包页的配置卡片（官方 `plugins.bundle.config` keyed 槽；key = bundle 包名
 * `@vlln/dsh-loop`，卡片渲染在 Plugins 页本 bundle 包页的描述与行清单之间）。
 * 页面只请求 `page` 视图——chrome（图标/标题/描述/面包屑）由包页画，本组件只画
 * 字段区与自己的保存脚注。每个工具一行官方质感 Switch（LOOP_TOOL_FIELDS 表驱动）；
 * 写库走 ctx.configForms 传输（命名空间 = 条目 id `dsh-loop`），Node half 订阅
 * `loader/volatile-update` 按工具表动态注册/注销工具，保存后新会话立即生效。
 */
export function LoopSettingsCard(
  props: PropsRuntime<'plugins.bundle.config'> & PropsLocale<'settings.loop'> & InjectFace<LoopSettingsInjected>,
): ReactNode {
  // hooks 先于视图分支：summary 与 page 两处渲染共用同一钩子序列（React 钩子顺序稳定）。
  const { t } = props
  const state = props.useLoopSettings((s) => s)
  if (props.view === 'summary') return t('description')
  if (!state.available) return null
  const disabled = !state.writable
  const blocked = !state.dirty || state.saving

  return (
    <div
      data-loop-settings-card=""
      style={{ display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}
    >
      {disabled ? <p style={{ margin: '0 0 8px', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }} role="status">{t('readOnly')}</p> : null}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 0', gap: 0 }}>
        {LOOP_TOOL_FIELDS.map(({ path, title, hint }, index) => {
          const row = state.fields[path] ?? { checked: true }
          return (
            <div
              key={path}
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
                onChange={(checked) => { props.edit(path, checked) }}
              />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
        {state.failed
          ? <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' }} role="status">{t('saveFailed')}</p>
          : state.dirty
            ? (
              <span
                style={{
                  flex: 1, borderRadius: 999, padding: '1px 8px', fontSize: 11, lineHeight: '17px',
                  fontWeight: 500, whiteSpace: 'nowrap', background: 'var(--dsw-alias-bg-module-platform)',
                  color: 'var(--dsw-alias-label-secondary)',
                }}
              >
                {t('unsaved')}
              </span>
            )
            : <span style={{ flex: 1 }} />}
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
}

/** 本插件宿主命令的名字（与 Node half `ctx.commands.register({ name: 'loop' })` 同源）。 */
const COMMAND_NAME = 'loop'

/** 候选行里本插件要重写的字段（其余字段原样透传）。 */
interface CommandRow {
  readonly name?: string
  readonly label?: string
  readonly icon?: unknown
}

/** 菜单行标题的取值面：`ctx.locale.bind(NS)` 每次候选合成现取当前语言。 */
type RowLabel = (key: 'cmd.label') => string

/**
 * 候选合成出口的最小面：`ui-commands` 把 `/` 源注册成
 * `candidates: (session, req) => this.candidates(session, req)`（调用时才解引用），
 * 因此在实例上覆盖该方法即可介入候选行。
 */
interface CommandUiRowFace {
  candidates?: (session: unknown, req: unknown) => Promise<readonly CommandRow[]>
}

/**
 * 给本插件的**宿主命令**行贴图标 + 本地化标题；返回还原函数。
 *
 * 为什么需要这一步：官方把宿主命令行在 `/` 菜单里的外观（label / description /
 * icon）锁在 `dsh-client-ui-commands` 的 `presentation.ts`——一张硬编码的一等公民
 * 表 `HOST_FACES`，只列 goal / plan / feedback / compact / permission / export
 * 六个，按 `definitionId` 命中；`CommandDescriptor` 本身没有 label / icon 字段。
 * 第三方宿主命令没有官方入口拿这两项：同名注册客户端贡献会在候选合成阶段 fail loud
 * （`contribution /loop collides with a host command`，整组「指令」一起消失），
 * `commandUi.decorate` 只换裸调用行为、不换行外观。
 *
 * 补 `label` 的理由：宿主行合成时只带 name + description（+ input.hint），菜单标题
 * 按 `label ?? name` 回退，所以裸名 `loop` 会直接显示。注意贴面发生在 `candidates`
 * 输出上，而 `rankByName` 在服务内部、贴面之前就跑完了——所以这里补的 label 只修
 * 显示，不会让 `/循环` 命中 `/loop`；本地化搜索只属于客户端自有命令/源。
 * description 由 Node half 随 `?lang=` 重注册，不在客户端重抄；hint 是 claim 态
 * ghost text，不在菜单行渲染；section 由 sectionRows 统一加「指令」，这里不要写。
 *
 * 只在候选合成出口包一层，**只重写本插件那一行**：不碰命令目录、不碰派发、不碰
 * 命令生命周期，不新增命令、不写 DOM、不引 timer。前提任一不成立（服务缺席、上游把
 * `candidates` 改名或私有化、导出不是函数）就返回空还原器——包装不生效，该行自动
 * 回落到官方回退外观（name + 宿主 description，无图标），功能不受影响。
 */
function installCommandRowFace(commandUi: unknown, t: RowLabel): () => void {
  const runtime = commandUi as CommandUiRowFace | undefined
  const original = runtime?.candidates
  if (runtime === undefined || typeof original !== 'function') return () => {}
  const face = async (session: unknown, req: unknown): Promise<readonly CommandRow[]> => {
    const rows = await original.call(runtime, session, req)
    // 只改自己那一行；官方行与其他插件的行保持原内容不变。label 每次候选合成
    // 现取，切界面语言后下一次打开菜单即生效。
    return rows.map(row => (row?.name === COMMAND_NAME
      ? { ...row, label: t('cmd.label'), icon: IconRefreshOutlineRegular }
      : row))
  }
  runtime.candidates = face
  return () => {
    if (runtime.candidates === face) runtime.candidates = original
  }
}

/** 需要此插件声明的服务：slots（槽注册）+ locale（文案）+ configForms（设置读写传输）。 */
export const inject = ['slots', 'locale', 'configForms']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'loop: dictionaries')
  ctx.effect(() => ctx.locale.register(settingsNS, { zh: zhSettings, en: enSettings }), 'loop: settings dictionaries')
  // 菜单行标题的翻译器：bind 返回稳定引用，调用时读当前 active，所以候选合成里
  // 现取即可跟随语言切换（与组件内的 props.t 同一份字典）。
  const t = ctx.locale.bind(NS)
  // 语言回传：把 ctx.locale 的当前 active 记进回传源（见 relayLanguage）。语言翻转时
  // 通知已挂载的轮询就地重发一次，Node half 的用户可见文案随之下一次回执即切语言。
  ctx.effect(() => {
    const relay = (): void => { relayLanguage(ctx.locale.getSnapshot().active) }
    relay()
    return ctx.locale.subscribe(relay)
  }, 'loop: UI language relay')
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

  // 配置卡片（官方 plugins.bundle.config keyed 槽，渲染在 Plugins 页本 bundle 的
  // 包页）：key = bundle 包名；传输走 ctx.configForms.get(条目 id)（官方
  // ConfigFormController，revision-fenced 写，语义见 LoopSettingsForm）。
  // 注册经 configForms.whileServed([条目 id])：宿主 describe 里没有该命名空间时
  // 不留空配置区，离开后自动移除；slots.inject 另等槽声明（插件管理页挂载）。
  const scope = ctx.configForms.get(SETTINGS_NAMESPACE)
  const loopForm = new LoopSettingsForm(scope)
  ctx.effect(() => () => { loopForm.dispose() }, 'loop: settings form subscription')
  ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () =>
    ctx.slots.inject('plugins.bundle.config', () =>
      ctx.slots.register({
        name: 'plugins.bundle.config',
        key: BUNDLE_PACKAGE,
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
      }, LoopSettingsCard))), 'loop: settings card')

  // `/loop` 在 `/` 菜单里的行外观（图标 + 本地化标题）。宿主命令没有官方行外观
  // 入口，只能在候选合成出口贴面（理由与降级契约见 installCommandRowFace）。走嵌套
  // `ctx.inject`：没有命令目录的 composition（服务缺席）里这段代码永不执行。
  ctx.inject(['commandUi'], (commandScope) => {
    commandScope.effect(
      () => installCommandRowFace(commandScope.get('commandUi'), t),
      'loop: command row face',
    )
  })
}
