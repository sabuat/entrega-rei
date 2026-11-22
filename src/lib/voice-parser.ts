export type VoiceKind = 'income' | 'expense'

export type VoiceDraft = {
  type: VoiceKind
  amount: string
  description: string
  category: string
  platform: string
}

type PlatformDefinition = {
  name: string
  aliases: string[]
}

const PLATFORMS: PlatformDefinition[] = [
  { name: 'iFood', aliases: ['ifood', 'i food'] },
  { name: 'Rappi', aliases: ['rappi'] },
  { name: 'Uber Flash', aliases: ['uber flash', 'uber'] },
  { name: 'Mercado Livre', aliases: ['mercado livre', 'mercado-livre', 'mercado livre flex', 'ml'] },
  { name: 'Shopee', aliases: ['shopee'] },
  { name: 'SHEIN', aliases: ['shein'] },
  { name: 'Amazon', aliases: ['amazon'] },
  { name: 'Loggi', aliases: ['loggi'] },
  { name: 'Lalamove', aliases: ['lalamove'] },
]

const INCOME_ACTIONS = [
  'recebi', 'recebeu', 'recebemos', 'ganhei', 'ganhou', 'ganhamos',
  'faturei', 'faturou', 'entrou', 'entraram', 'rendeu', 'renderam',
  'fiz', 'fizemos', 'consegui', 'entreguei',
]
const EXPENSE_ACTIONS = [
  'gastei', 'gastou', 'gastamos', 'paguei', 'pagou', 'pagamos',
  'comprei', 'comprou', 'compramos', 'abasteci', 'abasteceu',
  'desembolsei', 'custou', 'custaram', 'passei', 'investi',
]
const ACTIONS = [...INCOME_ACTIONS, ...EXPENSE_ACTIONS].sort((a, b) => b.length - a.length)

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4,
  cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14,
  quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60,
  setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100,
  duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500,
  seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
}

const NUMBER_WORD_PATTERN = Object.keys(SMALL_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join('|')

const ACTION_PATTERN = new RegExp(`\\b(?:${ACTIONS.join('|')})\\b`, 'i')

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseNumberWords(input: string): number {
  const words = normalize(input).split(/\s+/).filter(word => word !== 'e')
  let total = 0
  let group = 0

  for (const word of words) {
    if (word === 'mil') {
      total += (group || 1) * 1000
      group = 0
    } else if (SMALL_NUMBERS[word] !== undefined) {
      group += SMALL_NUMBERS[word]
    }
  }

  return total + group
}

function normalizeWithMap(value: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let previousWasSpace = true

  for (let index = 0; index < value.length; index++) {
    const normalizedChar = value[index].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    for (const char of normalizedChar) {
      if (/\s/.test(char)) {
        if (!previousWasSpace) {
          text += ' '
          map.push(index)
        }
        previousWasSpace = true
      } else {
        text += char
        map.push(index)
        previousWasSpace = false
      }
    }
  }

  return { text: text.trim(), map }
}

function parseWrittenAmount(clause: string): { amount: number; start: number; end: number } | null {
  const { text, map } = normalizeWithMap(clause)
  const pattern = new RegExp(
    `\\b((?:${NUMBER_WORD_PATTERN})(?:\\s+(?:e\\s+)?(?:${NUMBER_WORD_PATTERN}|mil))*)` +
    `(?:\\s+reais?)?(?:\\s+e\\s+(${NUMBER_WORD_PATTERN})\\s+centavos?)?`,
    'i',
  )
  const match = pattern.exec(text)
  if (!match || match.index === undefined) return null

  const after = text.slice(match.index + match[0].length)
  const before = text.slice(0, match.index)
  const contextual = /\b(reais?|real|r\$|valor|de|por)\b/.test(after) ||
    /\b(r\$|reais?|real)\b/.test(before) ||
    ACTION_PATTERN.test(text)
  if (!contextual) return null

  const whole = parseNumberWords(match[1])
  const cents = match[2] ? parseNumberWords(match[2]) : 0
  const amount = whole + cents / 100
  if (!Number.isFinite(amount) || amount <= 0) return null

  const start = map[match.index] ?? 0
  const lastIndex = match.index + match[0].length - 1
  const end = (map[lastIndex] ?? start) + 1
  return { amount, start, end }
}

function parseDigitAmount(clause: string): { amount: number; start: number; end: number } | null {
  const match = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i.exec(clause)
  if (!match || match.index === undefined) return null

  const raw = match[1]
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount <= 0) return null

  return {
    amount,
    start: match.index,
    end: match.index + match[0].length,
  }
}

