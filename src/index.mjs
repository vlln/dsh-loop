// vlln/loop — 定时循环插件：/loop 命令 + loop 工具，按间隔向当前 agent
// 重复投递 prompt（每轮 = agent.followup 排队一次新 turn，与 goal-session
// 同机制）。对齐 Claude Code 的 /loop 语义：固定间隔 / 自调节（模型每轮
// 可用工具调整或停止）/ 内置维护 prompt。
//
// 派发节奏：下一轮排在「上次派发 + interval」的网格上，任务耗时不会让网格
// 漂移；到点时 agent 仍在跑（本轮任务超过了 interval）则该轮挂起，等本轮
// 结束立刻派发一次——只补一次，不按错过的 tick 数连发。
//
// 边界：会话作用域——循环活在当前 harness 进程，随进程退出消失，不跨重启
// 持久化（与 Claude Code /loop 一致）。client half 经 conversation.input.dock
// 槽显示活动 loop 状态条（与官方 goal / task-status 同一 dock 家族），数据
// 由本文件注册的只读路由提供，该路由同时承载浏览器侧语言回传（`?lang=`，
// 供本文件的用户可见文案选语言，见 COMMAND_COPY）。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

const PLUGIN_ID = 'dsh-loop'

/**
 * 循环投递消息的来源标识（消息 source kind，生产者自有的合并式词表）。
 * 0.1 的 `{ kind: 'plugin', plugin }` 已退役：v4 会话格式拒绝 `kind: 'plugin'`
 * （消息落盘/重载时报「requires a producer-owned source kind」），旧日志由
 * 迁移器改写成 `plugin:${plugin}`——故沿用同一字面量保持新旧日志同源。
 */
const LOOP_SOURCE_KIND = `plugin:${PLUGIN_ID}`

/** client half 轮询的活动 loop 列表路由（与 client/index.tsx 的 LOOPS_PATH 一致）。 */
export const LOOPS_PATH = '/plugins/dsh-loop/loops'

/**
 * 设置命名空间 = 声明 `Config` schema 的条目 id（= cordis.patch.yml 的 insert
 * 条目 id）。用户可在设置页（client half 注册进官方 plugins.bundle.config 槽的
 * 「dsh-loop」包页卡片）选择是否把插件工具注入模型工具集。
 */
export const LOOP_SETTINGS_NAMESPACE = 'dsh-loop'

/** 设置默认值（消费端唯一权威；schema default 与 readConfig 补缺同源）。 */
export const LOOP_SETTINGS_DEFAULTS = Object.freeze({
  loop: true,
})

/**
 * 用户可写设置（保存即生效，无需重启：宿主把标了 `.volatile()` 的叶换成实时
 * 引用原地提交，**不重挂载**条目，随后发 `loader/volatile-update`；本插件重读
 * 快照并按工具表动态注册/注销各工具。工具 schemas 在每次会话组装与每轮 prompt
 * 组装时实时解析当前全局工具层，没有按 session 快照——因此新会话立即生效，
 * 存量会话的下一轮同样读到新工具集；开→关方向会让在飞会话的模型下一轮起看不到
 * 对应工具（工具调用记录无法对账的代价，已在 README 说明取舍）。`/loop` 命令
 * （用户侧）不受此开关影响。）
 * 字段名 = 注入模型工具集的插件工具名（与下方 toolDefinitions 的 key、client
 * half 的 LOOP_TOOL_FIELDS 三处同源）；`false` = 该工具从 agent 的
 * `tools.schemas` 中消失（模型看不到、调不动）。设置页每个工具一个官方
 * 质感的 Switch，工卡内附详细工具说明。
 */
export function buildSettingsSchema() {
  return z.object({
    loop: z.boolean().default(LOOP_SETTINGS_DEFAULTS.loop).volatile(),
  })
}

/** 条目 Config：宿主按它校验条目 config，并把 volatile 叶注入 apply 的 config。 */
export const Config = buildSettingsSchema()

