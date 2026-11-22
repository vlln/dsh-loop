import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
//#region src/index.mjs
/**
* 循环投递消息的来源标识（消息 source kind，生产者自有的合并式词表）。
* 0.1 的 `{ kind: 'plugin', plugin }` 已退役：v4 会话格式拒绝 `kind: 'plugin'`
* （消息落盘/重载时报「requires a producer-owned source kind」），旧日志由
* 迁移器改写成 `plugin:${plugin}`——故沿用同一字面量保持新旧日志同源。
*/
const LOOP_SOURCE_KIND = `plugin:dsh-loop`;
/** client half 轮询的活动 loop 列表路由（与 client/index.tsx 的 LOOPS_PATH 一致）。 */
const LOOPS_PATH = "/plugins/dsh-loop/loops";
/**
* 设置命名空间 = 声明 `Config` schema 的条目 id（= cordis.patch.yml 的 insert
* 条目 id）。用户可在设置页（client half 注册进官方 plugins.bundle.config 槽的
* 「dsh-loop」包页卡片）选择是否把插件工具注入模型工具集。
*/
const LOOP_SETTINGS_NAMESPACE = "dsh-loop";
/** 设置默认值（消费端唯一权威；schema default 与 readConfig 补缺同源）。 */
const LOOP_SETTINGS_DEFAULTS = Object.freeze({ loop: true });
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
function buildSettingsSchema() {
	return z.object({ loop: z.boolean().default(LOOP_SETTINGS_DEFAULTS.loop).volatile() });
}
/** 条目 Config：宿主按它校验条目 config，并把 volatile 叶注入 apply 的 config。 */
const Config = buildSettingsSchema();
/** 保持既有导出面（同一条 Config schema 实例）。 */
const LOOP_SETTINGS_SCHEMA = Config;
/** volatile 叶引用（宿主 createVolatile 注入：冻结对象、唯一自有键 get）。 */
function isConfigRef(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) && typeof value.get === "function" && Object.keys(value).length === 1;
}
/** 解引用：volatile 叶取当前值；数组/普通对象递归。 */
function unwrap(value) {
	if (isConfigRef(value)) return unwrap(value.get());
	if (Array.isArray(value)) return value.map(unwrap);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrap(child)]));
}
/** 读配置快照：解引用 volatile 叶 + 与默认值合并补缺。 */
function readSettings(config) {
	const next = unwrap(config ?? {});
	return {
		...LOOP_SETTINGS_DEFAULTS,
		...next !== null && typeof next === "object" ? next : {}
	};
}
[
	"这是 loop 维护轮次。按顺序处理：",
	"1. 继续会话中未完成的工作；",
	"2. 照看当前分支的 pull request（评审意见、失败 CI、合并冲突）；",
	"3. 无待办时做一次小的清理（修一个 flaky test、删一条过时注释）。",
	"不要发起范围外的新事项。完成后用 loop 工具停止，或按需要调整间隔。"
].join("\n");
/** 解析 `5m`/`30s`/`1h`/`2d` 或裸数字（分钟）；无法解析返回 null。 */
function parseIntervalMs(raw) {
	const match = /^(\d+)([smhd])?$/.exec(raw.trim());
	if (match === null) return null;
	return Number(match[1]) * {
		s: 1,
		m: 60,
		h: 3600,
		d: 86400
	}[match[2] ?? "m"] * 1e3;
}
/** 人类可读间隔（用于命令回显）。 */
function formatInterval(ms) {
	const minutes = ms / 6e4;
	if (minutes >= 1440) return `${minutes / 1440}d`;
	if (minutes >= 60) return `${minutes / 60}h`;
	if (minutes >= 1) return `${minutes}m`;
	return `${ms / 1e3}s`;
}
/**
* Node half 的界面语言：宿主没有 locale 服务（官方命令面板的中文来自客户端写死的
* 官方命令表），语言偏好只存在于浏览器侧。所以语言由 client half 在既有的
* /loops 轮询上回传（`?lang=`），这里只采纳白名单值；缺失、未知或非法类型一律
* 忽略（该路由保持只读语义，不引入写面）。从未收到过回传时为 'en'——与官方命令
* 一致，headless/CLI 场景输出稳定。
*/
const SUPPORTED_UI_LANGUAGES = ["zh", "en"];
const DEFAULT_UI_LANGUAGE = "en";
/**
* 用户可见文案（命令面板 description + 命令回执）。模型面文案不在此表：工具
* description、注入会话的维护 prompt 等保持英文。
*/
const COMMAND_COPY = {
	en: {
		description: "Run prompts on a schedule (multiple loops per session): /loop [interval] <prompt> | /loop stop [id] | /loop list",
		emptyUsage: [
			"No active loop.",
			"Usage: /loop [interval] <prompt> — e.g. /loop 5m check the deploy",
			"Bare /loop runs the built-in maintenance prompt.",
			"Multiple loops may run in parallel; stop one with /loop stop <id>."
		].join("\n"),
		listRow: (loop) => `${loop.id}: every ${formatInterval(loop.intervalMs)} — ${loop.prompt}`,
		loopStopped: (id) => `Loop ${id} stopped.`,
		unknownLoop: (id) => `No active loop with id ${id}.`,
		stoppedMany: (count) => `Stopped ${count} loop${count > 1 ? "s" : ""}.`,
		nothingToStop: "No active loop to stop.",
		nothingToClear: "No active loop to clear.",
		started: (loop, intervalMs) => `${loop.id} started: every ${formatInterval(intervalMs)} — ${loop.prompt}`
	},
	zh: {
		description: "按计划重复投递 prompt（同一会话可并行多个循环）：/loop [interval] <prompt> | /loop stop [id] | /loop list",
		emptyUsage: [
			"没有活动循环。",
			"用法：/loop [interval] <prompt> — 例如 /loop 5m 检查部署",
			"裸 /loop 使用内置维护 prompt。",
			"多个循环可并行；用 /loop stop <id> 停止其中一个。"
		].join("\n"),
		listRow: (loop) => `${loop.id}：每 ${formatInterval(loop.intervalMs)} — ${loop.prompt}`,
		loopStopped: (id) => `循环 ${id} 已停止。`,
		unknownLoop: (id) => `没有 id 为 ${id} 的活动循环。`,
		stoppedMany: (count) => `已停止 ${count} 个循环。`,
		nothingToStop: "没有可停止的活动循环。",
		nothingToClear: "没有可清除的活动循环。",
		started: (loop, intervalMs) => `${loop.id} 已启动：每 ${formatInterval(intervalMs)} — ${loop.prompt}`
	}
};
const name = "loop";
const inject = [
	"agents",
	"commands",
	"tools",
	"timer",
	"webServer"
];
function apply(ctx, config) {
	const loops = /* @__PURE__ */ new Map();
	let loopSeq = 0;
	let settings = readSettings(config);
	let uiLanguage = DEFAULT_UI_LANGUAGE;
	const copy = () => COMMAND_COPY[uiLanguage] ?? COMMAND_COPY[DEFAULT_UI_LANGUAGE];
	let disposeLoopCommand = null;
	const registerLoopCommand = () => {
		disposeLoopCommand = ctx.commands.register({
			name: "loop",
			description: copy().description,
			input: { hint: "[interval] <prompt>" },
			handler: (invocation) => {
				const raw = invocation.rawInput.trim();
				if (raw === "" || raw === "list") {
					const active = agentLoops(invocation.agent);
					if (active.length === 0) return {
						kind: "success",
						text: copy().emptyUsage
					};
					return {
						kind: "success",
						text: active.map((loop) => copy().listRow(loop)).join("\n")
					};
				}
				const stopMatch = /^stop(?:\s+(\S+))?$/.exec(raw);
				if (stopMatch !== null) {
					const target = stopMatch[1]?.trim();
					if (target !== void 0) {
						const hit = agentLoops(invocation.agent).find((loop) => loop.id === target);
						return hit !== void 0 && stopLoop(hit.id) ? {
							kind: "success",
							text: copy().loopStopped(target)
						} : {
							kind: "error",
							text: copy().unknownLoop(target)
						};
					}
					const stopped = stopAgentLoops(invocation.agent);
					return stopped > 0 ? {
						kind: "success",
						text: copy().stoppedMany(stopped)
					} : {
						kind: "error",
						text: copy().nothingToStop
					};
				}
				if (raw === "clear") {
					const stopped = stopAgentLoops(invocation.agent);
					return stopped > 0 ? {
						kind: "success",
						text: copy().stoppedMany(stopped)
					} : {
						kind: "error",
						text: copy().nothingToClear
					};
				}
				const tokens = raw.split(/\s+/);
				const intervalMs = parseIntervalMs(tokens[0]);
				const prompt = intervalMs === null ? raw : tokens.slice(1).join(" ");
				const state = startLoop(invocation.agent, prompt, intervalMs ?? 6e4);
				return {
					kind: "success",
					text: copy().started(state, intervalMs ?? 6e4)
				};
			}
		});
	};
	registerLoopCommand();
	/**
	* 采纳一次语言回传；返回语言是否变化。非白名单值（含非字符串/缺失）不改变
	* 状态——该路由是只读语义，任何输入都不得引起抛错或状态污染。
	*/
	const adoptUiLanguage = (raw) => {
		if (typeof raw !== "string" || !SUPPORTED_UI_LANGUAGES.includes(raw)) return false;
		if (raw === uiLanguage) return false;
		uiLanguage = raw;
		return true;
	};
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: LOOPS_PATH,
		handler: async (req, res) => {
			try {
				const url = new URL(req.url ?? "/", "http://dsh.internal");
				if ((req.method ?? "GET").toUpperCase() === "POST") {
					let body = "";
					for await (const chunk of req) body += String(chunk);
					let id = "";
					try {
						id = String((JSON.parse(body) ?? {}).id ?? "").trim();
					} catch {}
					if (id === "") {
						res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
						res.end(JSON.stringify({ error: "stop needs a loop id" }));
						return;
					}
					const stopped = stopLoop(id);
					res.writeHead(stopped ? 200 : 404, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({
						ok: stopped,
						id
					}));
					return;
				}
				const sessionId = url.searchParams.get("sessionId") ?? "";
				if (adoptUiLanguage(url.searchParams.get("lang"))) {
					disposeLoopCommand?.();
					registerLoopCommand();
				}
				const now = Date.now();
				const rows = [];
				for (const [loopId, state] of loops) {
					if (sessionId !== "" && state.agent.id !== sessionId) continue;
					const nextTick = state.lastDeliveredAt === void 0 ? now : state.lastDeliveredAt + state.intervalMs;
					rows.push({
						id: loopId,
						agentId: state.agent.id,
						prompt: state.prompt,
						intervalMs: state.intervalMs,
						intervalText: formatInterval(state.intervalMs),
						nextTickAt: nextTick
					});
				}
				res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({
					loops: rows,
					uiLanguage
				}));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ error: message }));
			}
		}
	}), "loop: status + stop route");
	/** 停一个指定 loop；返回是否停到。 */
	function stopLoop(loopId) {
		const state = loops.get(loopId);
		if (state === void 0) return false;
		state.dispose();
		loops.delete(loopId);
		return true;
	}
	/** 停一个 agent 的全部 loop；返回停掉的数量。 */
	function stopAgentLoops(agent) {
		let stopped = 0;
		for (const [loopId, state] of [...loops]) {
			if (state.agent !== agent) continue;
			state.dispose();
			loops.delete(loopId);
			stopped += 1;
		}
		return stopped;
	}
	/** 该 agent 的全部活动 loop。 */
	function agentLoops(agent) {
		return [...loops.values()].filter((state) => state.agent === agent);
	}
	function startLoop(agent, prompt, intervalMs) {
		const id = `loop-${++loopSeq}`;
		const state = {
			id,
			agent,
			prompt,
			intervalMs,
			lastDeliveredAt: void 0,
			pending: false,
			timer: void 0,
			deliver: void 0,
			dispose: void 0
		};
		/** 投递一轮，并把下一次网格 tick 重排到「本次派发 + interval」。 */
		function dispatch() {
			state.pending = false;
			state.lastDeliveredAt = Date.now();
			agent.followup(createUserMessage({
				content: [{
					type: "text",
					text: state.prompt
				}],
				source: { kind: LOOP_SOURCE_KIND }
			}));
			armNext();
		}
		/**
		* 排下一次网格 tick：下次 = max(上次派发 + interval, now)。
		* 用 ctx.timeout 自排而非 ctx.interval 固定周期——补投会挪动相位，
		* 固定周期会把补投之后的格子重新钉回旧网格。
		*/
		function armNext() {
			clearTimer();
			const at = (state.lastDeliveredAt ?? Date.now()) + state.intervalMs;
			/** 网格到点：空闲则派发；忙则挂起，并排一次兜底检查。 */
			function check() {
				state.timer = void 0;
				if (ctx.agents.get(agent.id) !== agent) {
					stopLoop(id);
					return;
				}
				if (agent.status !== "idle") {
					state.pending = true;
					state.timer = ctx.timeout(check, state.intervalMs);
					return;
				}
				dispatch();
			}
			state.timer = ctx.timeout(check, Math.max(0, at - Date.now()));
		}
		function clearTimer() {
			if (state.timer === void 0) return;
			state.timer();
			state.timer = void 0;
		}
		state.deliver = dispatch;
		state.dispose = clearTimer;
		armNext();
		if (ctx.agents.get(agent.id) === agent && agent.status === "idle") dispatch();
		loops.set(id, state);
		return state;
	}
	ctx.on("agent/status", (payload) => {
		if (payload?.status !== "idle") return;
		const agent = payload.agent;
		if (agent === void 0) return;
		for (const state of [...loops.values()]) {
			if (state.agent !== agent || !state.pending) continue;
			if (ctx.agents.get(agent.id) !== agent) continue;
			state.deliver();
		}
	});
	ctx.on("agent/disposed", (payload) => {
		stopAgentLoops(payload.agent);
	});
	/** 工具：模型自调节入口（start/stop/status/list）。设置页可按工具开关——
	* 见 LOOP_SETTINGS_SCHEMA：宿主原地提交 volatile 叶后发 `loader/volatile-update`，
	* 此处重读快照并按 toolDefinitions 表动态注册/注销对应工具，保存即对新会话
	* 生效（无需重启进程）。关闭后 agent 的 tools.schemas 中没有该工具（模型
	* 看不到、调不动），/loop 命令与状态路由照常（用户侧能力）。 */
	const toolDefinitions = { loop: defineTool({
		name: "loop",
		description: "Start, stop, or inspect scheduled loops on the current agent. Multiple loops may run in parallel; start creates a new one each time. A loop re-delivers a prompt every interval; use it for polling, PR babysitting, or build-fix-test cycles. The model may adjust the interval or stop the loop each round, which is the self-paced mode.",
		parameters: {
			action: {
				type: "string",
				required: true
			},
			prompt: { type: "string" },
			interval: { type: "string" },
			loop_id: { type: "string" }
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: value
			}]
		},
		execute: async (args) => {
			const agent = ctx.agents.currentInitiator();
			if (agent === void 0) throw new Error("loop tool requires an active agent turn");
			switch (args.action) {
				case "start": {
					if (typeof args.prompt !== "string" || args.prompt.length === 0) throw new Error("loop start needs a prompt");
					const intervalMs = typeof args.interval === "string" ? parseIntervalMs(args.interval) ?? 6e4 : 6e4;
					return `${startLoop(agent, args.prompt, intervalMs).id} started: every ${formatInterval(intervalMs)} — ${args.prompt}`;
				}
				case "stop": {
					const target = typeof args.loop_id === "string" ? args.loop_id : void 0;
					if (target !== void 0) {
						const hit = agentLoops(agent).find((s) => s.id === target);
						return hit !== void 0 && stopLoop(hit.id) ? `loop ${target} stopped` : `no active loop with id ${target}`;
					}
					const stopped = stopAgentLoops(agent);
					return stopped > 0 ? `stopped ${stopped} loop${stopped > 1 ? "s" : ""}` : "no active loop";
				}
				case "status":
				case "list": {
					const active = agentLoops(agent);
					return active.length === 0 ? "no active loop" : active.map((s) => `${s.id}: every ${formatInterval(s.intervalMs)} — ${s.prompt}`).join("\n");
				}
				default: throw new Error(`unknown loop action: ${String(args.action)}`);
			}
		}
	}) };
	const loopToolDisposers = /* @__PURE__ */ new Map();
	const applyLoopTools = () => {
		for (const [name, definition] of Object.entries(toolDefinitions)) {
			const enabled = settings[name] !== false;
			if (enabled && !loopToolDisposers.has(name)) loopToolDisposers.set(name, ctx.tools.register(definition));
			else if (!enabled && loopToolDisposers.has(name)) {
				loopToolDisposers.get(name)();
				loopToolDisposers.delete(name);
			}
		}
	};
	applyLoopTools();
	ctx.effect(() => ctx.on("loader/volatile-update", () => {
		settings = readSettings(config);
		applyLoopTools();
	}), "loop: tool exposure settings");
}
//#endregion
export { Config, LOOPS_PATH, LOOP_SETTINGS_DEFAULTS, LOOP_SETTINGS_NAMESPACE, LOOP_SETTINGS_SCHEMA, apply, buildSettingsSchema, inject, name, readSettings };
