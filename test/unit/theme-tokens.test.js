import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, it } from 'node:test'

/**
 * 主题 token 白名单（t27）。
 *
 * 来源：DSH 安装包 app.asar 内 223 个 .css 的 "--dsw-alias-X:" 定义（2026-11-20 取样，
 * 主要出处 @deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css）。
 * 这里只校验“名字是否存在”；取值随主题切换，故不锁色值。
 * 新增样式前先确认 token 在清单内；要补清单，先到安装包 CSS 里找到真实定义。
 */
const ALLOWED = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-document-preview',
  '--dsw-alias-bg-document-selection',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-bg-mask-2',
  '--dsw-alias-bg-mask-3',
  '--dsw-alias-bg-mask-drop',
  '--dsw-alias-bg-mask-photo',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-multi-select',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-bg-skeleton',
  '--dsw-alias-border-inverted',
  '--dsw-alias-border-inverted2',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l2-darkmode-thin',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-border-selected',
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-primary-invert',
  '--dsw-alias-brand-primary-new-colorprimary-new-color',
  '--dsw-alias-brand-text',
  '--dsw-alias-button-contrast-fill',
  '--dsw-alias-button-elevated-fill',
  '--dsw-alias-button-floating-fill',
  '--dsw-alias-button-floating-hover',
  '--dsw-alias-button-ghost-active-border',
  '--dsw-alias-button-ghost-active-fill',
  '--dsw-alias-button-ghost-active-hover',
  '--dsw-alias-button-info-fill',
  '--dsw-alias-button-info-hover',
  '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-button-tool-bar-fill',
  '--dsw-alias-button-tool-bar-fill-invisible',
  '--dsw-alias-button-tool-bar-hover',
  '--dsw-alias-card-fill',
  '--dsw-alias-card-fill-hover',
  '--dsw-alias-card-tile-fill',
  '--dsw-alias-chart-messages',
  '--dsw-alias-chart-system',
  '--dsw-alias-chart-tools',
  '--dsw-alias-code-diff-added',
  '--dsw-alias-code-diff-deleted',
  '--dsw-alias-file-diff-added-bg',
  '--dsw-alias-file-diff-added-gutter',
  '--dsw-alias-file-diff-added-marker',
  '--dsw-alias-file-diff-deleted-bg',
  '--dsw-alias-file-diff-deleted-gutter',
  '--dsw-alias-file-diff-deleted-marker',
  '--dsw-alias-hovercard-bg',
  '--dsw-alias-hovercard-label-primary',
  '--dsw-alias-hovercard-label-secondary',
  '--dsw-alias-hovercard-label-tertiary',
  '--dsw-alias-hovercard-state-done',
  '--dsw-alias-hovercard-state-error',
  '--dsw-alias-illustration-background',
  '--dsw-alias-illustration-backing',
  '--dsw-alias-illustration-detail',
  '--dsw-alias-illustration-inset',
  '--dsw-alias-illustration-shadow',
  '--dsw-alias-illustration-surface',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-interactive-bg-hover-danger',
  '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-json-tree-hover',
  '--dsw-alias-json-tree-icon',
  '--dsw-alias-json-tree-keyword',
  '--dsw-alias-json-tree-number',
  '--dsw-alias-json-tree-property',
  '--dsw-alias-json-tree-punctuation',
  '--dsw-alias-json-tree-string',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-deep-diving',
  '--dsw-alias-label-deep-diving-shimmer',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-label-document-preview',
  '--dsw-alias-label-on-color',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-bluish',
  '--dsw-alias-label-primary-dimmed',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-label-primary-inverted',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-shimmer',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-link',
  '--dsw-alias-markdown-citation',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-block-banner',
  '--dsw-alias-markdown-code-segment-selected',
  '--dsw-alias-markdown-code-segment-unselected',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-placeholder',
  '--dsw-alias-markdown-tag',
  '--dsw-alias-menu-group-header-fill',
  '--dsw-alias-menu-icon',
  '--dsw-alias-onboarding-accent',
  '--dsw-alias-onboarding-card-fill',
  '--dsw-alias-onboarding-checkbox-border',
  '--dsw-alias-onboarding-secondary-fill',
  '--dsw-alias-scrollbar-bg-l1',
  '--dsw-alias-scrollbar-bg-l2',
  '--dsw-alias-scrollbar-hover-l1',
  '--dsw-alias-scrollbar-hover-l2',
  '--dsw-alias-settings-card-fill',
  '--dsw-alias-settings-card-stroke',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary',
  '--dsw-alias-state-done-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-error-secondary',
  '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-success-secondary',
  '--dsw-alias-state-success-tertiary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-warn-secondary',
  '--dsw-alias-state-warn-tertiary',
  '--dsw-alias-switch-thumb',
  '--dsw-alias-toast-action',
  '--dsw-alias-toast-bg',
  '--dsw-alias-toast-label',
  '--dsw-alias-tooltip-bg',
  '--dsw-alias-tooltip-key-bg',
  '--dsw-alias-tooltip-label',
  '--dsw-alias-trajectory-accent',
  '--dsw-alias-turn-trigger-bg',
  '--dsw-alias-turn-trigger-bg-hover',
])

