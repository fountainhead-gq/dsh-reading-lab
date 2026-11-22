/* 样式（03 §4.4）：只允许 var(--dsw-alias-*) 与 currentColor，明暗由 token 切换。
 *
 * token 契约：只能用 DSH 主题里真实存在的别名。清单见 test/unit/theme-tokens.test.js
 * 的 ALLOWED（从安装包 asar 内 223 个 CSS 提取的 138 个 --dsw-alias-*，2026-11-20 取样），
 * 该测试会扫描 src/client/**\/*.js，引用不存在的 token 直接失败。历史踩坑：
 * bg-primary / separator-primary / border-l / border-secondary / label-inverse 都不存在，
 * 写错时浏览器静默回落（透明或继承父色），深色主题下不可读。
 *
 * 主按钮（.rl-btn--primary）对比度：background = button-primary-fill，文字 =
 * label-primary-inverted。浅色主题 fill=rgb(15,17,21)、文字 #FFF ≈ 17.9:1；深色主题
 * fill=rgb(249,250,251)、文字 rgb(53,54,56) ≈ 11.2:1。两套都 ≥ 4.5:1，故不用
 * label-on-color（它两套主题都是白字，深色主题下会与近白底撞成 ≈1:1）。
 *
 * R10 视觉层（docs/13-ui-rework-backlog.md）：尺寸/字阶/圆角/间距先收敛成 `--rl-*`
 * 语义变量，再让各视图引用；颜色仍然只走 DSH 别名，不写死 hex——宿主切深色时整块跟着走。
 */

