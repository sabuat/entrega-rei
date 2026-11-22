'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Screen = 'home' | 'add' | 'reports' | 'history'
type Kind = 'income' | 'expense'
type Transaction = {
  id: string
  type: Kind
  amount: number
  description: string
  category: string
  platform: string
  date: string
}

type VoiceDraft = {
  type: Kind
  amount: string
  description: string
  category: string
  platform: string
}

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type DbTransaction = {
  id: string
  type: Kind
  amount: number | string
  description: string | null
  category: string
  platform: string | null
  occurred_at: string
}

const platforms = ['iFood', 'Rappi', 'Uber Flash', 'Mercado Livre', 'Shopee', 'SHEIN', 'Amazon', 'Loggi', 'Lalamove', 'Outra']
const incomeCategories = ['Delivery', 'Entregas', 'Gorjetas', 'Bônus', 'Outras receitas']
const expenseCategories = ['Combustível', 'Pedágio', 'Alimentação', 'Hidratação', 'Manutenção', 'Estacionamento', 'Outros']
const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dateLabel = () => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date()).toUpperCase()

function localDateFromTimestamp(value: string) {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateToTimestamp(value: string) {
  // Meio-dia local evita que a data mude ao converter para UTC.
  return new Date(`${value}T12:00:00`).toISOString()
}

function fromDatabase(row: DbTransaction): Transaction {
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    description: row.description ?? '',
    category: row.category,
    platform: row.platform ?? '',
    date: localDateFromTimestamp(row.occurred_at),
  }
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('home')
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [transactionsLoading, setTransactionsLoading] = useState(true)
  const [type, setType] = useState<Kind>('income')
  const [filter, setFilter] = useState<'all' | Kind>('all')
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [editing, setEditing] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(incomeCategories[0])
  const [platform, setPlatform] = useState('')
  const [date, setDate] = useState(today())
  const [toast, setToast] = useState('')
  const [saving, setSaving] = useState(false)
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'review'>('idle')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const [voiceText, setVoiceText] = useState('')
  const [voiceDrafts, setVoiceDrafts] = useState<VoiceDraft[]>([])
  const [voiceError, setVoiceError] = useState('')

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let mounted = true

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setUserEmail(session?.user?.email ?? null)
      setUserId(session?.user?.id ?? null)
      setAuthReady(true)
    })

    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return
      if (error) {
        setUserEmail(null)
        setUserId(null)
      } else {
        setUserEmail(data.user?.email ?? null)
        setUserId(data.user?.id ?? null)
      }
      setAuthReady(true)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [supabase])

  async function loadTransactions(id: string) {
    setTransactionsLoading(true)
    const { data, error } = await supabase
      .from('transactions')
      .select('id, type, amount, description, category, platform, occurred_at')
      .eq('user_id', id)
      .order('occurred_at', { ascending: false })

    if (error) {
      console.error('Erro ao carregar lançamentos:', error)
      notify('Não foi possível carregar seus lançamentos.')
      setTransactions([])
    } else {
      setTransactions((data ?? []).map(row => fromDatabase(row as DbTransaction)))
    }
    setTransactionsLoading(false)
  }

  useEffect(() => {
    if (!authReady) return
    if (!userId) {
      setTransactions([])
      setTransactionsLoading(false)
      return
    }
    void loadTransactions(userId)
    // A consulta deve ser refeita quando a sessão autenticada mudar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, userId, supabase])

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2500)
  }

  const totals = useMemo(() => {
    const income = transactions.filter(x => x.type === 'income').reduce((s, x) => s + x.amount, 0)
    const expense = transactions.filter(x => x.type === 'expense').reduce((s, x) => s + x.amount, 0)
    return { income, expense, balance: income - expense }
  }, [transactions])

  const weekStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  const weekItems = transactions.filter(x => x.date >= weekStart && x.date <= today())
  const weekBalance = weekItems.reduce((s, x) => s + (x.type === 'income' ? x.amount : -x.amount), 0)
  const visible = transactions
    .filter(x => filter === 'all' || x.type === filter)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))


  function parseVoiceText(raw: string): VoiceDraft[] {
    const normalize = (value: string) =>
      value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

    const actionPattern =
      /\b(recebi|recebeu|ganhei|ganhou|fiz|faturei|entrou|entrou|rendeu|gastei|gastou|paguei|pagou|comprei|comprou|abasteci|abasteceu|desembolsei|despesa|custou|passei|investi)\b/i

    const clauses = raw
      .replace(/[.!?]+/g, '|')
      .replace(/\s+e\s+(?=(?:recebi|recebeu|ganhei|ganhou|fiz|faturei|entrou|rendeu|gastei|gastou|paguei|pagou|comprei|comprou|abasteci|abasteceu|desembolsei|passei|investi)\b)/gi, '|')
      .replace(/\s+(?:depois|tambem)\s+/gi, '|')
      .split(/[|;\n]+/)
      .map(part => part.trim())
      .filter(Boolean)

    const numberWords: Record<string, number> = {
      zero: 0, um: 1, uma: 1, dois: 2, duas: 2,
      tres: 3, quatro: 4, cinco: 5, seis: 6,
      sete: 7, oito: 8, nove: 9, dez: 10,
      onze: 11, doze: 12, treze: 13, catorze: 14,
      quatorze: 14, quinze: 15, dezesseis: 16,
      dezessete: 17, dezoito: 18, dezenove: 19,
      vinte: 20, trinta: 30, quarenta: 40,
      cinquenta: 50, sessenta: 60, setenta: 70,
      oitenta: 80, noventa: 90,
      cem: 100, cento: 100, duzentos: 200,
      duzentas: 200, trezentos: 300, trezentas: 300,
      quatrocentos: 400, quinhentos: 500,
      quinhentas: 500, seiscentos: 600,
      setecentos: 700, oitocentos: 800,
      novecentos: 900,
    }

    const numberPattern = Object.keys(numberWords)
      .sort((a, b) => b.length - a.length)
      .join('|')

    function parseWrittenNumber(value: string): number {
      const words = normalize(value).split(/\s+e\s+|\s+/).filter(Boolean)
      let total = 0
      let current = 0

      for (const word of words) {
        if (word === 'mil') {
          total += (current || 1) * 1000
          current = 0
        } else if (numberWords[word] !== undefined) {
          current += numberWords[word]
        }
      }

      return total + current
    }

    function extractAmount(clause: string): number | null {
      const digitMatch = clause.match(
        /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i
      )

      if (digitMatch) {
        const value = digitMatch[1].includes(',')
          ? digitMatch[1].replace(/\./g, '').replace(',', '.')
          : digitMatch[1]

        const amount = Number(value)
        return Number.isFinite(amount) && amount > 0 ? amount : null
      }

      const writtenMatch = normalize(clause).match(
        new RegExp(`\\b(?:${numberPattern})(?:\\s+e\\s+(?:${numberPattern}))*\\b`, 'i')
      )

      if (!writtenMatch) return null

      const afterNumber = normalize(clause.slice(
        writtenMatch.index! + writtenMatch[0].length
      ))

      const hasCurrencyOrContext =
        /^\s*(?:reais?|real|de\b|no\b|na\b|do\b|da\b|em\b|para\b|com\b)/i.test(afterNumber)

      if (!hasCurrencyOrContext || !actionPattern.test(clause)) return null

      const amount = parseWrittenNumber(writtenMatch[0])
      return amount > 0 ? amount : null
    }

    const aliases: Record<string, string[]> = {
      'iFood': ['ifood', 'i food'],
      'Rappi': ['rappi'],
      'Uber Flash': ['uber flash', 'uber'],
      'Mercado Livre': ['mercado livre', 'mercado-livre', 'ml'],
      'Shopee': ['shopee'],
      'SHEIN': ['shein'],
      'Amazon': ['amazon'],
      'Loggi': ['loggi'],
      'Lalamove': ['lalamove'],
    }

    const drafts: VoiceDraft[] = []

    for (const clause of clauses) {
      const lower = normalize(clause)
      const amount = extractAmount(clause)

      if (!amount) continue

      const expenseWords =
        /\b(gastei|gastou|paguei|pagou|comprei|comprou|abasteci|abasteceu|desembolsei|despesa|custou|passei|investi)\b/

      const incomeWords =
        /\b(recebi|recebeu|ganhei|ganhou|fiz|faturei|entrou|rendeu)\b/

      const type: Kind = expenseWords.test(lower) && !incomeWords.test(lower)
        ? 'expense'
        : 'income'

      let foundPlatform = ''

      if (type === 'income') {
        for (const [platform, names] of Object.entries(aliases)) {
          if (names.some(name => {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            return new RegExp(`\\b${escaped}\\b`, 'i').test(lower)
          })) {
            foundPlatform = platform
            break
          }
        }
      }

      let category = type === 'income' ? 'Delivery' : 'Outros'

      if (type === 'expense') {
        if (/\b(gasolina|combustivel|etanol|diesel|abasteci|posto)\b/.test(lower)) {
          category = 'Combustível'
        } else if (/\b(pedagio|sem parar)\b/.test(lower)) {
          category = 'Pedágio'
        } else if (/\b(almoco|jantar|comida|lanche|alimentacao|restaurante)\b/.test(lower)) {
          category = 'Alimentação'
        } else if (/\b(agua|hidratacao|bebida)\b/.test(lower)) {
          category = 'Hidratação'
        } else if (/\b(manutencao|oficina|pneu|oleo|reparo)\b/.test(lower)) {
          category = 'Manutenção'
        } else if (/\b(estacionamento|estacionei)\b/.test(lower)) {
          category = 'Estacionamento'
        }
      } else if (/\b(gorjeta|caixinha)\b/.test(lower)) {
        category = 'Gorjetas'
      } else if (/\b(bonus|incentivo|premio)\b/.test(lower)) {
        category = 'Bônus'
      }

      let description = clause
        .replace(/(?:r\$\s*)?\d{1,3}(?:\.\d{3})*(?:[.,]\d{1,2})?/i, '')
        .replace(new RegExp(`\\b(?:${numberPattern})(?:\\s+e\\s+(?:${numberPattern}))*\\b`, 'i'), '')
        .replace(actionPattern, '')
        .replace(/\b(?:reais?|real|do|da|de|no|na|com|em|para|hoje|ontem)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (foundPlatform) {
        const platformRegex = new RegExp(
          aliases[foundPlatform].map(name =>
            name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          ).join('|'),
          'i'
        )
        description = description.replace(platformRegex, '').replace(/\s+/g, ' ').trim()
      }

      drafts.push({
        type,
        amount: amount.toFixed(2),
        description: description || (
          type === 'income'
            ? (foundPlatform ? `Entrega ${foundPlatform}` : 'Receita registrada por voz')
            : 'Despesa registrada por voz'
        ),
        category,
        platform: foundPlatform,
      })
    }

    return drafts
  }

  function startVoice() {
    if (recognitionRef.current || voiceState === 'listening') return
    setVoiceError('')
    setVoiceText('')
    setVoiceDrafts([])
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
    if (!Recognition) {
      setVoiceError('Seu navegador não oferece reconhecimento de voz. Use o botão Registrar lançamento para preencher manualmente.')
      return
    }
    const recognition = new Recognition()
    recognition.lang = 'pt-BR'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = event => {
      const transcript = Array.from(event.results).map(result => result[0]?.transcript ?? '').join(' ').trim()
      setVoiceText(transcript)
      const parsed = parseVoiceText(transcript)
      setVoiceDrafts(parsed)
      setVoiceState('review')
      if (!parsed.length) setVoiceError('Não consegui identificar valores. Tente dizer, por exemplo: “Recebi 180 reais do Mercado Livre e gastei 50 reais de gasolina”.')
    }
    recognition.onerror = event => {
      setVoiceState('idle')
      setVoiceError(event.error === 'not-allowed'
        ? 'Permita o acesso ao microfone nas configurações do navegador.'
        : 'Não foi possível captar sua voz. Tente novamente ou registre manualmente.')
    }
    recognition.onend = () => {
      recognitionRef.current = null
      setVoiceState(current => current === 'listening' ? 'idle' : current)
    }
    recognitionRef.current = recognition
    setVoiceState('listening')
    try { recognition.start() } catch {
      recognitionRef.current = null
      setVoiceState('idle')
      setVoiceError('Não foi possível iniciar o microfone. Tente novamente.')
    }
  }

  function stopVoice() {
    const recognition = recognitionRef.current
    if (!recognition) return
    try { recognition.stop() } catch { /* O reconhecimento pode já ter terminado. */ }
  }

  async function confirmVoiceDrafts() {
    if (!userId || !voiceDrafts.length) return
    const valid = voiceDrafts.filter(item => Number(item.amount.replace(',', '.')) > 0 && item.description.trim())
    if (!valid.length) {
      setVoiceError('Confira os valores e as descrições antes de salvar.')
      return
    }
    setSaving(true)
    const payload = valid.map(item => ({
      user_id: userId,
      type: item.type,
      amount: Number(item.amount.replace(',', '.')),
      description: item.description.trim(),
      category: item.category,
      platform: item.type === 'income' ? (item.platform || null) : null,
      occurred_at: dateToTimestamp(today()),
    }))
    const { error } = await supabase.from('transactions').insert(payload)
    if (error) {
      console.error('Erro ao salvar lançamentos por voz:', error)
      setVoiceError('Não foi possível salvar os lançamentos. Confira sua conexão e tente novamente.')
      setSaving(false)
      return
    }
    await loadTransactions(userId)
    setVoiceState('idle')
    setVoiceDrafts([])
    setVoiceText('')
    setVoiceError('')
    setSaving(false)
    notify(`${valid.length} lançamento(s) salvo(s)!`)
  }

  function openForm(kind: Kind, item?: Transaction) {
    setType(kind)
    setEditing(item?.id ?? null)
    setAmount(item ? String(item.amount) : '')
    setDescription(item?.description ?? '')
    setCategory(item?.category ?? (kind === 'income' ? incomeCategories[0] : expenseCategories[0]))
    setPlatform(item?.platform ?? '')
    setDate(item?.date ?? today())
    setScreen('add')
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!userId) {
      notify('Sua sessão expirou. Entre novamente.')
      return
    }

    const value = Number(amount.replace(',', '.'))
    if (!value || value <= 0 || !description.trim()) return

    setSaving(true)
    const payload = {
      user_id: userId,
      type,
      amount: value,
      description: description.trim(),
      category,
      platform: type === 'income' ? (platform || null) : null,
      occurred_at: dateToTimestamp(date),
    }

    const result = editing
      ? await supabase.from('transactions').update(payload).eq('id', editing).eq('user_id', userId)
      : await supabase.from('transactions').insert(payload)

    if (result.error) {
      console.error('Erro ao salvar lançamento:', result.error)
      notify('Não foi possível salvar. Tente novamente.')
      setSaving(false)
      return
    }

    await loadTransactions(userId)
    setScreen(editing ? 'history' : 'home')
    notify(editing ? 'Lançamento atualizado!' : 'Lançamento salvo!')
    setEditing(null)
    setAmount('')
    setDescription('')
    setSaving(false)
  }

  async function remove(id: string) {
    if (!userId || !window.confirm('Excluir este lançamento?')) return

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) {
      console.error('Erro ao excluir lançamento:', error)
      notify('Não foi possível excluir o lançamento.')
      return
    }

    setTransactions(old => old.filter(x => x.id !== id))
    notify('Lançamento excluído.')
  }

  const selected = transactions.filter(x => {
    const d = new Date(`${x.date}T12:00:00`)
    const now = new Date()
    if (period === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    return d >= start && d <= now
  })
  const reportIncome = selected.filter(x => x.type === 'income').reduce((s, x) => s + x.amount, 0)
  const reportExpense = selected.filter(x => x.type === 'expense').reduce((s, x) => s + x.amount, 0)

  if (!authReady) return <main className="auth-loading">Carregando Entrega.rei…</main>
  if (!userEmail) return <main className="auth-gate"><div className="brand">entrega<span>.rei</span></div><p>Entre para registrar seus ganhos e gastos.</p><button className="primary" onClick={async () => { await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } }) }}>Entrar com Google</button></main>

  return <>
    <style jsx global>{`
      html, body { margin: 0; min-height: 100%; }
      body:has(.app.home-layout) { height: 100%; overflow: hidden !important; }
      .ad-slot { flex: 0 0 58px; height: 58px; min-height: 58px; box-sizing: border-box; }
      .app.home-layout {
        height: calc(100dvh - 58px);
        max-height: calc(100dvh - 58px);
        min-height: 0;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        overflow: hidden !important;
      }
      .app.home-layout .home-screen {
        flex: 1 1 auto;
        min-height: 0;
        height: auto;
        max-height: 100%;
        overflow: hidden !important;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
      }
      .app.home-layout .home-heading,
      .app.home-layout .home-date,
      .app.home-layout .home-weekly { flex: 0 0 auto; }
      .app.home-layout .home-action {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        padding-top: clamp(4px, 1.5vh, 14px);
        padding-bottom: clamp(4px, 1.5vh, 14px);
        box-sizing: border-box;
      }
      .app.home-layout .mic-orbit {
        flex: 0 1 auto;
        width: clamp(112px, 22vh, 176px);
        height: clamp(112px, 22vh, 176px);
        max-width: min(22vh, 176px);
        max-height: min(22vh, 176px);
      }
      .app.home-layout .home-action h1 { margin-top: clamp(8px, 1.5vh, 16px); margin-bottom: 4px; }
      .app.home-layout .home-action p { margin-top: 4px; margin-bottom: clamp(8px, 1.5vh, 16px); }
      .app.home-layout .home-confirm { flex: 0 0 auto; }
      .app.home-layout .nav { flex: 0 0 auto; margin-top: auto; }
      @media (max-height: 680px) {
        .app.home-layout .home-action .mic-orbit { width: 108px; height: 108px; }
        .app.home-layout .home-action h1 { font-size: clamp(16px, 2.4vh, 20px); }
        .app.home-layout .home-action p { font-size: 12px; }
      }

      /* Estrutura global: publicidade fixa e rolagem somente no conteúdo */
      body:has(.app-shell) {
        height: 100dvh !important;
        min-height: 0 !important;
        overflow: hidden !important;
        padding: 0 !important;
      }
      .app-shell {
        width: min(100%, 440px);
        height: 100dvh;
        min-height: 0;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
      }
      .app-shell > .ad-slot {
        flex: 0 0 58px;
        width: 100%;
        height: 58px;
        min-height: 58px;
        margin: 0;
      }
      .app-shell > .app {
        flex: 1 1 auto;
        width: 100%;
        max-width: none;
        height: 0;
        min-height: 0;
        max-height: none;
        margin: 0;
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
      }
      .app-shell > .app.home-layout {
        height: auto;
        overflow: hidden !important;
      }
      .app-shell > .app.home-layout .home-screen {
        height: 100%;
        min-height: 0;
      }
      @media (min-width: 600px) {
        body:has(.app-shell) { padding: 0 !important; }
        .app-shell { height: 100dvh; border-radius: 0; }
        .app-shell > .app { border-radius: 0; }
      }
      /* O círculo decorativo não pode interceptar o toque no microfone. */
      .mic-orbit-inner { pointer-events: none !important; }
      .home-mic { position: relative; z-index: 2; cursor: pointer; touch-action: none; pointer-events: auto; user-select: none; -webkit-user-select: none; }
      .home-mic.is-listening { animation: voice-pulse 1.1s ease-in-out infinite; }
      .home-mic:disabled { cursor: wait; }
      @keyframes voice-pulse { 50% { transform: scale(1.07); box-shadow: 0 0 0 14px rgba(83, 190, 139, .15); } }
      .voice-error { color: #d98b77; font-size: 12px; line-height: 1.45; text-align: center; max-width: 300px; }
      .voice-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(5, 12, 24, .82); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
      .voice-panel { width: min(100%, 420px); max-height: min(88dvh, 760px); overflow-y: auto; background: #101d32; color: #f5f7fb; border: 1px solid rgba(255,255,255,.12); border-radius: 20px; padding: 22px; box-sizing: border-box; position: relative; }
      .voice-panel h2 { font-size: 21px; margin: 0 34px 12px 0; }
      .voice-close { position: absolute; right: 16px; top: 12px; border: 0; background: transparent; color: #fff; font-size: 28px; cursor: pointer; }
      .voice-transcript { color: #b7c4d8; font-size: 13px; line-height: 1.5; padding: 10px 12px; background: rgba(255,255,255,.06); border-radius: 10px; }
      .voice-draft { border-top: 1px solid rgba(255,255,255,.12); padding: 14px 0; display: grid; gap: 10px; }
      .voice-draft label { display: grid; gap: 5px; color: #b7c4d8; font-size: 12px; }
      .voice-draft input, .voice-draft select { width: 100%; min-height: 42px; border-radius: 9px; border: 1px solid rgba(255,255,255,.18); background: #172740; color: #fff; padding: 9px 10px; box-sizing: border-box; font: inherit; }
      .voice-draft .type-switch { display: flex; gap: 8px; }
      .voice-remove, .voice-again { border: 0; background: transparent; color: #9ec9f1; padding: 9px; cursor: pointer; }
      .voice-panel > .primary { width: 100%; margin-top: 8px; }
      .voice-again { width: 100%; }
    `}</style>
    <div className="app-shell">
      <div className="ad-slot" aria-label="Espaço reservado para publicidade">Publicidade</div>
      <div className={`app ${screen === 'home' ? 'home-layout' : ''}`}>
      {screen === 'home' && <section className="screen active home-screen">
        <div className="home-heading"><div className="brand">entrega<span>.rei</span></div><div className="user-chip"><div className="avatar">{userEmail.slice(0, 2).toUpperCase()}</div><span>{userEmail.split('@')[0]}</span></div></div>
        <div className="home-date">{dateLabel()}</div>
        <div className="home-weekly"><div><div className="home-weekly-label">Saldo da semana</div><div className="home-weekly-period">{transactionsLoading ? 'Carregando…' : `${weekItems.length} lançamento(s)`}</div></div><div className="home-weekly-value">{money(weekBalance)}</div></div>
        <div className="home-action">
          <div className="mic-orbit"><div className="mic-orbit-inner" /><button type="button" className={`home-mic ${voiceState === 'listening' ? 'is-listening' : ''}`} aria-label="Mantenha pressionado para falar" onPointerDown={event => { event.preventDefault(); startVoice() }} onPointerUp={event => { event.preventDefault(); stopVoice() }} onPointerLeave={stopVoice} onPointerCancel={stopVoice} onContextMenu={event => event.preventDefault()}><Mic /></button></div>
          <h1>Registre um ganho ou gasto</h1><p>{voiceState === 'listening' ? 'Solte o microfone para finalizar.' : 'Mantenha o microfone pressionado enquanto fala.'}</p>
          <button className="home-confirm" onClick={() => openForm('income')}>Registrar lançamento</button>
          {voiceError && <p className="voice-error" role="alert">{voiceError}</p>}
        </div>
      </section>}
      {screen === 'add' && <section className="screen active"><button className="back" onClick={() => setScreen('home')}>← Início</button><h1 className="page-title">{editing ? 'Editar lançamento' : 'Novo lançamento'}</h1><p className="sub">Registre o valor que entrou ou saiu.</p><div className="form-card">
        <div className="type-switch"><button type="button" className={type === 'income' ? 'selected' : ''} onClick={() => { setType('income'); setCategory(incomeCategories[0]) }}>＋ Receita</button><button type="button" className={type === 'expense' ? 'selected' : ''} onClick={() => { setType('expense'); setCategory(expenseCategories[0]) }}>－ Despesa</button></div>
        <form onSubmit={save}><div className="field"><label>Valor (R$)</label><input type="number" min="0.01" step="0.01" placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value)} required /></div>
          <div className="field"><label>Descrição</label><input placeholder="Ex.: Entrega Mercado Livre" value={description} onChange={e => setDescription(e.target.value)} required /></div>
          {type === 'income' && <div className="field"><label>Plataforma</label><select value={platform} onChange={e => setPlatform(e.target.value)}><option value="">Selecione (opcional)</option>{platforms.map(p => <option key={p}>{p}</option>)}</select></div>}
          <div className="field"><label>Categoria</label><select value={category} onChange={e => setCategory(e.target.value)}>{(type === 'income' ? incomeCategories : expenseCategories).map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label>Data</label><input type="date" value={date} onChange={e => setDate(e.target.value)} required /></div><button className="primary" type="submit" disabled={saving}>{saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Salvar lançamento'}</button></form>
      </div></section>}
      {screen === 'history' && <section className="screen active"><h1 className="page-title">Histórico</h1><p className="sub">Todas as suas movimentações em um só lugar.</p><div className="filter">{(['all', 'income', 'expense'] as const).map(f => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'Todas' : f === 'income' ? 'Receitas' : 'Despesas'}</button>)}</div><div className="card">{transactionsLoading ? <div className="empty">Carregando lançamentos…</div> : visible.length ? visible.map(x => <Movement key={x.id} item={x} onEdit={() => openForm(x.type, x)} onDelete={() => void remove(x.id)} />) : <div className="empty">Nenhuma movimentação encontrada.</div>}</div></section>}
      {screen === 'reports' && <section className="screen active"><h1 className="page-title">Relatórios</h1><p className="sub">Entenda como está o resultado do seu trabalho.</p><div className="filter"><button className={period === 'week' ? 'active' : ''} onClick={() => setPeriod('week')}>Semana</button><button className={period === 'month' ? 'active' : ''} onClick={() => setPeriod('month')}>Mês</button></div><div className="balance"><div className="eyebrow">RESULTADO {period === 'week' ? 'DA SEMANA' : 'DO MÊS'}</div><div className="amount">{money(reportIncome - reportExpense)}</div><div className="balance-grid"><div><small>Receitas</small><strong className="positive">{money(reportIncome)}</strong></div><div><small>Despesas</small><strong className="negative">{money(reportExpense)}</strong></div></div></div><div className="stat-grid"><div className="stat"><small>Lançamentos</small><strong>{selected.length}</strong></div><div className="stat"><small>Saldo semanal atual</small><strong>{money(weekBalance)}</strong></div></div><p className="hint">Os valores são calculados a partir dos lançamentos salvos na sua conta.</p></section>}
      {voiceState === 'review' && <div className="voice-overlay" role="dialog" aria-modal="true" aria-labelledby="voice-review-title">
        <div className="voice-panel">
          <button className="voice-close" onClick={() => { setVoiceState('idle'); setVoiceDrafts([]); setVoiceError('') }} aria-label="Fechar">×</button>
          <h2 id="voice-review-title">Confira seus lançamentos</h2>
          <p className="voice-transcript">“{voiceText}”</p>
          {voiceDrafts.map((item, index) => <div className="voice-draft" key={index}>
            <div className="type-switch"><button type="button" className={item.type === 'income' ? 'selected' : ''} onClick={() => setVoiceDrafts(old => old.map((x, i) => i === index ? { ...x, type: 'income', category: incomeCategories[0] } : x))}>＋ Receita</button><button type="button" className={item.type === 'expense' ? 'selected' : ''} onClick={() => setVoiceDrafts(old => old.map((x, i) => i === index ? { ...x, type: 'expense', category: expenseCategories[0], platform: '' } : x))}>－ Despesa</button></div>
            <label>Valor (R$)<input type="number" min="0.01" step="0.01" value={item.amount} onChange={e => setVoiceDrafts(old => old.map((x, i) => i === index ? { ...x, amount: e.target.value } : x))} /></label>
            <label>Descrição<input value={item.description} onChange={e => setVoiceDrafts(old => old.map((x, i) => i === index ? { ...x, description: e.target.value } : x))} /></label>
            {item.type === 'income' && <label>Plataforma<select value={item.platform} onChange={e => setVoiceDrafts(old => old.map((x, i) => i === index ? { ...x, platform: e.target.value } : x))}><option value="">Não informada</option>{platforms.map(p => <option key={p}>{p}</option>)}</select></label>}
            <label>Categoria<select value={item.category} onChange={e => setVoiceDrafts(old => old.map((x, i) => i === index ? { ...x, category: e.target.value } : x))}>{(item.type === 'income' ? incomeCategories : expenseCategories).map(c => <option key={c}>{c}</option>)}</select></label>
            <button type="button" className="voice-remove" onClick={() => setVoiceDrafts(old => old.filter((_, i) => i !== index))}>Remover lançamento</button>
          </div>)}
          {voiceError && <p className="voice-error" role="alert">{voiceError}</p>}
          <button className="primary" disabled={saving || !voiceDrafts.length} onClick={() => void confirmVoiceDrafts()}>{saving ? 'Salvando…' : 'Confirmar e salvar'}</button>
          <button className="voice-again" onClick={() => { setVoiceState('idle'); startVoice() }}>Gravar novamente</button>
        </div>
      </div>}
      <nav className="nav"><button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}><HomeIcon />Início</button><button className={screen === 'add' ? 'active' : ''} onClick={() => openForm('income')}><PlusIcon />Lançar</button><button className={screen === 'reports' ? 'active' : ''} onClick={() => setScreen('reports')}><ChartIcon />Relatórios</button><button className={screen === 'history' ? 'active' : ''} onClick={() => setScreen('history')}><ListIcon />Histórico</button></nav>
      </div>
    </div><div className="toast" style={{ opacity: toast ? 1 : 0 }}>{toast}</div>
  </>
}

function Movement({ item, onEdit, onDelete }: { item: Transaction; onEdit: () => void; onDelete: () => void }) {
  return <div className="movement"><div className="ico">{item.type === 'income' ? '+' : '−'}</div><div className="move-info"><b>{item.description}</b><small>{item.category}{item.platform ? ` · ${item.platform}` : ''} · {item.date.split('-').reverse().join('/')}</small></div><div className={`value ${item.type === 'income' ? 'in' : 'out'}`}>{item.type === 'income' ? '+' : '−'} {money(item.amount)}</div><div className="history-actions"><button onClick={onEdit}>Editar</button><button className="delete" onClick={onDelete}>Excluir</button></div></div>
}

function Mic() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M9 21.5h6" /></svg>
}
function HomeIcon() { return <svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></svg> }
function PlusIcon() { return <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg> }
function ChartIcon() { return <svg viewBox="0 0 24 24"><path d="M4 19V5m0 14h17M8 15l3-4 3 2 5-7" /></svg> }
function ListIcon() { return <svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg> }