function extractAmounts(clause: string): Array<{ amount: number; start: number; end: number }> {
  const digit = parseDigitAmount(clause)
  if (digit) return [digit]

  const written = parseWrittenAmount(clause)
  return written ? [written] : []
}

function splitIntoClauses(raw: string): string[] {
  const actionAlternation = ACTIONS.join('|')
  return raw
    .replace(/[.!?;\n]+/g, '|')
    .replace(
      new RegExp(`\\s+(?:e\\s+)?(?=${actionAlternation}\\b)`, 'gi'),
      '|',
    )
    .split('|')
    .map(part => part.trim())
    .filter(Boolean)
}

function detectKind(clause: string): VoiceKind {
  const text = normalize(clause)
  const hasExpense = new RegExp(`\\b(?:${EXPENSE_ACTIONS.join('|')})\\b`).test(text)
  const hasIncome = new RegExp(`\\b(?:${INCOME_ACTIONS.join('|')})\\b`).test(text)

  if (hasExpense && !hasIncome) return 'expense'
  if (hasIncome && !hasExpense) return 'income'

  // Verbos imperativos/descrições típicas de despesas.
  if (/\b(gasolina|combustivel|pedagio|almoco|jantar|lanche|manutencao|estacionamento)\b/.test(text)) {
    return 'expense'
  }
  return 'income'
}

function detectPlatform(clause: string): string {
  const text = normalize(clause)
  for (const platform of PLATFORMS) {
    if (platform.aliases.some(alias => new RegExp(`\\b${escapeRegExp(normalize(alias))}\\b`, 'i').test(text))) {
      return platform.name
    }
  }
  return ''
}

function detectCategory(clause: string, type: VoiceKind): string {
  const text = normalize(clause)

  if (type === 'income') {
    if (/\b(gorjeta|caixinha)\b/.test(text)) return 'Gorjetas'
    if (/\b(bonus|incentivo|premio)\b/.test(text)) return 'Bônus'
    if (/\b(entrega|corrida|frete)\b/.test(text)) return 'Delivery'
    return 'Delivery'
  }

  if (/\b(gasolina|combustivel|etanol|diesel|abasteci|posto)\b/.test(text)) return 'Combustível'
  if (/\b(pedagio|sem parar)\b/.test(text)) return 'Pedágio'
  if (/\b(almoco|jantar|comida|lanche|alimentacao|restaurante)\b/.test(text)) return 'Alimentação'
  if (/\b(agua|hidratacao|bebida)\b/.test(text)) return 'Hidratação'
  if (/\b(manutencao|oficina|pneu|oleo|reparo)\b/.test(text)) return 'Manutenção'
  if (/\b(estacionamento|estacionei)\b/.test(text)) return 'Estacionamento'
  return 'Outros'
}

function buildDescription(
  clause: string,
  amountRange: { start: number; end: number },
  platform: string,
): string {
  let description = `${clause.slice(0, amountRange.start)} ${clause.slice(amountRange.end)}`
  const removableActions = new RegExp(`\\b(?:${ACTIONS.join('|')})\\b`, 'gi')
  description = description
    .replace(removableActions, ' ')
    .replace(/\b(?:r\$|reais?|real|centavos?|hoje|ontem|de|do|da|dos|das|no|na|nos|nas|em|para|por|com|um|uma)\\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (platform) {
    const aliases = PLATFORMS.find(item => item.name === platform)?.aliases ?? [platform]
    for (const alias of aliases) {
      description = description.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'i'), ' ')
    }
  }

  description = description.replace(/\s+/g, ' ').trim()
  return description || (platform ? `Entrega ${platform}` : 'Lançamento por voz')
}
/**
 * Interpreta a transcrição pt-BR em um ou mais rascunhos.
 * Não salva dados: a tela deve sempre permitir revisão e confirmação.
 */
export function parseVoiceText(raw: string): VoiceDraft[] {
  if (!raw.trim()) return []

  const drafts: VoiceDraft[] = []

  for (const clause of splitIntoClauses(raw)) {
    const amounts = extractAmounts(clause)
    if (!amounts.length) continue

    const type = detectKind(clause)
    const platform = type === 'income' ? detectPlatform(clause) : ''
    const category = detectCategory(clause, type)

    for (const amount of amounts) {
      drafts.push({
        type,
        amount: amount.amount.toFixed(2),
        description: buildDescription(clause, amount, platform),
        category,
        platform,
      })
    }
  }

  return drafts
}
