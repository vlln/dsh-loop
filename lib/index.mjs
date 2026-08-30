import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
//#region src/index.mjs
const PLUGIN_ID = "dsh-loop";
/** client half 轮询的活动 loop 列表路由（与 client/index.tsx 的 LOOPS_PATH 一致）。 */
const LOOPS_PATH = "/plugins/dsh-loop/loops";
/**
* 设置命名空间：用户可在设置页（client half 的 settings.plugin.item「dsh-loop」
* 卡片，位于 设置 → 插件 → 可配置）选择是否把插件工具注入模型工具集。
*/
const LOOP_SETTINGS_NAMESPACE = settingsNamespace("dsh-loop");
/**
* 用户可写设置（`applies: 'live'` —— 保存即生效，无需重启：Node half watch
* 本命名空间，每次提交后按工具表动态注册/注销各工具。工具 schemas 在每次
* 会话组装与每轮 prompt 组装时实时解析当前全局工具层，没有按 session 快照
* ——因此新会话立即生效，存量会话的下一轮同样读到新工具集；开→关方向会
* 让在飞会话的模型下一轮起看不到对应工具（工具调用记录无法对账的代价，
* 已在 README 说明取舍）。`/loop` 命令（用户侧）不受此开关影响。）
* 字段名 = 注入模型工具集的插件工具名（与下方 toolDefinitions 的 key、client
* half 的 LOOP_TOOL_FIELDS 三处同源）；`false` = 该工具从 agent 的
* `tools.schemas` 中消失（模型看不到、调不动）。设置页每个工具一个官方
* 质感的 Switch，工卡内附详细工具说明。
*/
const LOOP_SETTINGS_SCHEMA = z.object({ loop: z.boolean().default(true) });
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
var src_default = {
	name: "loop",
	inject: [
		"agents",
		"commands",
		"tools",
		"timer",
		"webServer"
	],
	apply(ctx) {
		const loops = /* @__PURE__ */ new Map();
		let loopSeq = 0;
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
					res.end(JSON.stringify({ loops: rows }));
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
				dispose: void 0
			};
			const deliver = () => {
				if (ctx.agents.get(agent.id) !== agent) {
					stopLoop(id);
					return;
				}
				if (agent.status !== "idle") return;
				state.lastDeliveredAt = Date.now();
				agent.followup(createUserMessage({
					content: [{
						type: "text",
						text: state.prompt
					}],
					source: {
						kind: "plugin",
						plugin: PLUGIN_ID
					}
				}));
			};
			state.dispose = ctx.interval(deliver, intervalMs);
			loops.set(id, state);
			deliver();
			return state;
		}
		ctx.on("agent/disposed", (agent) => {
			stopAgentLoops(agent);
		});
		/** 命令：/loop [interval] <prompt> | /loop stop [id] | /loop list */
		ctx.commands.register({
			name: "loop",
			description: "Run prompts on a schedule (multiple loops per session): /loop [interval] <prompt> | /loop stop [id] | /loop list",
			input: { hint: "[interval] <prompt>" },
			handler: (invocation) => {
				const raw = invocation.rawInput.trim();
				if (raw === "" || raw === "list") {
					const active = agentLoops(invocation.agent);
					if (active.length === 0) return {
						kind: "success",
						text: "No active loop.\nUsage: /loop [interval] <prompt> — e.g. /loop 5m check the deploy\nBare /loop runs the built-in maintenance prompt.\nMultiple loops may run in parallel; stop one with /loop stop <id>."
					};
					return {
						kind: "success",
						text: active.map((s) => `${s.id}: every ${formatInterval(s.intervalMs)} — ${s.prompt}`).join("\n")
					};
				}
				const stopMatch = /^stop(?:\s+(\S+))?$/.exec(raw);
				if (stopMatch !== null) {
					const target = stopMatch[1]?.trim();
					if (target !== void 0) {
						const hit = agentLoops(invocation.agent).find((s) => s.id === target);
						return hit !== void 0 && stopLoop(hit.id) ? {
							kind: "success",
							text: `Loop ${target} stopped.`
						} : {
							kind: "error",
							text: `No active loop with id ${target}.`
						};
					}
					const stopped = stopAgentLoops(invocation.agent);
					return stopped > 0 ? {
						kind: "success",
						text: `Stopped ${stopped} loop${stopped > 1 ? "s" : ""}.`
					} : {
						kind: "error",
						text: "No active loop to stop."
					};
				}
				if (raw === "clear") {
					const stopped = stopAgentLoops(invocation.agent);
					return stopped > 0 ? {
						kind: "success",
						text: `Stopped ${stopped} loop${stopped > 1 ? "s" : ""}.`
					} : {
						kind: "error",
						text: "No active loop to clear."
					};
				}
				const tokens = raw.split(/\s+/);
				const intervalMs = parseIntervalMs(tokens[0]);
				const prompt = intervalMs === null ? raw : tokens.slice(1).join(" ");
				return {
					kind: "success",
					text: `${startLoop(invocation.agent, prompt, intervalMs ?? 6e4).id} started: every ${formatInterval(intervalMs ?? 6e4)} — ${prompt}`
				};
			}
		});
		/** 工具：模型自调节入口（start/stop/status/list）。设置页可按工具开关——
		* 见 LOOP_SETTINGS_SCHEMA；`applies: 'live'`：watch 设置命名空间，每次
		* 提交后按 toolDefinitions 表动态注册/注销对应工具，保存即对新会话生效
		* （无需重启进程）。关闭后 agent 的 tools.schemas 中没有该工具（模型
		* 看不到、调不动），/loop 命令与状态路由照常（用户侧能力）。 */
		ctx.inject(["settings"], (settingsCtx) => {
			const loopSettings = settingsCtx.settings.register(LOOP_SETTINGS_NAMESPACE, LOOP_SETTINGS_SCHEMA, { applies: "live" });
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
				const value = loopSettings.get();
				for (const [name, definition] of Object.entries(toolDefinitions)) {
					const enabled = value[name] !== false;
					if (enabled && !loopToolDisposers.has(name)) loopToolDisposers.set(name, ctx.tools.register(definition));
					else if (!enabled && loopToolDisposers.has(name)) {
						loopToolDisposers.get(name)();
						loopToolDisposers.delete(name);
					}
				}
			};
			applyLoopTools();
			loopSettings.watch(() => applyLoopTools());
		});
	}
};
//#endregion
export { LOOPS_PATH, LOOP_SETTINGS_NAMESPACE, LOOP_SETTINGS_SCHEMA, src_default as default };