/** 保持既有导出面（同一条 Config schema 实例）。 */
export const LOOP_SETTINGS_SCHEMA = Config

/** volatile 叶引用（宿主 createVolatile 注入：冻结对象、唯一自有键 get）。 */
function isConfigRef(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof value.get === 'function' && Object.keys(value).length === 1
}

/** 解引用：volatile 叶取当前值；数组/普通对象递归。 */
function unwrap(value) {
  if (isConfigRef(value)) return unwrap(value.get())
  if (Array.isArray(value)) return value.map(unwrap)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrap(child)]))
}

/** 读配置快照：解引用 volatile 叶 + 与默认值合并补缺。 */
export function readSettings(config) {
  const next = unwrap(config ?? {})
  return { ...LOOP_SETTINGS_DEFAULTS, ...(next !== null && typeof next === 'object' ? next : {}) }
}

// 内置维护 prompt（bare `/loop` 用），对齐 Claude Code 文档描述的三件事。
const MAINTENANCE_PROMPT = [
  '这是 loop 维护轮次。按顺序处理：',
  '1. 继续会话中未完成的工作；',
  '2. 照看当前分支的 pull request（评审意见、失败 CI、合并冲突）；',
  '3. 无待办时做一次小的清理（修一个 flaky test、删一条过时注释）。',
  '不要发起范围外的新事项。完成后用 loop 工具停止，或按需要调整间隔。',
].join('\n')

/** 解析 `5m`/`30s`/`1h`/`2d` 或裸数字（分钟）；无法解析返回 null。 */
function parseIntervalMs(raw) {
  const match = /^(\d+)([smhd])?$/.exec(raw.trim())
  if (match === null) return null
  const value = Number(match[1])
  const unit = match[2] ?? 'm'
  const seconds = { s: 1, m: 60, h: 3600, d: 86400 }[unit]
  return value * seconds * 1000
}

/** 人类可读间隔（用于命令回显）。 */
function formatInterval(ms) {
  const minutes = ms / 60000
  if (minutes >= 1440) return `${minutes / 1440}d`
  if (minutes >= 60) return `${minutes / 60}h`
  if (minutes >= 1) return `${minutes}m`
  return `${ms / 1000}s`
}

/**
 * Node half 的界面语言：宿主没有 locale 服务（官方命令面板的中文来自客户端写死的
 * 官方命令表），语言偏好只存在于浏览器侧。所以语言由 client half 在既有的
 * /loops 轮询上回传（`?lang=`），这里只采纳白名单值；缺失、未知或非法类型一律
 * 忽略（该路由保持只读语义，不引入写面）。从未收到过回传时为 'en'——与官方命令
 * 一致，headless/CLI 场景输出稳定。
 */
const SUPPORTED_UI_LANGUAGES = ['zh', 'en']
const DEFAULT_UI_LANGUAGE = 'en'

/**
 * 用户可见文案（命令面板 description + 命令回执）。模型面文案不在此表：工具
 * description、注入会话的维护 prompt 等保持英文。
 */
