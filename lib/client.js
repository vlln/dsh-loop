window.__ModuleLoader__.load({
	id: "@vlln/dsh-loop",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/index.tsx
		/** Node half 只读活动 loop 路由（与 examples/loop/index.mjs 的 LOOPS_PATH 一致）。 */
		const LOOPS_PATH = "/plugins/dsh-loop/loops";
		/** 轮询间隔：状态条不需要亚秒刷新；60s 足够新（倒计时本地重算，不依赖轮询）。 */
		const POLL_MS = 6e4;
		const NS = "loop";
		const zh = {
			"active": "循环中",
			"next": "下次 {countdown}",
			"loops.running": "{count} 个循环运行中",
			"open": "展开",
			"close": "收起",
			"stop": "停止循环"
		};
		const en = {
			"active": "Looping",
			"next": "next {countdown}",
			"loops.running": "{count} loop(s) running",
			"open": "Expand",
			"close": "Collapse",
			"stop": "Stop loop"
		};
		/** 设置命名空间（与 Node half 的 LOOP_SETTINGS_NAMESPACE 一致）。 */
		const SETTINGS_NAMESPACE = "dsh-loop";
		/** 设置卡片字段表：每个 LoopToolField 对应 LOOP_SETTINGS_SCHEMA 的一个字段
		* （字段名 = 工具注册名）与 Node half 的 toolDefinitions 的 key——三处同源。
		* 新增工具 = 三处各加一条，设置页自动多出一行 Switch。 */
		const LOOP_TOOL_FIELDS = [{
			field: "loop",
			title: "tool.loop",
			hint: "tool.loopDetail"
		}];
		/** 设置页 locale 命名空间。文案对齐官方 ui-settings-plugins 卡片（同上款）。 */
		const settingsNS = "settings.loop";
		const zhSettings = {
			"title": "dsh-loop",
			"description": "把 dsh-loop 插件的 loop 工具注入模型的工具集（保存后新会话立即生效）。",
			"tool.loop": "注入 loop 工具",
			"tool.loopDetail": "向模型注入 loop 工具后，模型可自行 start / stop / status 定时循环：\n· start <任务 prompt> [interval] — 按间隔重复投递任务；interval 形如 5m / 30s / 1h，缺省 1m\n· stop [loop_id] — 停止指定循环；不传则停止当前会话全部循环\n· status — 列出当前会话的活动循环（id、间隔、任务 prompt）\n关闭后不再注入：模型看不到也调不动 loop（tools.schemas 不含它）；/loop 命令（用户侧）与状态条不受影响。",
			"readOnly": "本部署的设置为只读。",
			"expand": "展开设置",
			"collapse": "收起设置",
			"save": "保存",
			"saving": "保存中…",
			"discard": "放弃修改",
			"unsaved": "未保存",
			"saveFailed": "本部署没有接受这些值，已保留供你修改。"
		};
		const enSettings = {
			"title": "dsh-loop",
			"description": "Injects the dsh-loop loop tool into the model (takes effect on new sessions right away).",
			"tool.loop": "Inject loop tool",
			"tool.loopDetail": "With the loop tool injected, the model can start / stop / status scheduled loops on its own:\n· start <task prompt> [interval] — re-delivers the task every interval; interval like 5m / 30s / 1h, defaults to 1m\n· stop [loop_id] — stops one loop; without loop_id, stops all loops of the current session\n· status — lists the session's active loops (id, interval, task prompt)\nTurning it off stops the injection: loop is no longer in the model's tools.schemas; the /loop command (user side) and the status bar stay.",
			"readOnly": "This deployment stores settings read-only.",
			"expand": "Show settings",
			"collapse": "Hide settings",
			"save": "Save",
			"saving": "Saving…",
			"discard": "Discard",
			"unsaved": "Unsaved",
			"saveFailed": "The deployment did not accept these values; they were left for you to correct."
		};
		/** 布局变量对齐官方 dock 家族（ConversationRoot.module.css / GoalBar / QueueDock）。 */
		const SIDE_CLEARANCE = "var(--dsh-composer-side-clearance, 16px)";
		const DOCK_INSET = "var(--dsh-composer-dock-inset, 8px)";
		const CARD_MAX = "var(--dsh-composer-card-max-width, 780px)";
		/** 会话级轮询 hook：每 POLL_MS 拉取 Node half 路由，返回该会话的活动 loop。 */
		function useSessionLoops(sessionId) {
			const [loops, setLoops] = (0, react.useState)([]);
			(0, react.useEffect)(() => {
				let alive = true;
				const poll = async () => {
					try {
						const res = await fetch(`${LOOPS_PATH}?sessionId=${encodeURIComponent(sessionId)}`, { headers: { accept: "application/json" } });
						if (!res.ok) return;
						const data = await res.json();
						if (alive && Array.isArray(data.loops)) setLoops(data.loops);
					} catch {}
				};
				poll();
				const timer = setInterval(() => {
					poll();
				}, POLL_MS);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [sessionId]);
			return loops;
		}
		/** 下一次 tick 倒计时（秒）；已过则显示 0。 */
		function countdownTo(nextTickAt) {
			return Math.max(0, Math.ceil((nextTickAt - Date.now()) / 1e3));
		}
		/**
		* 对话页输入框上方的活动循环状态条：仅 Chat 视图显示（`[data-chat-flow=""]`
		* 探针），轮询该会话活动 loop。有则单行展示（官方 dock 卡片视觉）；无则 null。
		*/
		function LoopBar(props) {
			const { t, session } = props;
			const loops = useSessionLoops(session.sessionId);
			const [inChat, setInChat] = (0, react.useState)(false);
			const [open, setOpen] = (0, react.useState)(false);
			const [stopping, setStopping] = (0, react.useState)(null);
			/** 停止指定 loop（POST Node half 路由）；成功后轮询下一轮自然消失。 */
			const stopLoop = (0, react.useCallback)(async (id) => {
				if (stopping !== null) return;
				setStopping(id);
				try {
					await fetch(LOOPS_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ id })
					});
				} catch {} finally {
					setStopping(null);
				}
			}, [stopping]);
			(0, react.useEffect)(() => {
				const check = () => {
					setInChat(document.querySelector("[data-chat-flow=\"\"]") !== null);
				};
				check();
				const observer = new MutationObserver(check);
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
				return () => {
					observer.disconnect();
				};
			}, []);
			if (!inChat) return null;
			if (loops.length === 0) return null;
			const bar = (loop) => {
				const countdown = countdownTo(loop.nextTickAt);
				const countdownText = countdown > 0 ? `${countdown}s` : "now";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"data-loop-bar": "",
					style: {
						boxSizing: "border-box",
						display: "flex",
						alignItems: "center",
						gap: 10,
						width: "100%",
						padding: "6px 12px",
						border: "1px solid var(--dsw-alias-border-l1)",
						borderRadius: 12,
						background: "var(--dsw-specific-tip)",
						fontSize: 13,
						fontFamily: "system-ui"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								display: "inline-flex",
								flex: "none",
								alignItems: "center",
								gap: 8
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "ongoing",
								size: 10
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									display: "inline-flex",
									flex: "none",
									color: "var(--dsw-alias-label-tertiary)"
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, { size: 14 })
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								flex: "none",
								fontSize: 13,
								lineHeight: "24px",
								fontWeight: 500,
								color: "var(--dsw-alias-label-primary)"
							},
							children: [t("active"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									marginLeft: 6,
									fontSize: 11,
									fontWeight: 400,
									color: "var(--dsw-alias-label-caption)"
								},
								children: loop.id
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								flex: 1,
								minWidth: 0,
								overflow: "hidden",
								fontSize: 13,
								lineHeight: "20px",
								color: "var(--dsw-alias-label-primary-dimmed)",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap"
							},
							children: loop.prompt
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								flex: "none",
								fontSize: 12,
								lineHeight: "20px",
								color: "var(--dsw-alias-label-caption)",
								whiteSpace: "nowrap"
							},
							children: [
								loop.intervalText,
								" · ",
								t("next", { countdown: countdownText })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								display: "inline-flex",
								flex: "none",
								alignItems: "center"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
								label: t("stop"),
								side: "bottom",
								delayMs: 500,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									"aria-label": t("stop"),
									disabled: stopping === loop.id,
									onClick: () => {
										stopLoop(loop.id);
									},
									style: {
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										width: 24,
										height: 24,
										padding: 0,
										border: "none",
										borderRadius: 6,
										background: "transparent",
										cursor: "pointer",
										flex: "none",
										color: "var(--dsw-alias-label-tertiary)",
										transition: "background .15s ease, color .15s ease"
									},
									onMouseEnter: (e) => {
										e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(128,128,140,.12))";
										e.currentTarget.style.color = "var(--dsw-alias-label-primary)";
									},
									onMouseLeave: (e) => {
										e.currentTarget.style.background = "transparent";
										e.currentTarget.style.color = "var(--dsw-alias-label-tertiary)";
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
								})
							})
						})
					]
				}, loop.id);
			};
			if (loops.length === 1) {
				const single = loops[0];
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					"data-loop-dock": "",
					style: {
						boxSizing: "border-box",
						width: `calc(100% - 2 * ${SIDE_CLEARANCE} - 4 * ${DOCK_INSET})`,
						maxWidth: `calc(${CARD_MAX} - 4 * ${DOCK_INSET})`,
						margin: "0 auto"
					},
					children: single !== void 0 ? bar(single) : null
				});
			}
			const card = (body) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				"data-loop-dock": "",
				style: {
					boxSizing: "border-box",
					width: `calc(100% - 2 * ${SIDE_CLEARANCE} - 4 * ${DOCK_INSET})`,
					maxWidth: `calc(${CARD_MAX} - 4 * ${DOCK_INSET})`,
					margin: "0 auto",
					border: "1px solid var(--dsw-alias-border-l1)",
					borderRadius: 12,
					background: "var(--dsw-specific-tip)",
					overflow: "hidden",
					fontSize: 13,
					fontFamily: "system-ui"
				},
				children: body
			});
			return card(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "6px 12px",
					cursor: "pointer"
				},
				onClick: () => {
					setOpen((v) => !v);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							display: "inline-flex",
							flex: "none",
							alignItems: "center",
							gap: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
							state: "ongoing",
							size: 10
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								display: "inline-flex",
								flex: "none",
								color: "var(--dsw-alias-label-tertiary)"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, { size: 14 })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							flex: 1,
							fontSize: 13,
							lineHeight: "24px",
							fontWeight: 500,
							color: "var(--dsw-alias-label-primary)"
						},
						children: t("loops.running", { count: loops.length })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							flex: "none",
							fontSize: 12,
							color: "var(--dsw-alias-label-caption)"
						},
						children: open ? t("close") : t("open")
					})
				]
			}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					maxHeight: 180,
					overflowY: "auto",
					borderTop: "1px solid var(--dsw-alias-border-l1)",
					padding: "4px 0"
				},
				children: loops.map((loop) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						padding: "2px 12px",
						display: "flex",
						alignItems: "center",
						gap: 10
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								flex: "none",
								fontSize: 12,
								color: "var(--dsw-alias-label-caption)",
								whiteSpace: "nowrap"
							},
							children: loop.id
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								flex: 1,
								minWidth: 0,
								overflow: "hidden",
								fontSize: 13,
								lineHeight: "20px",
								color: "var(--dsw-alias-label-primary-dimmed)",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap"
							},
							children: loop.prompt
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								flex: "none",
								fontSize: 12,
								color: "var(--dsw-alias-label-caption)",
								whiteSpace: "nowrap"
							},
							children: [
								loop.intervalText,
								" · ",
								t("next", { countdown: countdownTo(loop.nextTickAt) > 0 ? `${countdownTo(loop.nextTickAt)}s` : "now" })
							]
						})
					]
				}, loop.id))
			})] }));
		}
		/**
		* 多字段布尔暂存表单：对齐官方 CardForm 语义（`edit` 暂存 → `save` 提交 /
		* `discard` 丢弃）。每个字段独立暂存（布尔）；保存把所有暂存一次性提交
		* （revision-fenced 文档变更），与官方其他插件卡片一致。
		*/
		var LoopSettingsForm = class {
			scope;
			draft = {};
			saving = false;
			failed = false;
			listeners = /* @__PURE__ */ new Set();
			cache = void 0;
			/** @param scope - 已绑定的 `dsh-loop` 设置命名空间。 */
			constructor(scope) {
				this.scope = scope;
				this.scope.subscribe(() => this.emit());
			}
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			getSnapshot = () => {
				const snap = this.scope.getSnapshot();
				if (this.cache !== void 0 && this.cache.snap === snap && this.cache.draft === this.draft && this.cache.saving === this.saving && this.cache.failed === this.failed) return this.cache.state;
				const committed = snap.value ?? {};
				const fields = {};
				for (const { field } of LOOP_TOOL_FIELDS) {
					const staged = this.draft[field];
					const committedValue = typeof committed[field] === "boolean" ? committed[field] : true;
					fields[field] = { checked: staged ?? committedValue };
				}
				const state = {
					available: snap.status !== "unavailable",
					writable: snap.writable,
					dirty: Object.keys(this.draft).length > 0,
					saving: this.saving,
					failed: this.failed,
					fields
				};
				this.cache = {
					snap,
					draft: this.draft,
					saving: this.saving,
					failed: this.failed,
					state
				};
				return state;
			};
			emit() {
				for (const listener of this.listeners) listener();
			}
			/** 暂存一次勾选（布尔），整体替换 draft 对象使引用失效。 */
			edit = (field, checked) => {
				this.draft = {
					...this.draft,
					[field]: checked
				};
				this.failed = false;
				this.emit();
			};
			/** 丢弃全部暂存。 */
			discard = () => {
				if (Object.keys(this.draft).length === 0) return;
				this.draft = {};
				this.failed = false;
				this.emit();
			};
			/** 提交全部暂存（revision-fenced 写），随后以宿主接受值重读确认。 */
			save = async () => {
				const staged = Object.entries(this.draft);
				if (staged.length === 0 || this.saving) return;
				this.saving = true;
				this.emit();
				let failed = false;
				try {
					for (const [field, value] of staged) await this.scope.set(field, value);
				} catch {}
				const committed = this.scope.getSnapshot().value ?? {};
				for (const [field, value] of staged) if (typeof committed[field] !== "boolean" || committed[field] !== value) failed = true;
				this.saving = false;
				this.draft = {};
				this.failed = failed;
				this.emit();
			};
		};
		/**
		* 官方质感 Switch（rc.8 交付物没有官方 Switch 组件——检查过 app shell 与全部
		* shipped client bundle，`role:"switch"`/`aria-checked` 零命中；官方设置控件是
		* input/select/分段按钮。所以自绘：36×20 轨道 + 14 滑块，全走 design tokens
		* ——开态 `--dsw-alias-brand-primary`，关态 `--dsw-alias-border-l2` 边框 +
		* `--dsw-alias-bg-layer-2` 底，滑块 `--dsw-alias-label-primary-inverted`；
		* focus 环用 `--dsw-alias-interactive-bg-hover`，disabled 走官方 0.4 透明度。
		* 语义：`role="switch"` + `aria-checked` + 原生按钮键盘（Enter/Space）。
		*/
		function OfficialSwitch(props) {
			const [focused, setFocused] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				role: "switch",
				"aria-checked": props.checked,
				"aria-label": props.label,
				disabled: props.disabled,
				onClick: () => {
					props.onChange(!props.checked);
				},
				onFocus: () => {
					setFocused(true);
				},
				onBlur: () => {
					setFocused(false);
				},
				style: {
					position: "relative",
					flex: "none",
					width: 36,
					height: 20,
					borderRadius: 999,
					boxSizing: "border-box",
					padding: 0,
					border: `1px solid ${props.checked ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l2)"}`,
					background: props.checked ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-bg-layer-2)",
					boxShadow: focused ? "0 0 0 3px var(--dsw-alias-interactive-bg-hover)" : "none",
					cursor: props.disabled ? "default" : "pointer",
					opacity: props.disabled ? .4 : 1,
					transition: "background .16s, border-color .16s, box-shadow .16s, opacity .16s"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					style: {
						position: "absolute",
						top: 2,
						left: props.checked ? 20 : 2,
						width: 14,
						height: 14,
						borderRadius: "50%",
						background: "var(--dsw-alias-label-primary-inverted)",
						transition: "left .16s"
					}
				})
			});
		}
		/**
		* 设置 → 插件 里的插件卡片（settings.plugin.item 槽，与官方 BashCard /
		* AgentLoopCard 完全同款 chrome：折叠头 + 未保存徽章 + 字段行 + 保存/放弃脚注；
		* rc.8 契约为 keyed 槽，key = 设置命名空间 dsh-loop）。每个工具一行官方
		* 质感 Switch（LOOP_TOOL_FIELDS 表驱动）。写库走 ctx.settingsScope 传输；
		* Node half watch 设置命名空间按工具表动态注册/注销工具，保存后新会话立即
		* 生效（`applies: 'live'`，见 index.mjs）。
		*/
		function LoopSettingsCard(props) {
			const { t } = props;
			const state = props.useLoopSettings((s) => s);
			const [open, setOpen] = (0, react.useState)(false);
			const [hover, setHover] = (0, react.useState)(false);
			if (!state.available) return null;
			const disabled = !state.writable;
			const blocked = !state.dirty || state.saving;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				"data-loop-settings-card": "",
				onMouseEnter: () => {
					setHover(true);
				},
				onMouseLeave: () => {
					setHover(false);
				},
				style: {
					listStyle: "none",
					border: "1px solid var(--dsw-alias-border-l2)",
					borderRadius: 12,
					background: open || hover ? "var(--dsw-alias-bg-layer-2)" : "var(--dsw-alias-bg-layer-3)",
					borderColor: open || hover ? "var(--dsw-alias-label-dimmed)" : "var(--dsw-alias-border-l2)",
					transition: "border-color .16s, background .16s",
					boxSizing: "border-box"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${t("title")}`,
					onClick: () => {
						setOpen(!open);
					},
					style: {
						width: "100%",
						appearance: "none",
						border: 0,
						background: "none",
						font: "inherit",
						color: "inherit",
						textAlign: "left",
						cursor: "pointer",
						display: "flex",
						alignItems: "center",
						gap: 12,
						padding: "14px 16px",
						borderRadius: 12
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								flex: 1,
								minWidth: 0,
								display: "flex",
								flexDirection: "column",
								gap: 4
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 15,
									fontWeight: 600,
									lineHeight: 1.4,
									color: "var(--dsw-alias-label-primary)"
								},
								children: t("title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 13,
									lineHeight: 1.5,
									color: "var(--dsw-alias-label-tertiary)"
								},
								children: t("description")
							})]
						}),
						state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								flex: "none",
								borderRadius: 999,
								padding: "1px 8px",
								fontSize: 11,
								lineHeight: "17px",
								fontWeight: 500,
								whiteSpace: "nowrap",
								background: "var(--dsw-alias-bg-module-platform)",
								color: "var(--dsw-alias-label-secondary)"
							},
							children: t("unsaved")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								flex: "none",
								display: "flex",
								color: "var(--dsw-alias-label-tertiary)",
								transition: "transform .16s",
								transform: open ? "rotate(180deg)" : "none"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {})
						})
					]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						borderTop: "1px solid var(--dsw-alias-border-l2)",
						margin: "0 16px",
						paddingBottom: 8
					},
					children: [
						disabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: {
								margin: "12px 0 0",
								fontSize: 12,
								lineHeight: 1.5,
								color: "var(--dsw-alias-label-tertiary)"
							},
							role: "status",
							children: t("readOnly")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								padding: "12px 0",
								gap: 0
							},
							children: LOOP_TOOL_FIELDS.map(({ field, title, hint }, index) => {
								const row = state.fields[field] ?? { checked: true };
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 12,
										padding: "8px 0",
										borderBottom: index < LOOP_TOOL_FIELDS.length - 1 ? "1px solid var(--dsw-alias-border-l1)" : "none"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											flex: 1,
											minWidth: 0,
											display: "flex",
											flexDirection: "column",
											gap: 2
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 13,
												fontWeight: 500,
												lineHeight: 1.5,
												color: "var(--dsw-alias-label-primary)"
											},
											children: t(title)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 12,
												lineHeight: 1.5,
												color: "var(--dsw-alias-label-tertiary)",
												whiteSpace: "pre-line"
											},
											children: t(hint)
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OfficialSwitch, {
										checked: row.checked,
										disabled,
										label: t(title),
										onChange: (checked) => {
											props.edit(field, checked);
										}
									})]
								}, field);
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								justifyContent: "flex-end",
								gap: 8,
								padding: "12px 0 4px",
								borderTop: "1px solid var(--dsw-alias-border-l2)"
							},
							children: [
								state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: {
										flex: 1,
										minWidth: 0,
										margin: 0,
										fontSize: 12,
										lineHeight: 1.5,
										color: "var(--dsw-alias-label-error)"
									},
									role: "status",
									children: t("saveFailed")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: blocked,
									onClick: () => {
										props.discard();
									},
									style: {
										appearance: "none",
										border: "1px solid var(--dsw-alias-border-l2)",
										borderRadius: 8,
										padding: "5px 14px",
										font: "inherit",
										fontSize: 13,
										lineHeight: 1.5,
										cursor: "pointer",
										background: "none",
										color: "var(--dsw-alias-label-secondary)",
										opacity: blocked ? .4 : 1
									},
									children: t("discard")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: blocked,
									onClick: () => {
										props.save();
									},
									style: {
										appearance: "none",
										border: "1px solid transparent",
										borderRadius: 8,
										padding: "5px 14px",
										font: "inherit",
										fontSize: 13,
										lineHeight: 1.5,
										cursor: "pointer",
										background: "var(--dsw-alias-label-primary)",
										color: "var(--dsw-alias-bg-layer-3)",
										opacity: blocked ? .4 : 1
									},
									children: state.saving ? t("saving") : t("save")
								})
							]
						})
					]
				}) : null]
			});
		}
		/** 需要此插件声明的服务：slots + locale + 设置传输（settingsScope/connection/remote）。 */
		const inject = [
			"slots",
			"locale",
			"settingsScope",
			"connection",
			"remote"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "loop: dictionaries");
			ctx.effect(() => ctx.locale.register(settingsNS, {
				zh: zhSettings,
				en: enSettings
			}), "loop: settings dictionaries");
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "loop",
				order: 15,
				locale: NS
			}, LoopBar));
			const loopForm = new LoopSettingsForm(ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }));
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: SETTINGS_NAMESPACE,
				locale: settingsNS,
				inject: () => ({
					hooks: { loopSettings: {
						getSnapshot: loopForm.getSnapshot,
						subscribe: loopForm.subscribe
					} },
					edit: loopForm.edit,
					save: loopForm.save,
					discard: loopForm.discard
				})
			}, LoopSettingsCard));
		}
		//#endregion
		exports.LoopBar = LoopBar;
		exports.LoopSettingsCard = LoopSettingsCard;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
