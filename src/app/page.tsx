'use client'

import { useEffect, useMemo, useState } from 'react'
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
    `}</style>
    <div className="ad-slot" aria-label="Espaço reservado para publicidade">Publicidade</div>
    <div className={`app ${screen === 'home' ? 'home-layout' : ''}`}>
      {screen === 'home' && <section className="screen active home-screen">
        <div className="home-heading"><div className="brand">entrega<span>.rei</span></div><div className="user-chip"><div className="avatar">{userEmail.slice(0, 2).toUpperCase()}</div><span>{userEmail.split('@')[0]}</span></div></div>
        <div className="home-date">{dateLabel()}</div>
        <div className="home-weekly"><div><div className="home-weekly-label">Saldo da semana</div><div className="home-weekly-period">{transactionsLoading ? 'Carregando…' : `${weekItems.length} lançamento(s)`}</div></div><div className="home-weekly-value">{money(weekBalance)}</div></div>
        <div className="home-action">
          <div className="mic-orbit"><div className="mic-orbit-inner" /><button className="home-mic" aria-label="Registrar ganho ou gasto" onClick={() => openForm('income')}><Mic /></button></div>
          <h1>Registre um ganho ou gasto</h1><p>Toque no microfone e fale naturalmente.</p>
          <button className="home-confirm" onClick={() => openForm('income')}>Registrar lançamento</button>
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
      <nav className="nav"><button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}><HomeIcon />Início</button><button className={screen === 'add' ? 'active' : ''} onClick={() => openForm('income')}><PlusIcon />Lançar</button><button className={screen === 'reports' ? 'active' : ''} onClick={() => setScreen('reports')}><ChartIcon />Relatórios</button><button className={screen === 'history' ? 'active' : ''} onClick={() => setScreen('history')}><ListIcon />Histórico</button></nav>
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