const COMMAND_COPY = {
  en: {
    description: 'Run prompts on a schedule (multiple loops per session): /loop [interval] <prompt> | /loop stop [id] | /loop list',
    emptyUsage: [
      'No active loop.',
      'Usage: /loop [interval] <prompt> — e.g. /loop 5m check the deploy',
      'Bare /loop runs the built-in maintenance prompt.',
      'Multiple loops may run in parallel; stop one with /loop stop <id>.',
    ].join('\n'),
    listRow: (loop) => `${loop.id}: every ${formatInterval(loop.intervalMs)} — ${loop.prompt}`,
    loopStopped: (id) => `Loop ${id} stopped.`,
    unknownLoop: (id) => `No active loop with id ${id}.`,
    stoppedMany: (count) => `Stopped ${count} loop${count > 1 ? 's' : ''}.`,
    nothingToStop: 'No active loop to stop.',
    nothingToClear: 'No active loop to clear.',
    started: (loop, intervalMs) => `${loop.id} started: every ${formatInterval(intervalMs)} — ${loop.prompt}`,
  },
  zh: {
    description: '按计划重复投递 prompt（同一会话可并行多个循环）：/loop [interval] <prompt> | /loop stop [id] | /loop list',
    emptyUsage: [
      '没有活动循环。',
      '用法：/loop [interval] <prompt> — 例如 /loop 5m 检查部署',
      '裸 /loop 使用内置维护 prompt。',
      '多个循环可并行；用 /loop stop <id> 停止其中一个。',
    ].join('\n'),
    listRow: (loop) => `${loop.id}：每 ${formatInterval(loop.intervalMs)} — ${loop.prompt}`,
    loopStopped: (id) => `循环 ${id} 已停止。`,
    unknownLoop: (id) => `没有 id 为 ${id} 的活动循环。`,
    stoppedMany: (count) => `已停止 ${count} 个循环。`,
    nothingToStop: '没有可停止的活动循环。',
    nothingToClear: '没有可清除的活动循环。',
    started: (loop, intervalMs) => `${loop.id} 已启动：每 ${formatInterval(intervalMs)} — ${loop.prompt}`,
  },
}

// 命名导出（cordis 插件模块形态；宿主 describe 经 loader.unwrapExports 取
// 模块面读 `Config`——有 default 时只看 default，故不设 default 导出）。
export const name = 'loop'
// agents 定位/校验当前 agent；commands 注册 /loop；tools 注册 loop 工具；
// timer 提供 ctx.interval（生命周期管理的定时器）；webServer 提供只读
// 状态路由（client half 轮询）。
export const inject = ['agents', 'commands', 'tools', 'timer', 'webServer']

