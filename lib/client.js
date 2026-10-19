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
		/**
		* Node half 界面语言的回传源：宿主没有 locale 服务（语言偏好只在浏览器侧），
		* Node half 的用户可见文案（命令面板 description、命令回执）靠本 half 在既有的
		* /loops 轮询上带 `?lang=` 得知。取值来自 ctx.locale 快照的 active；白名单外的
		* 语言（如语言包新增的 id）按 'en' 回传，Node half 侧另有同样的白名单兜底。
		* 语言变化即通知订阅者就地重发一次轮询（不等下一个 POLL_MS 周期，也不新增轮询）。
		*/
		const RELAYED_LANGUAGES = ["zh", "en"];
		const DEFAULT_UI_LANGUAGE = "en";
		let relayedLanguage = DEFAULT_UI_LANGUAGE;
		const languageListeners = /* @__PURE__ */ new Set();
		/** 记录一次语言变化并通知订阅者（值未变时不通知）。 */
		function relayLanguage(active) {
			const next = RELAYED_LANGUAGES.includes(active) ? active : DEFAULT_UI_LANGUAGE;
			if (next === relayedLanguage) return;
			relayedLanguage = next;
			for (const listener of languageListeners) listener();
		}
		/** 订阅回传语言：语言变化时重渲（轮询 effect 依赖它，随即便地重发一次）。 */
		function useRelayedLanguage() {
			const [language, setLanguage] = (0, react.useState)(relayedLanguage);
			(0, react.useEffect)(() => {
				const listener = () => {
					setLanguage(relayedLanguage);
				};
				languageListeners.add(listener);
				listener();
				return () => {
					languageListeners.delete(listener);
				};
			}, []);
			return language;
		}
		const NS = "loop";
		const zh = {
			"active": "循环中",
			"next": "下次 {countdown}",
			"loops.running": "{count} 个循环运行中",
			"open": "展开",
			"close": "收起",
			"stop": "停止循环",
			"cmd.label": "循环"
		};
		const en = {
			"active": "Looping",
			"next": "next {countdown}",
			"loops.running": "{count} loop(s) running",
			"open": "Expand",
			"close": "Collapse",
			"stop": "Stop loop",
			"cmd.label": "Loop"
		};
		/**
		* 设置命名空间 = 声明 `Config` schema 的条目 id（cordis.patch.yml 的 insert
		* 条目 id，与 Node half 的 LOOP_SETTINGS_NAMESPACE 一致）。
		*/
		const SETTINGS_NAMESPACE = "dsh-loop";
		/**
		* 插件包页的槽 key = bundle 包名（`plugins.bundle.config` 按包名挑选条目，
		* 与设置命名空间（条目 id）不是同一个字符串）。
		*/
		const BUNDLE_PACKAGE = "@vlln/dsh-loop";
		/** 设置卡片字段表：每个 LoopToolField 对应 LOOP_SETTINGS_SCHEMA 的一个字段
		* （字段名 = 工具注册名 = mutate 写路径的叶）与 Node half 的 toolDefinitions 的
		* key——三处同源。新增工具 = 三处各加一条，设置页自动多出一行 Switch。 */
		const LOOP_TOOL_FIELDS = [{
			path: "loop",
			title: "tool.loop",
			hint: "tool.loopDetail"
		}];
		/** 设置页 locale 命名空间（包页 chrome 由官方页面画，文案只需字段与脚注）。 */
		const settingsNS = "settings.loop";
		const zhSettings = {
			"description": "把 dsh-loop 插件的 loop 工具注入模型的工具集（保存后新会话立即生效）。",
			"tool.loop": "注入 loop 工具",
			"tool.loopDetail": "向模型注入 loop 工具后，模型可自行 start / stop / status 定时循环：\n· start <任务 prompt> [interval] — 按间隔重复投递任务；interval 形如 5m / 30s / 1h，缺省 1m\n· stop [loop_id] — 停止指定循环；不传则停止当前会话全部循环\n· status — 列出当前会话的活动循环（id、间隔、任务 prompt）\n关闭后不再注入：模型看不到也调不动 loop（tools.schemas 不含它）；/loop 命令（用户侧）与状态条不受影响。",
			"readOnly": "本部署的设置为只读。",
			"save": "保存",
			"saving": "保存中…",
			"discard": "放弃修改",
			"unsaved": "未保存",
			"saveFailed": "本部署没有接受这些值，已保留供你修改。"
		};
		const enSettings = {
			"description": "Injects the dsh-loop loop tool into the model (takes effect on new sessions right away).",
			"tool.loop": "Inject loop tool",
			"tool.loopDetail": "With the loop tool injected, the model can start / stop / status scheduled loops on its own:\n· start <task prompt> [interval] — re-delivers the task every interval; interval like 5m / 30s / 1h, defaults to 1m\n· stop [loop_id] — stops one loop; without loop_id, stops all loops of the current session\n· status — lists the session's active loops (id, interval, task prompt)\nTurning it off stops the injection: loop is no longer in the model's tools.schemas; the /loop command (user side) and the status bar stay.",
			"readOnly": "This deployment stores settings read-only.",
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
		/** 会话级轮询 hook：每 POLL_MS 拉取 Node half 路由（带当前语言回传），返回该会话的活动 loop。
		*  语言变化时依赖变化 → effect 重跑 → 立即再拉一次（语言翻转不滞后一个轮询周期）。 */
		function useSessionLoops(sessionId, language) {
			const [loops, setLoops] = (0, react.useState)([]);
			(0, react.useEffect)(() => {
				let alive = true;
				const poll = async () => {
					try {
						const query = `sessionId=${encodeURIComponent(sessionId)}&lang=${encodeURIComponent(language)}`;
						const res = await fetch(`${LOOPS_PATH}?${query}`, { headers: { accept: "application/json" } });
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
			}, [sessionId, language]);
			return loops;
		}
		/** 下一次 tick 倒计时（秒）；已过则显示 0。 */
		function countdownTo(nextTickAt) {
			return Math.max(0, Math.ceil((nextTickAt - Date.now()) / 1e3));
		}
		const BAR_RADIUS = "var(--dsw-radius-md, 12px)";
		const BAR_SHADOW = "var(--dsw-elevation-panel, none)";
		const BAR_SURFACE_BG = "var(--dsw-specific-menu, var(--dsw-specific-tip))";
		const BAR_SURFACE_BLUR = "var(--dsw-menu-backdrop-filter, none)";
		/** 卡片本体（不含高度：单循环/header 行 36px，多循环卡由 header + 展开列表撑开）。 */
		const CARD_CHROME = {
			position: "relative",
			isolation: "isolate",
			boxSizing: "border-box",
			width: "100%",
			border: 0,
			borderRadius: BAR_RADIUS,
			boxShadow: BAR_SHADOW,
			"--dsw-elevation-stroke-color": "var(--dsw-alias-border-l1)"
		};
		/** 36px 行：官方 `.bar` 的高度/内边距/间隙。 */
		const ROW_CHROME = {
			display: "flex",
			alignItems: "center",
			gap: 10,
			boxSizing: "border-box",
			height: 36,
			padding: "4px 5px 4px 12px"
		};
		const GLYPH_STYLE = {
			display: "inline-flex",
			flex: "none",
			alignItems: "center",
			gap: 8,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const LABEL_STYLE = {
			flex: "none",
			fontSize: 13,
			lineHeight: "24px",
			fontWeight: 500,
			color: "var(--dsw-alias-label-primary)"
		};
		const OBJECTIVE_STYLE = {
			flex: 1,
			minWidth: 0,
			overflow: "hidden",
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary-dimmed)",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap"
		};
		const CAPTION_STYLE = {
			flex: "none",
			fontSize: 12,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-caption)",
			whiteSpace: "nowrap"
		};
		const LOOP_ID_STYLE = {
			marginLeft: 6,
			fontSize: 11,
			fontWeight: 400,
			color: "var(--dsw-alias-label-caption)"
		};
		const ACTIONS_STYLE = {
			display: "flex",
			flex: "none",
			alignItems: "center",
			gap: 10
		};
		/**
		* 卡片表面层：官方 `.bar:before` 的内联等价物（本插件不注入 CSS，没有伪元素）。
		* 绝对定位 + `z-index:-1` + 父级 `isolation:isolate` → 压在本体背景之下、内容
		* 之上，`border-radius:inherit` 跟随卡片圆角。
		*/
		function BarSurface() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				"aria-hidden": "true",
				style: {
					position: "absolute",
					inset: 0,
					zIndex: -1,
					borderRadius: "inherit",
					background: BAR_SURFACE_BG,
					backdropFilter: BAR_SURFACE_BLUR,
					pointerEvents: "none"
				}
			});
		}
		/**
		* 官方 icon 按钮（goal `.iconBtn`）：28×28 圆形、tertiary 色、hover 转
		* `--dsw-alias-interactive-bg-hover` + secondary 色、disabled 降 0.4。
		* Tooltip 走 portal（卡片 `overflow:hidden` 裁不了它）。
		*/
		function BarIconButton(props) {
			const disabled = props.disabled === true;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: props.label,
				side: "bottom",
				delayMs: 500,
				portal: true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-label": props.label,
					disabled,
					onClick: props.onClick,
					style: {
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						width: 28,
						height: 28,
						padding: 0,
						border: "none",
						borderRadius: 999,
						flex: "none",
						background: "transparent",
						cursor: disabled ? "default" : "pointer",
						color: "var(--dsw-alias-label-tertiary)",
						opacity: disabled ? .4 : 1,
						transition: "background .15s ease, color .15s ease"
					},
					onMouseEnter: (e) => {
						e.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover, rgba(128,128,140,.12))";
						e.currentTarget.style.color = "var(--dsw-alias-label-secondary)";
					},
					onMouseLeave: (e) => {
						e.currentTarget.style.background = "transparent";
						e.currentTarget.style.color = "var(--dsw-alias-label-tertiary)";
					},
					children: props.children
				})
			});
		}
		/** 活动指示 glyph（官方 `.goalGlyph` 的位置与配色）：ongoing 像素点 + 循环 icon。 */
		function LoopGlyph() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				style: GLYPH_STYLE,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
					state: "ongoing",
					size: 10
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 })]
			});
		}
		/**
		* 对话页输入框上方的活动循环状态条：仅 Chat 视图显示（`[data-chat-flow=""]`
		* 探针），轮询该会话活动 loop。有则单行展示（官方 dock 卡片视觉）；无则 null。
		*/
		function LoopBar(props) {
			const { t, session } = props;
			const language = useRelayedLanguage();
			const loops = useSessionLoops(session.sessionId, language);
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
						...CARD_CHROME,
						...ROW_CHROME
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BarSurface, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoopGlyph, {}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: LABEL_STYLE,
							children: [t("active"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: LOOP_ID_STYLE,
								children: loop.id
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: OBJECTIVE_STYLE,
							children: loop.prompt
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: CAPTION_STYLE,
							children: [
								loop.intervalText,
								" · ",
								t("next", { countdown: countdownText })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: ACTIONS_STYLE,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BarIconButton, {
								label: t("stop"),
								disabled: stopping === loop.id,
								onClick: () => {
									stopLoop(loop.id);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 14 })
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
					margin: "0 auto"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						...CARD_CHROME,
						overflow: "hidden"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BarSurface, {}), body]
				})
			});
			return card(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...ROW_CHROME,
					paddingRight: 12,
					cursor: "pointer"
				},
				onClick: () => {
					setOpen((v) => !v);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoopGlyph, {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							...LABEL_STYLE,
							flex: 1
						},
						children: t("loops.running", { count: loops.length })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: CAPTION_STYLE,
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
							style: CAPTION_STYLE,
							children: loop.id
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: OBJECTIVE_STYLE,
							children: loop.prompt
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: CAPTION_STYLE,
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
		* 多字段布尔暂存表单：对齐官方 ConfigForm 语义（`edit` 暂存 → `save` 单次
		* revision-fenced 提交 → `discard` 丢弃）。
		* 写路径用官方 mutate 的数组叶路径（可任意深）：字段名即 schema 叶名，工具
		* 字段若将来嵌套也不必整组合并写。CAS 基线 revision 在首次暂存时取（暂存期间
		* 他人写入 → 保存被拒 → failed），save/discard 后清空。
		* 快照必须引用稳定：useSyncExternalStore 要求内容未变时返回同一对象，否则
		* 卡片渲染会无限重渲（React #185）；draft 对象每次变更整体替换（引用即失效
		* 信号）。保存后按宿主接受值逐字段确认——布尔叶等值比较即可。
		*/
		var LoopSettingsForm = class {
			scope;
			draft = {};
			saving = false;
			failed = false;
			/** 首次暂存时的 scope revision（CAS 基线；save/discard 后清空）。 */
			baselineRevision = void 0;
			listeners = /* @__PURE__ */ new Set();
			offScope = void 0;
			cache = void 0;
			/** @param scope - 已绑定的 `dsh-loop` 设置命名空间（ctx.configForms.get(条目 id)）。 */
			constructor(scope) {
				this.scope = scope;
				this.offScope = this.scope.subscribe(() => this.emit());
			}
			/** 退订 scope（注册方 dispose 时调用；幂等）。 */
			dispose = () => {
				if (this.offScope === void 0) return;
				this.offScope();
				this.offScope = void 0;
				this.listeners.clear();
			};
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
				for (const { path } of LOOP_TOOL_FIELDS) {
					const staged = this.draft[path];
					const committedValue = typeof committed[path] === "boolean" ? committed[path] : true;
					fields[path] = { checked: staged ?? committedValue };
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
			/** 暂存一次勾选（按叶路径；首次暂存记 CAS 基线 revision）。 */
			edit = (field, checked) => {
				if (this.baselineRevision === void 0) this.baselineRevision = this.scope.getSnapshot().revision;
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
				this.baselineRevision = void 0;
				this.failed = false;
				this.emit();
			};
			/** 提交全部暂存（单次 revision-fenced mutate），随后以宿主接受值重读确认。 */
			save = async () => {
				const staged = Object.entries(this.draft);
				if (staged.length === 0 || this.saving) return;
				this.saving = true;
				this.emit();
				let failed = false;
				try {
					const ops = staged.map(([path, value]) => ({
						op: "set",
						path: [path],
						value
					}));
					if (await this.scope.mutate(ops, this.baselineRevision) !== true) failed = true;
				} catch {
					failed = true;
				}
				if (!failed) {
					const committed = this.scope.getSnapshot().value ?? {};
					for (const [field, value] of staged) if (committed[field] !== value) failed = true;
				}
				this.saving = false;
				this.draft = {};
				this.baselineRevision = void 0;
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
		* 插件包页的配置卡片（官方 `plugins.bundle.config` keyed 槽；key = bundle 包名
		* `@vlln/dsh-loop`，卡片渲染在 Plugins 页本 bundle 包页的描述与行清单之间）。
		* 页面只请求 `page` 视图——chrome（图标/标题/描述/面包屑）由包页画，本组件只画
		* 字段区与自己的保存脚注。每个工具一行官方质感 Switch（LOOP_TOOL_FIELDS 表驱动）；
		* 写库走 ctx.configForms 传输（命名空间 = 条目 id `dsh-loop`），Node half 订阅
		* `loader/volatile-update` 按工具表动态注册/注销工具，保存后新会话立即生效。
		*/
		function LoopSettingsCard(props) {
			const { t } = props;
			const state = props.useLoopSettings((s) => s);
			if (props.view === "summary") return t("description");
			if (!state.available) return null;
			const disabled = !state.writable;
			const blocked = !state.dirty || state.saving;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-loop-settings-card": "",
				style: {
					display: "flex",
					flexDirection: "column",
					boxSizing: "border-box"
				},
				children: [
					disabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							margin: "0 0 8px",
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
							padding: "4px 0",
							gap: 0
						},
						children: LOOP_TOOL_FIELDS.map(({ path, title, hint }, index) => {
							const row = state.fields[path] ?? { checked: true };
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
										props.edit(path, checked);
									}
								})]
							}, path);
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
							}) : state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									flex: 1,
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
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
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
			});
		}
		/** 本插件宿主命令的名字（与 Node half `ctx.commands.register({ name: 'loop' })` 同源）。 */
		const COMMAND_NAME = "loop";
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
		function installCommandRowFace(commandUi, t) {
			const runtime = commandUi;
			const original = runtime?.candidates;
			if (runtime === void 0 || typeof original !== "function") return () => {};
			const face = async (session, req) => {
				return (await original.call(runtime, session, req)).map((row) => row?.name === COMMAND_NAME ? {
					...row,
					label: t("cmd.label"),
					icon: _deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular
				} : row);
			};
			runtime.candidates = face;
			return () => {
				if (runtime.candidates === face) runtime.candidates = original;
			};
		}
		/** 需要此插件声明的服务：slots（槽注册）+ locale（文案）+ configForms（设置读写传输）。 */
		const inject = [
			"slots",
			"locale",
			"configForms"
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
			const t = ctx.locale.bind(NS);
			ctx.effect(() => {
				const relay = () => {
					relayLanguage(ctx.locale.getSnapshot().active);
				};
				relay();
				return ctx.locale.subscribe(relay);
			}, "loop: UI language relay");
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "loop",
				order: 15,
				locale: NS
			}, LoopBar));
			const loopForm = new LoopSettingsForm(ctx.configForms.get(SETTINGS_NAMESPACE));
			ctx.effect(() => () => {
				loopForm.dispose();
			}, "loop: settings form subscription");
			ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: BUNDLE_PACKAGE,
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
			}, LoopSettingsCard))), "loop: settings card");
			ctx.inject(["commandUi"], (commandScope) => {
				commandScope.effect(() => installCommandRowFace(commandScope.get("commandUi"), t), "loop: command row face");
			});
		}
		//#endregion
		exports.LoopBar = LoopBar;
		exports.LoopSettingsCard = LoopSettingsCard;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