var STYLES = [
  // ---- R10 token 层 -------------------------------------------------------
  '.rl-root{',
  '--rl-radius-sm:6px;--rl-radius-md:10px;--rl-radius-lg:14px;--rl-radius-pill:999px;',
  '--rl-space-1:4px;--rl-space-2:8px;--rl-space-3:12px;--rl-space-4:16px;--rl-space-5:24px;--rl-space-6:32px;',
  '--rl-font-xs:11px;--rl-font-sm:12px;--rl-font-md:13px;--rl-font-lg:15px;--rl-font-xl:20px;',
  '--rl-weight-regular:400;--rl-weight-medium:500;--rl-weight-bold:600;',
  '--rl-header-h:52px;--rl-side-w:288px;--rl-rail-w:380px;--rl-control-h:30px;',
  '--rl-shadow-1:0 1px 2px var(--dsw-alias-bg-mask-1);',
  '--rl-shadow-2:0 6px 20px var(--dsw-alias-bg-mask-1);',
  '--rl-line:1px solid var(--dsw-alias-border-l1);',
  'display:flex;flex-direction:column;position:relative;height:100%;min-height:0;font:inherit;font-size:var(--rl-font-md);line-height:1.6;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);}',
  '.rl-root *{box-sizing:border-box;}',
  '.rl-root :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',

  // ---- 顶栏 ---------------------------------------------------------------
  '.rl-header{display:flex;align-items:center;gap:var(--rl-space-3);height:var(--rl-header-h);padding:0 var(--rl-space-4);border-bottom:var(--rl-line);background:var(--dsw-alias-bg-layer-1);flex:0 0 auto;}',
  '.rl-header__brand{display:flex;align-items:baseline;gap:var(--rl-space-2);min-width:0;}',
  '.rl-header__title{font-size:var(--rl-font-lg);font-weight:var(--rl-weight-bold);letter-spacing:-0.01em;white-space:nowrap;}',
  '.rl-header__subtitle{font-size:var(--rl-font-sm);color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;}',
  '.rl-header__spacer{flex:1 1 auto;}',
  '.rl-header__group{display:flex;align-items:center;gap:var(--rl-space-1);}',
  '.rl-header__count{font-size:var(--rl-font-sm);color:var(--dsw-alias-label-caption);white-space:nowrap;}',
  '.rl-header__warn{font-size:var(--rl-font-sm);color:var(--dsw-alias-state-warn-secondary);white-space:nowrap;}',
  '.rl-header__exported{font-size:var(--rl-font-sm);color:var(--dsw-alias-label-caption);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.rl-header__error{color:var(--dsw-alias-state-error-primary);}',

  // ---- 通用控件 -----------------------------------------------------------
  '.rl-btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--rl-space-1);height:var(--rl-control-h);padding:0 10px;border-radius:var(--rl-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--rl-font-sm);font-weight:var(--rl-weight-medium);cursor:pointer;transition:background .12s ease,border-color .12s ease;}',
  '.rl-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}',
  '.rl-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active);}',
  '.rl-btn:disabled{color:var(--dsw-alias-label-caption);cursor:not-allowed;}',
  '.rl-btn--primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);}',
  '.rl-btn--primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);}',
  '.rl-btn--ghost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);}',
  '.rl-btn--ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary);}',
  '.rl-btn--sm{height:26px;padding:0 var(--rl-space-2);font-size:var(--rl-font-xs);}',
  // 图标按钮：32×32 命中区，图形 16px 线性；labels 走 aria-label（Ponder 顶栏同构）
  '.rl-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;border-radius:var(--rl-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .12s ease,color .12s ease;}',
  '.rl-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.rl-icon-btn[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);}',
  '.rl-icon-btn:disabled{color:var(--dsw-alias-label-caption);cursor:not-allowed;}',
  '.rl-icon-btn--accent{color:var(--dsw-alias-brand-primary);}',
  '.rl-input{width:100%;height:var(--rl-control-h);padding:0 var(--rl-space-2);border-radius:var(--rl-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--rl-font-sm);}',
  '.rl-input::placeholder{color:var(--dsw-alias-label-caption);}',
  '.rl-icon{display:block;width:16px;height:16px;flex:0 0 auto;}',
  '.rl-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}',

  // ---- 视图切换（导图 / 笔记）--------------------------------------------
  '.rl-switch{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:var(--rl-radius-sm);background:var(--dsw-alias-bg-layer-2);}',
  '.rl-switch__item{display:inline-flex;align-items:center;gap:var(--rl-space-1);height:26px;padding:0 10px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:var(--rl-font-sm);font-weight:var(--rl-weight-medium);cursor:pointer;}',
  '.rl-switch__item:hover:not(:disabled){color:var(--dsw-alias-label-primary);}',
  '.rl-switch__item[aria-pressed="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--rl-shadow-1);}',
  '.rl-switch__item:disabled{color:var(--dsw-alias-label-caption);cursor:not-allowed;}',

  // ---- 导出菜单 -----------------------------------------------------------
  '.rl-export{position:relative;}',
  '.rl-export__toggle{list-style:none;cursor:pointer;}',
  '.rl-export__toggle::-webkit-details-marker{display:none;}',
  '.rl-export__menu{position:absolute;right:0;top:calc(100% + 6px);z-index:8;display:flex;flex-direction:column;min-width:148px;padding:var(--rl-space-1);border-radius:var(--rl-radius-md);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:var(--rl-shadow-2);}',
  '.rl-export__item{border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:var(--rl-font-sm);text-align:left;padding:6px 8px;border-radius:var(--rl-radius-sm);cursor:pointer;}',
  '.rl-export__item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}',
  '.rl-export__item:disabled{color:var(--dsw-alias-label-caption);cursor:not-allowed;}',

  // ---- 主体与书架 ---------------------------------------------------------
  '.rl-body{display:flex;flex:1 1 auto;min-height:0;position:relative;}',
  '.rl-library{display:flex;flex-direction:column;width:var(--rl-side-w);min-width:240px;max-width:360px;border-right:var(--rl-line);background:var(--dsw-alias-bg-layer-1);flex:0 0 auto;min-height:0;}',
  '.rl-library__head{padding:var(--rl-space-2) var(--rl-space-3) var(--rl-space-1);display:flex;align-items:center;gap:var(--rl-space-2);}',
  '.rl-library__title{flex:1;font-size:var(--rl-font-xs);font-weight:var(--rl-weight-bold);letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);}',
  '.rl-library__search{padding:0 var(--rl-space-3) var(--rl-space-2);position:relative;}',
  '.rl-library__search .rl-input{padding-left:28px;}',
  '.rl-library__search-icon{position:absolute;left:20px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-caption);pointer-events:none;}',
  '.rl-library__list{flex:1 1 auto;overflow:auto;padding:0 var(--rl-space-2) var(--rl-space-2);margin:0;list-style:none;min-height:0;display:flex;flex-direction:column;gap:2px;}',
  '.rl-library__foot{padding:var(--rl-space-2) var(--rl-space-3);border-top:var(--rl-line);display:flex;align-items:center;gap:var(--rl-space-2);font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);}',
  '.rl-card{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:var(--rl-space-2);border:0;border-radius:var(--rl-radius-md);background:transparent;color:inherit;font:inherit;cursor:pointer;transition:background .12s ease;}',
  '.rl-card:hover{background:var(--dsw-alias-interactive-bg-hover);}',
  '.rl-card[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-active);}',
  '.rl-card__cover{display:flex;align-items:center;justify-content:center;width:32px;height:40px;flex:0 0 auto;border-radius:var(--rl-radius-sm);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:var(--rl-font-sm);font-weight:var(--rl-weight-bold);text-transform:uppercase;}',
  '.rl-card__text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;}',
  '.rl-card__title{font-size:var(--rl-font-md);font-weight:var(--rl-weight-medium);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.rl-card__meta{font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);display:flex;gap:6px;align-items:center;min-width:0;}',
  '.rl-card__meta-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.rl-pill{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:var(--rl-radius-pill);font-size:var(--rl-font-xs);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap;}',
  '.rl-pill--parsing{color:var(--dsw-alias-state-warn-secondary);}',
  '.rl-pill--failed{color:var(--dsw-alias-state-error-primary);}',
  '.rl-pill--unsupported{color:var(--dsw-alias-label-caption);}',

  // ---- 主区 ---------------------------------------------------------------
  '.rl-main{display:flex;flex:1 1 auto;min-width:0;min-height:0;position:relative;background:var(--dsw-alias-bg-base);}',
  '.rl-canvas{flex:1 1 auto;min-width:320px;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;}',
  '.rl-detail{width:360px;flex:0 0 auto;border-left:var(--rl-line);background:var(--dsw-alias-bg-layer-1);overflow:auto;}',
  '.rl-status{padding:6px var(--rl-space-3);font-size:var(--rl-font-sm);color:var(--dsw-alias-label-tertiary);}',

  // ---- 设置抽屉（R1）-----------------------------------------------------
  '.rl-settings{position:absolute;top:0;right:0;bottom:0;z-index:9;width:min(var(--rl-rail-w),100%);display:flex;flex-direction:column;border-left:var(--rl-line);background:var(--dsw-alias-bg-overlay);box-shadow:var(--rl-shadow-2);}',
  '.rl-settings__head{display:flex;align-items:center;gap:var(--rl-space-2);padding:var(--rl-space-3) var(--rl-space-4);border-bottom:var(--rl-line);}',
  '.rl-settings__title{margin:0;flex:1 1 auto;font-size:var(--rl-font-lg);font-weight:var(--rl-weight-bold);}',
  '.rl-settings__body{flex:1 1 auto;overflow:auto;padding:var(--rl-space-4);display:flex;flex-direction:column;gap:var(--rl-space-5);}',
  '.rl-settings__section{display:flex;flex-direction:column;gap:var(--rl-space-2);}',
  '.rl-settings__section-title{margin:0;font-size:var(--rl-font-xs);font-weight:var(--rl-weight-bold);letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);}',
  '.rl-settings__hint{margin:0;font-size:var(--rl-font-sm);line-height:1.6;color:var(--dsw-alias-label-tertiary);}',
  '.rl-settings__path{padding:6px var(--rl-space-2);border-radius:var(--rl-radius-sm);background:var(--dsw-alias-bg-layer-2);font-size:var(--rl-font-xs);line-height:1.5;color:var(--dsw-alias-label-secondary);word-break:break-all;}',
  '.rl-settings__warn{padding:6px var(--rl-space-2);border-radius:var(--rl-radius-sm);background:var(--dsw-alias-bg-layer-2);font-size:var(--rl-font-xs);line-height:1.5;color:var(--dsw-alias-state-warn-primary);}',
  '.rl-settings__row{display:flex;align-items:center;gap:var(--rl-space-2);}',
  '.rl-settings__row--wrap{flex-wrap:wrap;}',
  '.rl-settings__check{display:flex;align-items:center;gap:6px;font-size:var(--rl-font-sm);color:var(--dsw-alias-label-secondary);}',
  '.rl-settings__kv{display:flex;justify-content:space-between;gap:var(--rl-space-2);font-size:var(--rl-font-sm);color:var(--dsw-alias-label-secondary);padding:4px 0;}',
  '.rl-settings__kv span:last-child{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}',
  '.rl-settings__feedback{font-size:var(--rl-font-sm);color:var(--dsw-alias-state-success-primary);}',
  '.rl-settings__feedback--error{color:var(--dsw-alias-state-error-primary);}',

  // ---- 统一反馈（R3）-----------------------------------------------------
  '.rl-toasts{position:absolute;left:50%;bottom:var(--rl-space-5);transform:translateX(-50%);z-index:30;display:flex;flex-direction:column;align-items:center;gap:var(--rl-space-2);pointer-events:none;}',
  '.rl-toast{display:flex;align-items:center;gap:var(--rl-space-2);max-width:min(520px,80vw);padding:8px var(--rl-space-3);border-radius:var(--rl-radius-md);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:var(--rl-font-sm);box-shadow:var(--rl-shadow-2);pointer-events:auto;animation:rl-toast-in .16s ease-out;}',
  '.rl-toast__dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-tertiary);}',
  '.rl-toast--ok .rl-toast__dot{background:var(--dsw-alias-state-success-primary);}',
  '.rl-toast--error .rl-toast__dot{background:var(--dsw-alias-state-error-primary);}',
  '.rl-toast--error{color:var(--dsw-alias-state-error-primary);}',
  '.rl-toast__text{flex:1 1 auto;line-height:1.5;}',
  '.rl-toast__close{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer;opacity:.7;}',
  '.rl-toast__close:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover);}',
  '@keyframes rl-toast-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}',

  // ---- 询问 AI / 引导学习（同上列）--------------------------------------
  '.rl-ask{position:absolute;top:0;right:0;bottom:0;width:min(var(--rl-rail-w),100%);display:flex;flex-direction:column;border-left:var(--rl-line);background:var(--dsw-alias-bg-overlay);box-shadow:var(--rl-shadow-2);z-index:7;}',
  '.rl-ask__head{display:flex;align-items:center;gap:var(--rl-space-2);padding:var(--rl-space-3) var(--rl-space-4);border-bottom:var(--rl-line);}',
  '.rl-ask__body{flex:1 1 auto;overflow:auto;padding:var(--rl-space-3);color:var(--dsw-alias-label-tertiary);font-size:var(--rl-font-sm);}',
  '.rl-ask__foot{padding:var(--rl-space-2) var(--rl-space-3);border-top:var(--rl-line);display:flex;gap:var(--rl-space-2);}',
  '.rl-ask__scope{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);}',
  '.rl-ask__quick{display:flex;flex-wrap:wrap;gap:6px;padding:var(--rl-space-2) var(--rl-space-3);border-bottom:var(--rl-line);}',
  '.rl-chip{display:inline-flex;align-items:center;max-width:100%;padding:2px 8px;border-radius:var(--rl-radius-pill);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:var(--rl-font-xs);cursor:pointer;text-align:left;}',
  '.rl-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}',
  '.rl-chip:disabled{opacity:.5;cursor:default;}',
  '.rl-chip--active{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
  '.rl-ask__msg{margin:0 0 var(--rl-space-3);padding:var(--rl-space-2) 10px;border-radius:var(--rl-radius-md);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);}',
  '.rl-ask__msg--user{background:var(--dsw-alias-bg-layer-2);}',
  '.rl-ask__msg--assistant{border-left:2px solid var(--dsw-alias-brand-primary);}',
  '.rl-ask__msg-head{display:flex;align-items:center;gap:var(--rl-space-2);margin-bottom:4px;}',
  '.rl-ask__msg-role{font-size:var(--rl-font-xs);font-weight:var(--rl-weight-bold);color:var(--dsw-alias-label-secondary);}',
  '.rl-ask__msg-time{font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);}',
  '.rl-ask__msg-status{margin-left:auto;font-size:var(--rl-font-xs);color:var(--dsw-alias-state-warn-secondary);}',
  '.rl-ask__msg[data-status="failed"] .rl-ask__msg-status{color:var(--dsw-alias-state-error-primary);}',
  '.rl-ask__msg-text{margin:0 0 6px;font-size:var(--rl-font-md);line-height:1.65;color:var(--dsw-alias-label-primary);white-space:pre-wrap;}',
  '.rl-ask__msg-error{font-size:var(--rl-font-xs);color:var(--dsw-alias-state-error-primary);margin-top:4px;}',
  '.rl-ask__cites{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;}',
  '.rl-cite{font-size:var(--rl-font-xs);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-caption);background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:0 4px;}',
  '.rl-cite--button{border:0;cursor:pointer;color:var(--dsw-alias-brand-primary);text-decoration:underline;text-underline-offset:2px;}',
  '.rl-cite--button:hover{background:var(--dsw-alias-interactive-bg-hover);}',
  '.rl-cite--button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
  '.rl-cite--invalid{color:var(--dsw-alias-state-error-primary);text-decoration:line-through;cursor:not-allowed;}',
  '.rl-cite--static{color:var(--dsw-alias-label-secondary);}',
  '.rl-ask__cite-panel{margin-top:var(--rl-space-2);border-top:1px dashed var(--dsw-alias-border-l2);padding-top:var(--rl-space-2);display:flex;flex-direction:column;gap:6px;}',
  '.rl-ask__cite-head{display:flex;align-items:center;gap:6px;}',
  '.rl-ask__cite-meta{font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);}',
  '.rl-ask__cite-text{margin:0;font-size:var(--rl-font-sm);line-height:1.7;white-space:pre-wrap;border-radius:var(--rl-radius-sm);padding:6px 8px;background:var(--dsw-alias-bg-layer-1);}',
  '.rl-ask__cite-text--flash{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);}',
  '.rl-notes__generate{font-size:var(--rl-font-xs);}',
  '.rl-ask__feedback{display:flex;gap:4px;margin-top:6px;}',
  '.rl-ask__followups{display:flex;flex-direction:column;gap:6px;margin-top:var(--rl-space-2);padding-top:var(--rl-space-2);border-top:1px dashed var(--dsw-alias-border-l2);}',
  '.rl-ask__followups-title{font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);}',
  '.rl-ask__followup{white-space:normal;text-align:left;line-height:1.4;}',
  '.rl-ask__error{margin-bottom:var(--rl-space-2);padding:6px 8px;border-radius:var(--rl-radius-sm);font-size:var(--rl-font-xs);color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);}',
  '.rl-ask__notice{margin-bottom:var(--rl-space-2);font-size:var(--rl-font-xs);color:var(--dsw-alias-state-warn-secondary);}',
  '.rl-ask__hint{font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);}',

  // ---- 引导式学习浮层（v0.3 t20）-----------------------------------------
  '.rl-tutor{position:absolute;top:0;right:0;bottom:0;width:min(440px,100%);display:flex;flex-direction:column;border-left:var(--rl-line);background:var(--dsw-alias-bg-overlay);z-index:7;}',
  '.rl-tutor__head{display:flex;align-items:center;gap:var(--rl-space-2);padding:var(--rl-space-3) var(--rl-space-4);border-bottom:var(--rl-line);}',
  '.rl-tutor__title{margin:0;font-size:var(--rl-font-lg);font-weight:var(--rl-weight-bold);color:var(--dsw-alias-label-primary);}',
  '.rl-tutor__path{font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);}',
  '.rl-tutor__close{margin-left:auto;}',
  '.rl-tutor__progress{display:flex;align-items:center;gap:var(--rl-space-2);padding:var(--rl-space-2) var(--rl-space-4);border-bottom:var(--rl-line);}',
  '.rl-tutor__bar{flex:1 1 auto;height:6px;border-radius:var(--rl-radius-pill);background:var(--dsw-alias-bg-layer-2);overflow:hidden;}',
  '.rl-tutor__bar-fill{display:block;height:100%;background:var(--dsw-alias-brand-primary);}',
  '.rl-tutor__progress-text{font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);white-space:nowrap;}',
  '.rl-tutor__body{flex:1 1 auto;overflow:auto;padding:var(--rl-space-3) var(--rl-space-4);display:flex;flex-direction:column;gap:10px;}',
  '.rl-tutor__step{display:flex;flex-direction:column;gap:6px;padding:10px var(--rl-space-3);border-radius:var(--rl-radius-md);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);}',
  '.rl-tutor__step-index{font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);}',
  '.rl-tutor__step-title{margin:0;font-size:var(--rl-font-md);font-weight:var(--rl-weight-bold);color:var(--dsw-alias-label-primary);}',
  '.rl-tutor__step-summary{margin:0;font-size:var(--rl-font-sm);line-height:1.6;color:var(--dsw-alias-label-secondary);}',
  '.rl-tutor__question,.rl-tutor__hint{margin:0;font-size:var(--rl-font-sm);line-height:1.55;}',
  '.rl-tutor__question{color:var(--dsw-alias-label-primary);font-weight:var(--rl-weight-bold);}',
  '.rl-tutor__hint{color:var(--dsw-alias-label-caption);}',
  '.rl-tutor__cites{display:flex;flex-wrap:wrap;gap:4px;margin:0;}',
  '.rl-tutor__state{margin:0;font-size:var(--rl-font-xs);color:var(--dsw-alias-brand-primary);}',
  '.rl-tutor__answers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;}',
  '.rl-tutor__answer{padding:var(--rl-space-2) 10px;border-radius:var(--rl-radius-md);background:var(--dsw-alias-bg-layer-2);}',
  '.rl-tutor__answer-meta{font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);}',
  '.rl-tutor__answer-text{margin:4px 0 0;font-size:var(--rl-font-sm);line-height:1.6;white-space:pre-wrap;color:var(--dsw-alias-label-primary);}',
  '.rl-tutor__actions{display:flex;flex-wrap:wrap;gap:6px;}',
  '.rl-tutor__restart{display:flex;align-items:center;gap:6px;padding:var(--rl-space-2) var(--rl-space-4);border-top:var(--rl-line);flex-wrap:wrap;}',
  '.rl-tutor__restart-label{font-size:var(--rl-font-xs);color:var(--dsw-alias-label-caption);}',
  '.rl-tutor__foot{display:flex;align-items:center;gap:6px;padding:10px var(--rl-space-4);border-top:var(--rl-line);flex-wrap:wrap;}',
  '.rl-tutor__notice{font-size:var(--rl-font-xs);color:var(--dsw-alias-state-warn-secondary);flex-basis:100%;}',
  '.rl-tutor__error{font-size:var(--rl-font-xs);color:var(--dsw-alias-state-error-primary);flex-basis:100%;}',
  '.rl-tutor__empty{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:var(--rl-space-5);text-align:center;font-size:var(--rl-font-sm);color:var(--dsw-alias-label-tertiary);}',
  '.rl-tutor__empty--error{color:var(--dsw-alias-state-error-primary);}',

  // ---- 空态 ---------------------------------------------------------------
  '.rl-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--rl-space-2);padding:var(--rl-space-6);text-align:center;color:var(--dsw-alias-label-tertiary);max-width:420px;}',
  '.rl-empty__icon{width:44px;height:44px;color:var(--dsw-alias-label-caption);}',
  '.rl-empty__title{font-size:var(--rl-font-lg);font-weight:var(--rl-weight-bold);color:var(--dsw-alias-label-secondary);}',
  '.rl-empty__hint{font-size:var(--rl-font-sm);line-height:1.6;color:var(--dsw-alias-label-tertiary);}',
  '.rl-empty__actions{display:flex;gap:var(--rl-space-2);margin-top:var(--rl-space-1);}',

  // ---- 浮层兜底容器 -------------------------------------------------------
  '.rl-overlay{position:fixed;inset:0;z-index:40;display:flex;pointer-events:auto;background:var(--dsw-alias-bg-mask-drop);}',
  '.rl-overlay__frame{flex:1 1 auto;display:flex;flex-direction:column;margin:var(--rl-space-5);min-height:0;border-radius:var(--rl-radius-lg);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);overflow:hidden;}',
  '.rl-skeleton{width:100%;height:8px;border-radius:var(--rl-radius-sm);background:var(--dsw-alias-bg-skeleton);}',
  '.rl-file-input{display:none;}',
  '@media (prefers-reduced-motion: reduce){.rl-root *{transition:none !important;animation:none !important;}}',
].join('\n')