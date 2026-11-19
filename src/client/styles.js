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
 */

var STYLES = [
  '.rl-root{display:flex;flex-direction:column;height:100%;min-height:0;font:inherit;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);}',
  '.rl-root *{box-sizing:border-box;}',
  '.rl-header{display:flex;align-items:center;gap:8px;height:48px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto;}',
  '.rl-header__title{font-size:14px;font-weight:600;white-space:nowrap;}',
  '.rl-header__subtitle{font-size:12px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
  '.rl-header__spacer{flex:1 1 auto;}',
  '.rl-header__count{font-size:12px;color:var(--dsw-alias-label-caption);white-space:nowrap;}',
  '.rl-header__warn{font-size:12px;color:var(--dsw-alias-state-warn-secondary);white-space:nowrap;}',
  '.rl-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;}',
  '.rl-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}',
  '.rl-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active);}',
  '.rl-btn:disabled{color:var(--dsw-alias-label-caption);cursor:not-allowed;}',
  '.rl-btn--primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);}',
  '.rl-btn--primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);}',
  '.rl-btn--ghost{border-color:transparent;background:transparent;}',
  '.rl-btn:focus-visible,.rl-input:focus-visible,.rl-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
  '.rl-body{display:flex;flex:1 1 auto;min-height:0;position:relative;}',
  '.rl-library{display:flex;flex-direction:column;width:280px;min-width:240px;max-width:360px;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);flex:0 0 auto;min-height:0;}',
  '.rl-library__head{padding:8px 12px;display:flex;align-items:center;gap:8px;}',
  '.rl-file-input{display:none;}',
  '.rl-header__error{color:var(--dsw-alias-state-error-primary);}',
  '.rl-library__title{flex:1;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);}',
  '.rl-input{width:100%;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;}',
  '.rl-input::placeholder{color:var(--dsw-alias-label-caption);}',
  '.rl-library__list{flex:1 1 auto;overflow:auto;padding:0 8px 8px;margin:0;list-style:none;min-height:0;}',
  '.rl-card{display:block;width:100%;text-align:left;padding:8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer;}',
  '.rl-card:hover{background:var(--dsw-alias-interactive-bg-hover);}',
  '.rl-card[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-active);}',
  '.rl-card__title{font-size:13px;font-weight:500;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.rl-card__meta{font-size:11px;color:var(--dsw-alias-label-caption);display:flex;gap:6px;align-items:center;}',
  '.rl-pill{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:6px;font-size:11px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);}',
  '.rl-pill--parsing{color:var(--dsw-alias-state-warn-secondary);}',
  '.rl-pill--failed{color:var(--dsw-alias-state-error-primary);}',
  '.rl-main{display:flex;flex:1 1 auto;min-width:0;min-height:0;position:relative;}',
  '.rl-canvas{flex:1 1 auto;min-width:320px;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;}',
  '.rl-detail{width:360px;flex:0 0 auto;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);overflow:auto;}',
  '.rl-ask{position:absolute;top:0;right:0;bottom:0;width:min(420px,40%);display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 0 0 1px var(--dsw-alias-border-l2);}',
  '.rl-ask__head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
  '.rl-ask__body{flex:1 1 auto;overflow:auto;padding:12px;color:var(--dsw-alias-label-tertiary);font-size:12px;}',
  '.rl-ask__foot{padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;gap:8px;}',
  '.rl-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:32px;text-align:center;color:var(--dsw-alias-label-tertiary);max-width:420px;}',
  '.rl-empty__icon{width:48px;height:48px;color:var(--dsw-alias-label-caption);}',
  '.rl-empty__title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-secondary);}',
  '.rl-empty__hint{font-size:12px;color:var(--dsw-alias-label-tertiary);}',
  '.rl-empty__actions{display:flex;gap:8px;margin-top:4px;}',
  '.rl-overlay{position:fixed;inset:0;z-index:40;display:flex;pointer-events:auto;background:var(--dsw-alias-bg-mask-drop);}',
  '.rl-overlay__frame{flex:1 1 auto;display:flex;flex-direction:column;margin:48px;min-height:0;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);overflow:hidden;}',
  '.rl-skeleton{width:100%;height:8px;border-radius:6px;background:var(--dsw-alias-bg-skeleton);}',
  '.rl-status{padding:6px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary);}',
  '.rl-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}',
  '@media (prefers-reduced-motion: reduce){.rl-root *{transition:none !important;animation:none !important;}}',
].join('\n')