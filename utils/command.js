function stripCqSegments(text) {
  return String(text || '')
    .replace(/(?<=\d)\[CQ:[^\]]*\](?=\d)/gi, ' ')
    .replace(/\[CQ:[^\]]*\]/gi, '')
}

const commandTextOverride = Symbol('commandTextOverride')
const emojiPattern = /(?:[0-9#*]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0E\uFE0F\u200D]+)/gu
const leadingEmojiPattern = /^(?:[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0E\uFE0F\u200D]+\s*)+/u

export function stripLeadingEmoji(text) {
  return text.replace(leadingEmojiPattern, '')
}

function stripCommandEmoji(text) {
  let ambiguous = false
  const result = text.replace(emojiPattern, (emoji, offset, source) => {
    if (/^[0-9#*]/.test(emoji) ||
      (/[a-z0-9]/i.test(source[offset - 1] || '') && /[a-z0-9]/i.test(source[offset + emoji.length] || ''))) {
      ambiguous = true
    }
    return ''
  }).trim()
  return ambiguous ? null : result
}

function hasSplitToken(e) {
  const message = Array.isArray(e?.message) ? e.message : []
  if (!message.length) return /[a-z0-9]\[CQ:[^\]]*\][a-z0-9]/i.test(String(e?.raw_message || ''))
  let previous = ''
  let separated = false
  for (const item of message) {
    if (item?.type !== 'text') {
      separated = true
      continue
    }
    const text = String(item.text ?? item.data?.text ?? '')
    if (separated && /[a-z0-9]$/i.test(previous) && /^[a-z0-9]/i.test(text)) return true
    if (text) previous = text
    separated = false
  }
  return false
}

function stripStructuredPayloads(input) {
  const text = stripCqSegments(input)
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<([a-z_][\w:.-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[a-z_][\w:.-]*\b[^>]*\/>/gi, '')
  let result = ''
  for (let i = 0; i < text.length;) {
    if (text[i] !== '{' && text[i] !== '[') {
      result += text[i++]
      continue
    }
    const stack = []
    let quoted = false
    let escaped = false
    let end = i
    for (; end < text.length; end++) {
      const char = text[end]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === '{' || char === '[') stack.push(char)
      else if (char === '}' || char === ']') {
        const open = stack.pop()
        if ((open === '{' && char !== '}') || (open === '[' && char !== ']')) break
        if (!stack.length) break
      }
    }
    const part = text.slice(i, end + 1)
    try {
      JSON.parse(part)
    } catch {
      result += part
    }
    i = end + 1
  }
  return result
}

class CommandCandidate extends RegExp {
  test(value) {
    const text = String(value ?? '')
    if (super.test(text)) return true
    const plain = stripStructuredPayloads(text)
    const withoutEmoji = this.stripEmoji ? stripCommandEmoji(plain) : stripLeadingEmoji(plain)
    return super.test(plain) || (withoutEmoji !== null && super.test(withoutEmoji))
  }
}

export function getCommandText(e) {
  if (typeof e?.[commandTextOverride] === 'string') return e[commandTextOverride]
  const message = Array.isArray(e?.message) ? e.message : []
  if (message.length) {
    const texts = message
      .filter(item => item?.type === 'text')
      .map(item => String(item.text ?? item.data?.text ?? ''))
    let text = ''
    let separated = false
    for (const item of message) {
      if (item?.type !== 'text') {
        separated = true
        continue
      }
      const part = String(item.text ?? item.data?.text ?? '')
      if (separated && /\d$/.test(text) && /^\d/.test(part)) text += ' '
      text += part
      separated = false
    }

    // Yunzai may remove a configured bot alias before matching rules.
    if (e.hasAlias && typeof e.msg === 'string' && e.msg) {
      const compact = texts.map(item => item.trim()).join('')
      const plain = stripStructuredPayloads(e.msg)
      const processed = compact.endsWith(e.msg) ? e.msg : compact.endsWith(plain) ? plain : ''
      if (processed) {
        const alias = compact.slice(0, -processed.length)
        if (alias && text.startsWith(alias)) text = text.slice(alias.length)
      }
    }
    return text.trim()
  }

  return stripCqSegments(e?.raw_message || e?.msg || '').trim()
}

export function getSimpleCommandText(e) {
  if (hasSplitToken(e)) return ''
  return stripCommandEmoji(getCommandText(e)) ?? ''
}

export function prepareCommandRules(instance) {
  for (const rule of instance.rule || []) {
    const original = rule.reg instanceof RegExp ? rule.reg : new RegExp(rule.reg)
    const flags = original.flags.replace(/[gy]/g, '')
    const exact = new RegExp(original.source, flags)
    const candidate = original.source.replace(/\\s\+/g, '\\s*')
    const handler = instance[rule.fnc]
    const stripEmoji = rule.stripEmoji === true || (original.source.endsWith('$') && !/\.\*|\.\+/.test(original.source))

    // The framework matches e.msg, which can include non-text JSON/XML segments.
    // Candidates are deliberately broad; only the real text may authorize a handler.
    rule.reg = new CommandCandidate(candidate, flags)
    rule.reg.stripEmoji = stripEmoji
    instance[rule.fnc] = async function (e = this.e) {
      const text = getCommandText(e)
      const parsed = stripEmoji ? getSimpleCommandText(e) : exact.test(text) ? text : stripLeadingEmoji(text)
      if (!exact.test(parsed)) return false
      if (parsed === text) return handler.call(this, e)

      const normalizedEvent = Object.create(e)
      Object.defineProperty(normalizedEvent, commandTextOverride, { value: parsed })
      const previous = this.e
      this.e = normalizedEvent
      try {
        return await handler.call(this, normalizedEvent)
      } finally {
        this.e = previous
      }
    }
  }
}
