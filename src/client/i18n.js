/* i18n：文案来自 locale/*.json 的 ui 段（构建时内联成 DICTS），插件管理器读取同一份 meta。 */

var FALLBACK_LANG = 'zh'
var localeBinder = null

function normalizeLang(value) {
  if (typeof value !== 'string') return ''
  var lower = value.toLowerCase()
  if (lower.indexOf('zh') === 0) return 'zh'
  if (lower.indexOf('en') === 0) return 'en'
  return ''
}

function detectLang() {
  try {
    if (typeof navigator !== 'undefined') {
      var nav = normalizeLang(navigator.language || (navigator.languages && navigator.languages[0]))
      if (nav) return nav
    }
  } catch (error) {
    /* 非浏览器环境（渲染冒烟）时忽略 */
  }
  return FALLBACK_LANG
}

function formatDictText(key, params) {
  var lang = currentLang()
  var table = DICTS[lang] || DICTS[FALLBACK_LANG] || {}
  var text = table[key]
  if (typeof text !== 'string') text = (DICTS[FALLBACK_LANG] || {})[key]
  if (typeof text !== 'string') return key
  if (!params || typeof params !== 'object') return text
  return text.replace(/\{(\w+)\}/g, function (match, name) {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  })
}

function currentLang() {
  if (localeBinder && typeof localeBinder.current === 'string') {
    var bound = normalizeLang(localeBinder.current)
    if (bound) return bound
  }
  return detectLang()
}

/** 由 apply 注入：优先用宿主 locale 的当前语言与插值实现，失败退回内联字典。 */
function bindLocale(binder) {
  localeBinder = binder && typeof binder === 'object' ? binder : null
}

/** 面板内文案入口；key 形如 `library.empty.title`（03 §4.7）。 */
function t(key, params) {
  if (localeBinder && typeof localeBinder.t === 'function') {
    try {
      var translated = localeBinder.t(key, params)
      if (typeof translated === 'string' && translated !== '' && translated !== key) return translated
    } catch (error) {
      /* 宿主字典没注册成功时用内联字典 */
    }
  }
  return formatDictText(key, params)
}