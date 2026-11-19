/**
 * 极简 JSON Schema 校验器（owner: qa，test helper）。
 *
 * 仓库 dependencies 必须为空（CT-PKG-08），所以不能引 ajv。这里只实现
 * `schema/export-v1.schema.json` 用到的子集：
 *   type（含数组）、const、enum、required、properties、additionalProperties、
 *   items、minItems、minimum、minLength、pattern、anyOf、$ref（仅本地 #/definitions）。
 *
 * 遇到不认识的关键字直接抛错，避免「校验通过」其实什么都没校验。
 */

const KNOWN = new Set([
  '$schema', '$id', 'title', 'description', 'definitions',
  'type', 'const', 'enum', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'minimum', 'minLength', 'pattern', 'anyOf', '$ref',
])

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

function matchesType(value, expected) {
  const actual = typeOf(value)
  if (expected === 'number') return actual === 'number' || actual === 'integer'
  return actual === expected
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref: ${ref}`)
  let node = root
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part]
    if (node === undefined) throw new Error(`unresolvable $ref: ${ref}`)
  }
  return node
}

/**
 * @param {any} schema
 * @param {any} value
 * @param {{ path?: string, root?: any, errors: string[] }} ctx
 */
function validateNode(schema, value, ctx) {
  const root = ctx.root ?? schema
  if (schema === true) return
  if (schema === false) {
    ctx.errors.push(`${ctx.path}: schema is false`)
    return
  }
  if (typeof schema !== 'object' || schema === null) throw new Error('schema must be an object')

  if (schema.$ref) {
    validateNode(resolveRef(root, schema.$ref), value, { ...ctx, root })
    return
  }
  for (const key of Object.keys(schema)) {
    if (!KNOWN.has(key)) throw new Error(`unsupported schema keyword: ${key}`)
  }

  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!expected.some((type) => matchesType(value, type))) {
      ctx.errors.push(`${ctx.path}: expected ${expected.join('|')}, got ${typeOf(value)}`)
      return
    }
  }
  if (schema.const !== undefined && value !== schema.const) {
    ctx.errors.push(`${ctx.path}: expected const ${JSON.stringify(schema.const)}`)
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    ctx.errors.push(`${ctx.path}: not in enum`)
  }
  if (Array.isArray(schema.anyOf)) {
    const outcomes = schema.anyOf.map((candidate) => {
      const errors = []
      validateNode(candidate, value, { path: ctx.path, root, errors })
      return errors
    })
    if (!outcomes.some((errors) => errors.length === 0)) {
      ctx.errors.push(`${ctx.path}: no anyOf branch matched`)
    }
  }

  if (typeOf(value) === 'object') {
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!(key in value)) ctx.errors.push(`${ctx.path}: missing required ${key}`)
    }
    const properties = schema.properties ?? {}
    for (const [key, child] of Object.entries(properties)) {
      if (key in value) {
        validateNode(child, value[key], { path: `${ctx.path}.${key}`, root, errors: ctx.errors })
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) ctx.errors.push(`${ctx.path}: unexpected property ${key}`)
      }
    } else if (typeof schema.additionalProperties === 'object') {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          validateNode(schema.additionalProperties, value[key], {
            path: `${ctx.path}.${key}`,
            root,
            errors: ctx.errors,
          })
        }
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      ctx.errors.push(`${ctx.path}: expected at least ${schema.minItems} items`)
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => {
        validateNode(schema.items, item, { path: `${ctx.path}[${index}]`, root, errors: ctx.errors })
      })
    }
  }

  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) {
    ctx.errors.push(`${ctx.path}: ${value} < minimum ${schema.minimum}`)
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && Array.from(value).length < schema.minLength) {
      ctx.errors.push(`${ctx.path}: shorter than minLength ${schema.minLength}`)
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      ctx.errors.push(`${ctx.path}: does not match ${schema.pattern}`)
    }
  }
}

/**
 * @param {any} schema 已解析的 schema 对象
 * @param {any} value 待校验的数据
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(schema, value) {
  const errors = []
  validateNode(schema, value, { path: '$', root: schema, errors })
  return { valid: errors.length === 0, errors }
}

export function assertValid(schema, value, assert) {
  const result = validate(schema, value)
  assert.deepEqual(result.errors, [], `schema violations: ${result.errors.join('; ')}`)
}