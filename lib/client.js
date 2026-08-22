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
		/** 需要此插件声明的服务：slots + locale。 */
		const inject = ["slots", "locale"];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "loop: dictionaries");
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "loop",
				order: 20,
				locale: NS
			}, LoopBar));
		}
		//#endregion
		exports.LoopBar = LoopBar;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