export function apply(ctx, config) {
    // loopId -> { id, agent, prompt, intervalMs, lastDeliveredAt, dispose }
    // 一个 agent 可同时持有多个 loop（loopId = `loop-<N>` 全局递增）。
    const loops = new Map()
    let loopSeq = 0
    // 设置快照（apply 的第二个参数 = 宿主校验后的条目 config；volatile 叶是实时
    // 引用，每次重读解引用取最新值，别缓存引用本身）。
    let settings = readSettings(config)

    // 界面语言（见模块头的语言契约）：只有白名单回传才改变它。命令面板的
    // description 是静态字符串，语言翻转只能整条重注册——这是本插件语言回传
    // 触发的唯一注册面动作（dock/设置卡/工具注册都不受影响）。
    let uiLanguage = DEFAULT_UI_LANGUAGE
    const copy = () => COMMAND_COPY[uiLanguage] ?? COMMAND_COPY[DEFAULT_UI_LANGUAGE]
    let disposeLoopCommand = null
    const registerLoopCommand = () => {
      disposeLoopCommand = ctx.commands.register({
        name: 'loop',
        description: copy().description,
        // 语言中性：保持原样（不随语言变化）。
        input: { hint: '[interval] <prompt>' },
        handler: (invocation) => {
          const raw = invocation.rawInput.trim()
          if (raw === '' || raw === 'list') {
            const active = agentLoops(invocation.agent)
            if (active.length === 0) {
              return { kind: 'success', text: copy().emptyUsage }
            }
            return {
              kind: 'success',
              text: active.map(loop => copy().listRow(loop)).join('\n'),
            }
          }
          // stop [id]：停指定 loop（限本 agent），无 id 停全部。
          const stopMatch = /^stop(?:\s+(\S+))?$/.exec(raw)
          if (stopMatch !== null) {
            const target = stopMatch[1]?.trim()
            if (target !== undefined) {
              const hit = agentLoops(invocation.agent).find(loop => loop.id === target)
              return hit !== undefined && stopLoop(hit.id)
                ? { kind: 'success', text: copy().loopStopped(target) }
                : { kind: 'error', text: copy().unknownLoop(target) }
            }
            const stopped = stopAgentLoops(invocation.agent)
            return stopped > 0
              ? { kind: 'success', text: copy().stoppedMany(stopped) }
              : { kind: 'error', text: copy().nothingToStop }
          }
          if (raw === 'clear') {
            const stopped = stopAgentLoops(invocation.agent)
            return stopped > 0
              ? { kind: 'success', text: copy().stoppedMany(stopped) }
              : { kind: 'error', text: copy().nothingToClear }
          }
          // 前导 token 是间隔则剥掉，否则用默认 1 分钟（模型每轮可用工具调整）。
          const tokens = raw.split(/\s+/)
          const intervalMs = parseIntervalMs(tokens[0])
          const prompt = intervalMs === null ? raw : tokens.slice(1).join(' ')
          const state = startLoop(invocation.agent, prompt, intervalMs ?? 60_000)
          return {
            kind: 'success',
            text: copy().started(state, intervalMs ?? 60_000),
          }
        },
      })
    }
    registerLoopCommand()

    /**
     * 采纳一次语言回传；返回语言是否变化。非白名单值（含非字符串/缺失）不改变
     * 状态——该路由是只读语义，任何输入都不得引起抛错或状态污染。
     */
    const adoptUiLanguage = (raw) => {
      if (typeof raw !== 'string' || !SUPPORTED_UI_LANGUAGES.includes(raw)) return false
      if (raw === uiLanguage) return false
      uiLanguage = raw
      return true
    }

    // client half 轮询的活动 loop 列表：按 sessionId 过滤（state.agent.id === sessionId），
    // 并顺带回传浏览器侧语言（`?lang=`，非白名单忽略）。GET 读列表回显当前语言
    // （向后兼容的加法字段）；POST 停指定 loop（body {id}）——状态条停止按钮走此端点。
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: LOOPS_PATH,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://dsh.internal')
          const method = (req.method ?? 'GET').toUpperCase()
          if (method === 'POST') {
            let body = ''
            for await (const chunk of req) body += String(chunk)
            let id = ''
            try {
              id = String((JSON.parse(body) ?? {}).id ?? '').trim()
            } catch {
              // 非 JSON body → 视为空 id（下面 400）。
            }
            if (id === '') {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ error: 'stop needs a loop id' }))
              return
            }
            const stopped = stopLoop(id)
            res.writeHead(stopped ? 200 : 404, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: stopped, id }))
            return
          }
          const sessionId = url.searchParams.get('sessionId') ?? ''
          // 语言回传：采纳白名单值；翻转时重注册命令（description 以当前语言为准）。
          if (adoptUiLanguage(url.searchParams.get('lang'))) {
            disposeLoopCommand?.()
            registerLoopCommand()
          }
          const now = Date.now()
          const rows = []
          for (const [loopId, state] of loops) {
            if (sessionId !== '' && state.agent.id !== sessionId) continue
            const nextTick = state.lastDeliveredAt === undefined
              ? now
              : state.lastDeliveredAt + state.intervalMs
            rows.push({
              id: loopId,
              agentId: state.agent.id,
              prompt: state.prompt,
              intervalMs: state.intervalMs,
              intervalText: formatInterval(state.intervalMs),
              nextTickAt: nextTick,
            })
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          // uiLanguage 是加法字段：现有消费者只读 loops，多一个字段无影响。
          res.end(JSON.stringify({ loops: rows, uiLanguage }))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: message }))
        }
      },
    }), 'loop: status + stop route')

    /** 停一个指定 loop；返回是否停到。 */
    function stopLoop(loopId) {
      const state = loops.get(loopId)
      if (state === undefined) return false
      state.dispose()
      loops.delete(loopId)
      return true
    }

    /** 停一个 agent 的全部 loop；返回停掉的数量。 */
    function stopAgentLoops(agent) {
      let stopped = 0
      for (const [loopId, state] of [...loops]) {
        if (state.agent !== agent) continue
        state.dispose()
        loops.delete(loopId)
        stopped += 1
      }
      return stopped
    }

    /** 该 agent 的全部活动 loop。 */
    function agentLoops(agent) {
      return [...loops.values()].filter(state => state.agent === agent)
    }

    function startLoop(agent, prompt, intervalMs) {
      const id = `loop-${++loopSeq}`
      const state = {
        id,
        agent,
        prompt,
        intervalMs,
        lastDeliveredAt: undefined,
        // 网格 tick 撞上 agent 忙（本轮任务耗时超过 interval）时置位：
        // agent 一回到 idle 立刻补投一次；只补一次，错过的多个 tick 不连发。
        pending: false,
        timer: undefined,
        deliver: undefined,
        dispose: undefined,
      }

      /** 投递一轮，并把下一次网格 tick 重排到「本次派发 + interval」。 */
      function dispatch() {
        state.pending = false
        state.lastDeliveredAt = Date.now()
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: state.prompt }],
          source: { kind: LOOP_SOURCE_KIND },
        }))
        armNext()
      }

      /**
       * 排下一次网格 tick：下次 = max(上次派发 + interval, now)。
       * 用 ctx.timeout 自排而非 ctx.interval 固定周期——补投会挪动相位，
       * 固定周期会把补投之后的格子重新钉回旧网格。
       */
      function armNext() {
        clearTimer()
        const at = (state.lastDeliveredAt ?? Date.now()) + state.intervalMs
        /** 网格到点：空闲则派发；忙则挂起，并排一次兜底检查。 */
        function check() {
          state.timer = undefined
          if (ctx.agents.get(agent.id) !== agent) {
            stopLoop(id)
            return
          }
          // 忙 = 本轮任务到点还没跑完：挂起本轮（不入队、不连发）。
          // 正常路径由 agent/status 监听器在 idle 时立即补投；这里再排一次
          // 兜底检查，事件万一漏掉也不会让循环永久冻结。不会连发：补投只有
          // dispatch 一条出口，且 dispatch 会重排网格。
          if (agent.status !== 'idle') {
            state.pending = true
            state.timer = ctx.timeout(check, state.intervalMs)
            return
          }
          dispatch()
        }

        state.timer = ctx.timeout(check, Math.max(0, at - Date.now()))
      }

      function clearTimer() {
        if (state.timer === undefined) return
        state.timer()
        state.timer = undefined
      }

      state.deliver = dispatch
      state.dispose = clearTimer
      // 先把网格排上（工具路径 agent 忙、首轮此刻投不出去时的兜底），
      // 若此刻空闲则立即投第一轮（对齐 Claude Code /loop「立即开始 + 周期重复」）。
      armNext()
      if (ctx.agents.get(agent.id) === agent && agent.status === 'idle') dispatch()
      loops.set(id, state)
      return state
    }

    // 任务跑超 interval 时的补投：agent 一回到 idle 立刻派发挂起的那一轮。
    // 状态迁移由 agent 的 setPhase 同步发出（dsh-agent-loop 的 agent/status），
    // 因此这里跟着 agent 的结束时刻走，而不是等到下一个网格 tick。
    ctx.on('agent/status', (payload) => {
      if (payload?.status !== 'idle') return
      const agent = payload.agent
      if (agent === undefined) return
      for (const state of [...loops.values()]) {
        if (state.agent !== agent || !state.pending) continue
        if (ctx.agents.get(agent.id) !== agent) continue
        state.deliver()
      }
    })

    // agent 销毁时清理其全部循环，防止 Map 泄漏与对已死 agent 的定时投递。
    // payload 形如 { agent }（0.1 曾直接传 agent 对象）。
    ctx.on('agent/disposed', (payload) => {
      stopAgentLoops(payload.agent)
    })

    /** 工具：模型自调节入口（start/stop/status/list）。设置页可按工具开关——
     * 见 LOOP_SETTINGS_SCHEMA：宿主原地提交 volatile 叶后发 `loader/volatile-update`，
     * 此处重读快照并按 toolDefinitions 表动态注册/注销对应工具，保存即对新会话
     * 生效（无需重启进程）。关闭后 agent 的 tools.schemas 中没有该工具（模型
     * 看不到、调不动），/loop 命令与状态路由照常（用户侧能力）。 */
    // 工具定义表：key = LOOP_SETTINGS_SCHEMA 的字段名 = 工具注册名。新增
    // 工具 = 在此加一条，并在 client half 的 LOOP_TOOL_FIELDS 同步加一行
    // 设置卡片字段（设置页每个工具独立开关）。
    const toolDefinitions = {
      loop: defineTool({
        name: 'loop',
        description: 'Start, stop, or inspect scheduled loops on the current agent. '
          + 'Multiple loops may run in parallel; start creates a new one each time. '
          + 'A loop re-delivers a prompt every interval; use it for polling, PR babysitting, '
          + 'or build-fix-test cycles. The model may adjust the interval or stop the loop '
          + 'each round, which is the self-paced mode.',
        parameters: {
          action: { type: 'string', required: true },
          prompt: { type: 'string' },
          interval: { type: 'string' },
          loop_id: { type: 'string' },
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        execute: async (args) => {
          // 工具在 agent turn 内执行：当前发起者即循环的宿主。
          const agent = ctx.agents.currentInitiator()
          if (agent === undefined) throw new Error('loop tool requires an active agent turn')
          switch (args.action) {
            case 'start': {
              if (typeof args.prompt !== 'string' || args.prompt.length === 0) {
                throw new Error('loop start needs a prompt')
              }
              const intervalMs = typeof args.interval === 'string'
                ? (parseIntervalMs(args.interval) ?? 60_000)
                : 60_000
              const state = startLoop(agent, args.prompt, intervalMs)
              return `${state.id} started: every ${formatInterval(intervalMs)} — ${args.prompt}`
            }
            case 'stop': {
              const target = typeof args.loop_id === 'string' ? args.loop_id : undefined
              if (target !== undefined) {
                const hit = agentLoops(agent).find(s => s.id === target)
                return hit !== undefined && stopLoop(hit.id)
                  ? `loop ${target} stopped`
                  : `no active loop with id ${target}`
              }
              const stopped = stopAgentLoops(agent)
              return stopped > 0 ? `stopped ${stopped} loop${stopped > 1 ? 's' : ''}` : 'no active loop'
            }
            case 'status':
            case 'list': {
              const active = agentLoops(agent)
              return active.length === 0
                ? 'no active loop'
                : active.map(s => `${s.id}: every ${formatInterval(s.intervalMs)} — ${s.prompt}`).join('\n')
            }
            default:
              throw new Error(`unknown loop action: ${String(args.action)}`)
          }
        },
      }),
    }
    const loopToolDisposers = new Map()
    const applyLoopTools = () => {
      for (const [name, definition] of Object.entries(toolDefinitions)) {
        const enabled = settings[name] !== false
        if (enabled && !loopToolDisposers.has(name)) {
          loopToolDisposers.set(name, ctx.tools.register(definition))
        } else if (!enabled && loopToolDisposers.has(name)) {
          loopToolDisposers.get(name)()
          loopToolDisposers.delete(name)
        }
      }
    }
    applyLoopTools()
    // 配置热更新：宿主原地提交 volatile 叶（不重挂载）后重读快照，按最新值重算
    // 注册/注销（幂等 no-op：值未变的工具不动）。
    ctx.effect(() => ctx.on('loader/volatile-update', () => {
      settings = readSettings(config)
      applyLoopTools()
    }), 'loop: tool exposure settings')
}