const SRC = path.resolve(import.meta.dirname, '../../src/client')

/** 曾经写错过的名字：主题里没有它们，写错会静默回落成透明/继承。 */
const KNOWN_BAD = [
  '--dsw-alias-bg-primary',
  '--dsw-alias-separator-primary',
  '--dsw-alias-border-l',
  '--dsw-alias-border-secondary',
  '--dsw-alias-label-inverse',
  '--dsw-alias-label-error',
]

async function listSourceFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listSourceFiles(full)))
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

function tokensIn(text) {
  return [...text.matchAll(/--dsw-alias-[a-z0-9-]+/g)].map((m) => m[0])
}

describe('theme tokens（src/client）', () => {
  it('允许清单非空且包含基础 token', () => {
    assert.ok(ALLOWED.size > 100, '白名单应包含 100 个以上 token')
    for (const name of [
      '--dsw-alias-bg-base',
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-border-l1',
      '--dsw-alias-label-primary',
      '--dsw-alias-label-primary-inverted',
      '--dsw-alias-brand-primary',
    ]) {
      assert.ok(ALLOWED.has(name), name + ' 应在允许清单里')
    }
  })

  it('历史错误名不在允许清单里（防止白名单被放宽）', () => {
    for (const name of KNOWN_BAD) assert.ok(!ALLOWED.has(name), name + ' 不存在于主题，不能进入白名单')
  })

  it('src/client 引用的每个 --dsw-alias-* 都真实存在', async () => {
    const files = await listSourceFiles(SRC)
    assert.ok(files.length >= 10, '应扫描到 src/client 下的源文件')
    const bad = []
    let seen = 0
    for (const file of files) {
      for (const token of tokensIn(await readFile(file, 'utf8'))) {
        seen += 1
        if (!ALLOWED.has(token)) bad.push(path.relative(SRC, file) + ': ' + token)
      }
    }
    assert.ok(seen > 0, '应至少引用一个主题 token')
    assert.deepEqual(bad, [], '引用不存在的主题 token：' + bad.join('; '))
  })

  it('styles.js 没有硬编码颜色', async () => {
    const raw = await readFile(path.join(SRC, 'styles.js'), 'utf8')
    // 注释里允许出现色值（解释对比度用），只检查真正拼进 CSS 的字符串。
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'styles.js 不应出现十六进制颜色')
    assert.doesNotMatch(css, /\brgba?\(/, 'styles.js 不应出现 rgb()/rgba()')
    assert.doesNotMatch(css, /\bhsla?\(/, 'styles.js 不应出现 hsl()/hsla()')
  })
})
