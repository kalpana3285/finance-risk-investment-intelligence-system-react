import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import './App.css'

type Portfolio = { portfolio_id: number; portfolio_name: string; portfolio_manager?: string | null; risk_category?: string | null; total_value?: number | string | null; benchmark_index?: string | null }
type PortfolioDetail = Portfolio & { holdings: { holding_id: number; asset_name?: string | null; asset_type?: string | null; sector?: string | null; allocation_percentage?: number | string | null; market_value?: number | string | null }[]; risk_assessments: { risk_id: number; asset_name?: string | null; risk_type?: string | null; risk_score?: number | null; risk_level?: string | null; risk_description?: string | null; escalation_flag: boolean }[] }
type Citation = { source_id: string; source_title: string; source_version?: string | null; evidence_type: string; excerpt?: string | null; page_number?: number | null; section?: string | null; record_reference?: string | null }
type QueryResult = { query_id: string; status: string; answer?: string | null; citations: Citation[]; limitations: string[]; clarification_question?: string | null; escalation_id?: string | null; escalation_reason?: string | null; escalation_data_gaps: string[]; failure?: { code: string; message: string; retryable: boolean } | null }
type Escalation = { escalation_id: string; query_id: string; status: string; reason: string; created_at: string }
type EscalationDetail = Escalation & { question: string; requested_review: string; evidence: Citation[]; attempted_steps: string[]; data_gaps: string[]; answer?: string | null; limitations: string[]; reviewer_notes?: string | null; outcome?: string | null }
type View = 'overview' | 'research' | 'portfolios' | 'escalations' | 'ingestion'

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const money = (value?: number | string | null) => value == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value))
const titleCase = (value?: string | null) => value ? value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—'

function App() {
  const { isLoading, isAuthenticated, error: authError, loginWithRedirect, logout, getAccessTokenSilently, user } = useAuth0()
  const [view, setView] = useState<View>('overview')
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [selectedPortfolio, setSelectedPortfolio] = useState('')
  const [portfolioDetail, setPortfolioDetail] = useState<PortfolioDetail | null>(null)
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'degraded' | 'offline'>('checking')
  const [error, setError] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [activeEscalation, setActiveEscalation] = useState<EscalationDetail | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [reviewStatus, setReviewStatus] = useState('in_review')
  const [reviewOutcome, setReviewOutcome] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadResult, setUploadResult] = useState<Record<string, unknown> | null>(null)
  const [notice, setNotice] = useState('')

  const api = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const token = await getAccessTokenSilently()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
    let response: Response
    try {
      response = await fetch(`${apiBase}${path}`, { ...init, headers })
      setApiStatus('connected')
    } catch (cause) {
      setApiStatus('offline')
      if (cause instanceof TypeError) {
        const destination = apiBase || 'the local API at http://127.0.0.1:8000 (through the Vite proxy)'
        throw new Error(`Cannot reach ${destination}. Start the FRIIS backend and check its database connection, then retry.`)
      }
      throw cause
    }
    if (!response.ok) {
      let message = `Request failed (${response.status})`
      try { const payload = await response.json() as { detail?: unknown; message?: string }; message = typeof payload.detail === 'string' ? payload.detail : payload.message ?? message } catch { /* use status fallback */ }
      throw new Error(response.status === 403 ? `Your account does not have permission for this action. ${message}` : message)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }, [getAccessTokenSilently])

  useEffect(() => {
    if (!isAuthenticated) return
    const storageKey = `friis-session:${user?.sub ?? 'user'}`
    let id = sessionStorage.getItem(storageKey)
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(storageKey, id) }
    setSessionId(id)
    api<{ items: Portfolio[] }>('/api/v1/portfolios?limit=100').then((data) => setPortfolios(data.items)).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load portfolios.'))
  }, [api, isAuthenticated, user?.sub])

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    setApiStatus('checking')
    fetch(`${apiBase}/health`)
      .then(async (response) => {
        const health = await response.json() as { status?: string }
        if (!cancelled) setApiStatus(health.status === 'ok' ? 'connected' : health.status === 'degraded' ? 'degraded' : 'offline')
      })
      .catch(() => { if (!cancelled) setApiStatus('offline') })
    return () => { cancelled = true }
  }, [isAuthenticated])

  const loadEscalations = useCallback(async () => {
    const data = await api<{ items: Escalation[] }>('/api/v1/escalations?limit=50')
    setEscalations(data.items)
  }, [api])

  useEffect(() => {
    if (view === 'escalations') loadEscalations().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load escalations.'))
  }, [view, loadEscalations])

  const selectView = (next: View) => { setView(next); setError(''); setNotice(''); if (next !== 'portfolios') setPortfolioDetail(null) }

  const pollQuery = async (queryId: string) => {
    for (let attempt = 0; attempt < 140; attempt += 1) {
      const data = await api<QueryResult>(`/api/v1/queries/${encodeURIComponent(queryId)}`)
      setResult(data)
      if (!['queued', 'processing'].includes(data.status)) return
      await new Promise((resolve) => window.setTimeout(resolve, 1500))
    }
    throw new Error('This research request is taking longer than expected. You can check it again shortly.')
  }

  const checkQuery = async () => {
    if (!result) return
    setBusy(true); setError(''); setNotice('Checking the research request…')
    try { await pollQuery(result.query_id); setNotice('Research response is ready.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not check this research request.'); setNotice('') }
    finally { setBusy(false) }
  }

  const submitQuestion = async (event: FormEvent) => {
    event.preventDefault(); if (!question.trim()) return
    const portfolioContext = selectedPortfolio
      ? `\n\nSelected portfolio ID: ${selectedPortfolio}`
      : ''
    const submittedQuestion = `${question.trim()}${portfolioContext}`
    if (submittedQuestion.length > 4000) {
      setError('This question is too long after adding the selected portfolio ID. Shorten it and try again.')
      return
    }
    setBusy(true); setError(''); setResult(null); setNotice(selectedPortfolio ? `Research request submitted for Portfolio ID ${selectedPortfolio}. Gathering evidence…` : 'Research request submitted. Gathering evidence…')
    try {
      const submitted = await api<{ query_id: string }>('/api/v1/queries', { method: 'POST', body: JSON.stringify({ question: submittedQuestion, portfolio_id: selectedPortfolio ? Number(selectedPortfolio) : null, session_id: sessionId }) })
      await pollQuery(submitted.query_id); setNotice('Research response is ready.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not submit this question.'); setNotice('') }
    finally { setBusy(false) }
  }

  const resetMemory = async () => {
    if (!sessionId) return
    setBusy(true); setError('')
    try {
      await api(`/api/v1/sessions/${encodeURIComponent(sessionId)}/memory`, { method: 'DELETE' })
      const id = crypto.randomUUID(); sessionStorage.setItem(`friis-session:${user?.sub ?? 'user'}`, id); setSessionId(id); setResult(null); setNotice('Conversation memory cleared. A new research session has started.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not clear conversation memory.') }
    finally { setBusy(false) }
  }

  const openPortfolio = async (id: number) => { setError(''); setBusy(true); try { setPortfolioDetail(await api<PortfolioDetail>(`/api/v1/portfolios/${id}`)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not load this portfolio.') } finally { setBusy(false) } }
  const openEscalation = async (id: string) => { setError(''); try { const detail = await api<EscalationDetail>(`/api/v1/escalations/${encodeURIComponent(id)}`); setActiveEscalation(detail); setReviewNotes(detail.reviewer_notes ?? ''); setReviewStatus(detail.status); setReviewOutcome(detail.outcome ?? '') } catch (e) { setError(e instanceof Error ? e.message : 'Could not open escalation.') } }
  const saveReview = async (event: FormEvent) => { event.preventDefault(); if (!activeEscalation) return; setBusy(true); setError(''); try { const updated = await api<EscalationDetail>(`/api/v1/escalations/${encodeURIComponent(activeEscalation.escalation_id)}`, { method: 'PATCH', body: JSON.stringify({ status: reviewStatus, outcome: reviewOutcome || undefined, reviewer_notes: reviewNotes || undefined }) }); setActiveEscalation(updated); await loadEscalations(); setNotice('Escalation review saved.') } catch (e) { setError(e instanceof Error ? e.message : 'Could not save review.') } finally { setBusy(false) } }
  const uploadDocument = async (event: FormEvent) => { event.preventDefault(); if (!uploadFile) return; setBusy(true); setError(''); setUploadResult(null); const body = new FormData(); body.append('file', uploadFile); try { setUploadResult(await api<Record<string, unknown>>('/api/v1/admin/ingestions', { method: 'POST', body })); setNotice('Document processed and added to the knowledge collection.') } catch (e) { setError(e instanceof Error ? e.message : 'Document upload failed.') } finally { setBusy(false) } }

  if (isLoading) return <main className="auth-loading"><div className="brand-mark">F</div><p>Preparing your workspace…</p></main>
  if (!isAuthenticated) return <main className="login-shell"><section className="login-art"><div className="brand-lockup"><span className="brand-mark">F</span><span>FRIIS<span className="brand-sub">INTELLIGENCE</span></span></div><div className="login-message"><span className="eyebrow">FINANCE RISK &amp; INVESTMENT INTELLIGENCE</span><h1>Clarity for<br />every decision.</h1><p>Research portfolios, trace evidence, and surface risk with an AI workspace built for financial teams.</p><div className="login-proof"><span>01 / Evidence-led research</span><span>02 / Portfolio-aware analysis</span><span>03 / Human review built in</span></div></div><span className="art-foot">DECISION INTELLIGENCE · 2026</span></section><section className="login-panel"><div className="login-panel-inner"><span className="eyebrow">YOUR RESEARCH WORKSPACE</span><h2>Welcome to FRIIS</h2><p>Sign in to continue to your secure intelligence workspace.</p>{authError && <div className="alert error" role="alert">{authError.message}</div>}<button className="button primary full" onClick={() => loginWithRedirect()}>Sign in securely <span>↗</span></button><button className="button secondary full" onClick={() => loginWithRedirect({ authorizationParams: { screen_hint: 'signup' } })}>Create an account</button><div className="secure-note"><span>◈</span> Protected with Auth0 · Your data stays scoped to your access</div></div><span className="login-legal">For professional research support. Not investment advice.</span></section></main>

  return <div className="app-shell"><aside className="sidebar"><a className="brand-lockup" href="#overview" onClick={() => selectView('overview')}><span className="brand-mark">F</span><span>FRIIS<span className="brand-sub">INTELLIGENCE</span></span></a><div className="workspace-label">WORKSPACE</div><nav className="nav-list" aria-label="Main navigation">{([['overview', '◫', 'Overview'], ['research', '⌕', 'Research'], ['portfolios', '▤', 'Portfolios'], ['escalations', '△', 'Escalations'], ['ingestion', '↑', 'Knowledge base']] as [View, string, string][]).map(([key, icon, label]) => <button key={key} className={`nav-item ${view === key ? 'active' : ''}`} onClick={() => selectView(key)}><span className="nav-icon">{icon}</span>{label}{key === 'escalations' && escalations.length > 0 && <span className="nav-count">{escalations.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="status-card"><span className={`status-dot ${apiStatus}`}/><div><strong>Intelligence services</strong><small>{apiStatus === 'checking' ? 'Checking API…' : apiStatus === 'connected' ? 'API connected' : apiStatus === 'degraded' ? 'API limited · worker offline' : 'API unavailable'}</small></div></div><div className="data-note">◈ <span>Analysis is grounded in available evidence. Always apply professional judgment.</span></div></div></aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <strong>{view === 'ingestion' ? 'Knowledge base' : titleCase(view)}</strong></div><div className="top-actions"><span className="environment-pill"><i/> SECURE WORKSPACE</span><div className="user-menu"><div className="avatar">{(user?.name ?? user?.email ?? 'A').slice(0, 1).toUpperCase()}</div><span className="user-name">{user?.name ?? user?.email ?? 'Analyst'}</span><button className="logout-button" title="Sign out" onClick={() => logout({ logoutParams: { returnTo: `${window.location.origin}${import.meta.env.BASE_URL}` } })}>↗</button></div></div></header>
      <div className="page-content">{error && <div className="alert error" role="alert"><span>!</span>{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}{notice && <div className="alert success" role="status"><span>✓</span>{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice">×</button></div>}
      {view === 'overview' && <><div className="page-heading"><div><span className="eyebrow">YOUR INTELLIGENCE DESK</span><h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {user?.given_name ?? user?.name?.split(' ')[0] ?? 'Analyst'}.</h1><p>What would you like to understand about your portfolio today?</p></div><button className="button primary" onClick={() => selectView('research')}>＋ Start research</button></div><section className="welcome-banner"><div><span className="eyebrow light">RESEARCH, WITH CONTEXT</span><h2>Ask better questions.<br />Make decisions with evidence.</h2><p>Explore portfolio exposure, investigate risk indicators, and get answers grounded in your knowledge base.</p><button className="banner-link" onClick={() => selectView('research')}>Open research workspace <span>→</span></button></div><div className="banner-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-core">F</div><span className="orbit-node node-one">◈</span><span className="orbit-node node-two">↗</span><span className="orbit-node node-three">⌕</span></div></section><div className="section-heading"><div><span className="eyebrow">AT A GLANCE</span><h2>Your workspace</h2></div><span className="subtle">Live from your connected data</span></div><div className="metric-grid"><article className="metric-card"><div className="metric-top"><span>Accessible portfolios</span><span className="metric-symbol">▤</span></div><strong>{portfolios.length}</strong><small>Available to your account</small></article><article className="metric-card"><div className="metric-top"><span>Current research session</span><span className="metric-symbol teal">⌕</span></div><strong className="metric-text">Active</strong><small>Short-term conversation memory</small></article><article className="metric-card"><div className="metric-top"><span>Evidence-first answers</span><span className="metric-symbol amber">◈</span></div><strong className="metric-text">Traceable</strong><small>Citations and limitations included</small></article></div><div className="section-heading quick-heading"><div><span className="eyebrow">PICK UP THE THREAD</span><h2>Explore a starting point</h2></div></div><div className="quick-grid">{[['⌕', 'Investigate risk', 'Identify risk signals and supporting evidence in a portfolio.', 'What are the key risk indicators I should review?'], ['▤', 'Understand exposure', 'Explore concentration, allocation, and portfolio positioning.', 'Summarize the largest exposures in my portfolio.'], ['◈', 'Review policy alignment', 'Compare available evidence with relevant policy guidance.', 'What policy guidance applies to the current risk profile?']].map(([icon, title, desc, prompt]) => <button className="quick-card" key={title} onClick={() => { setQuestion(prompt); setView('research') }}><span className="quick-icon">{icon}</span><strong>{title}<span>↗</span></strong><p>{desc}</p></button>)}</div></>}

      {view === 'research' && <><div className="page-heading"><div><span className="eyebrow">RESEARCH WORKSPACE</span><h1>Ask FRIIS</h1><p>Explore investment and risk questions with portfolio context and traceable evidence.</p></div><button className="button secondary" disabled={busy} onClick={resetMemory}>↻ New conversation</button></div><div className="research-layout"><section className="research-main"><form className="question-card" onSubmit={submitQuestion}><label htmlFor="research-question">What would you like to know?</label><textarea id="research-question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about portfolio risk, exposures, policy guidance, or supporting research…" maxLength={4000} rows={4}/><div className="question-toolbar"><div className="portfolio-pick"><span>◉</span><label htmlFor="portfolio-select">Portfolio (optional)</label><select id="portfolio-select" value={selectedPortfolio} onChange={(e) => setSelectedPortfolio(e.target.value)}><option value="">No specific portfolio</option>{portfolios.map((p) => <option key={p.portfolio_id} value={p.portfolio_id}>{p.portfolio_name} · ID {p.portfolio_id}</option>)}</select></div><span className="char-count">{question.length}/4000</span><button className="button primary" disabled={busy || !question.trim()}>{busy ? <><span className="spinner"/> Researching</> : <>Ask FRIIS <span>↑</span></>}</button></div></form>{busy && !result && <div className="processing-card"><span className="spinner large"/><div><strong>Working through your question</strong><p>Checking available data and assembling supporting evidence…</p></div></div>}{result && <section className="result-card"><div className="result-header"><div><span className="eyebrow">RESEARCH RESPONSE</span><h2>{result.status === 'completed' ? 'Analysis' : titleCase(result.status)}</h2></div><span className={`result-status ${result.status}`}>{titleCase(result.status)}</span></div>{['queued', 'processing'].includes(result.status) && <button className="button secondary" onClick={() => void checkQuery()} disabled={busy}>↻ Check again</button>}{result.escalation_reason && <div className="callout"><strong>Why this needs review:</strong> {result.escalation_reason}{result.escalation_data_gaps?.length > 0 && <ul>{result.escalation_data_gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>}</div>}{result.answer && <div className="answer-copy">{result.answer}</div>}{result.clarification_question && <div className="callout">{result.clarification_question}</div>}{result.failure && <div className="alert error">{result.failure.message}</div>}{result.escalation_id && <button className="button secondary" onClick={() => { selectView('escalations'); void openEscalation(result.escalation_id!) }}>Open human review <span>→</span></button>}{result.citations?.length > 0 && <div className="evidence-section"><div className="evidence-heading"><h3>Supporting evidence</h3><span>{result.citations.length} {result.citations.length === 1 ? 'source' : 'sources'}</span></div><div className="citation-list">{result.citations.map((c, i) => <article className="citation" key={`${c.source_id}-${i}`}><span className="citation-index">{String(i + 1).padStart(2, '0')}</span><div><strong>{c.source_title}</strong><div className="citation-meta">{titleCase(c.evidence_type)}{c.source_version ? ` · Version ${c.source_version}` : ''}{c.page_number ? ` · Page ${c.page_number}` : ''}{c.section ? ` · ${c.section}` : ''}</div>{c.excerpt && <p>“{c.excerpt}”</p>}</div></article>)}</div></div>}{result.limitations?.length > 0 && <div className="limitations"><strong>Limitations &amp; data gaps</strong><ul>{result.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}</section>}</section><aside className="research-aside"><div className="aside-card"><span className="aside-icon">◈</span><h3>Grounded in evidence</h3><p>Responses include source references and call out information gaps to support your review.</p></div><div className="aside-card"><span className="aside-icon teal-bg">↻</span><h3>Conversation context</h3><p>Follow-up questions can use context from this session. Start a new conversation to clear it.</p><button className="text-button" onClick={resetMemory}>Clear session memory →</button></div><div className="aside-note">FRIIS supports research and analysis. Outputs are not investment advice and should be independently reviewed.</div></aside></div></>}

      {view === 'portfolios' && <><div className="page-heading"><div><span className="eyebrow">PORTFOLIO INTELLIGENCE</span><h1>Portfolios</h1><p>Review accessible mandates, holdings, and available risk assessments.</p></div></div>{portfolioDetail ? <><button className="back-button" onClick={() => setPortfolioDetail(null)}>← All portfolios</button><section className="detail-hero"><div><span className="eyebrow light">PORTFOLIO OVERVIEW</span><h2>{portfolioDetail.portfolio_name}</h2><p>{portfolioDetail.portfolio_manager ? `Managed by ${portfolioDetail.portfolio_manager} · ` : ''}{portfolioDetail.benchmark_index ?? 'Benchmark not available'}</p></div><div className="detail-value"><span>Reported total value</span><strong>{money(portfolioDetail.total_value)}</strong></div></section><div className="metric-grid detail-metrics"><article className="metric-card"><small>Risk category</small><strong className="metric-text">{titleCase(portfolioDetail.risk_category)}</strong></article><article className="metric-card"><small>Holdings reported</small><strong>{portfolioDetail.holdings.length}</strong></article><article className="metric-card"><small>Risk assessments</small><strong>{portfolioDetail.risk_assessments.length}</strong></article></div><section className="table-card"><div className="table-title"><h2>Holdings</h2><span>{portfolioDetail.holdings.length} records</span></div><div className="table-scroll"><table><thead><tr><th>Asset</th><th>Type / sector</th><th>Allocation</th><th>Market value</th></tr></thead><tbody>{portfolioDetail.holdings.map((h) => <tr key={h.holding_id}><td><strong>{h.asset_name ?? 'Unspecified asset'}</strong></td><td>{h.asset_type ?? '—'}{h.sector ? ` · ${h.sector}` : ''}</td><td>{h.allocation_percentage == null ? '—' : `${h.allocation_percentage}%`}</td><td>{money(h.market_value)}</td></tr>)}{!portfolioDetail.holdings.length && <tr><td colSpan={4} className="empty-cell">No holdings are available for this portfolio.</td></tr>}</tbody></table></div></section><section className="table-card"><div className="table-title"><h2>Risk assessments</h2><span>{portfolioDetail.risk_assessments.length} records</span></div><div className="table-scroll"><table><thead><tr><th>Asset</th><th>Risk type</th><th>Score</th><th>Level</th><th>Review</th></tr></thead><tbody>{portfolioDetail.risk_assessments.map((r) => <tr key={r.risk_id}><td><strong>{r.asset_name ?? 'Portfolio-level'}</strong>{r.risk_description && <small className="cell-sub">{r.risk_description}</small>}</td><td>{titleCase(r.risk_type)}</td><td>{r.risk_score ?? '—'}</td><td><span className="risk-pill">{titleCase(r.risk_level)}</span></td><td>{r.escalation_flag ? <span className="flag">Flagged</span> : '—'}</td></tr>)}{!portfolioDetail.risk_assessments.length && <tr><td colSpan={5} className="empty-cell">No risk assessments are available.</td></tr>}</tbody></table></div></section></> : <section className="portfolio-grid">{portfolios.map((p) => <article className="portfolio-card" key={p.portfolio_id}><div className="portfolio-card-top"><span className="portfolio-avatar">{p.portfolio_name.slice(0, 1).toUpperCase()}</span><span className="risk-pill">{titleCase(p.risk_category)}</span></div><h2>{p.portfolio_name}</h2><p>{p.portfolio_manager ? `Managed by ${p.portfolio_manager}` : 'Manager not specified'}</p><div className="portfolio-value"><span>Reported value</span><strong>{money(p.total_value)}</strong></div><div className="portfolio-card-foot"><span>{p.benchmark_index ?? 'Benchmark unavailable'}</span><button className="text-button" onClick={() => void openPortfolio(p.portfolio_id)}>View details →</button></div></article>)}{portfolios.length === 0 && <div className="empty-state"><span>▤</span><h2>No portfolios available</h2><p>Portfolio access is scoped by your account. Contact your administrator if you expect to see data here.</p></div>}</section>}</>}

      {view === 'escalations' && <><div className="page-heading"><div><span className="eyebrow">HUMAN REVIEW QUEUE</span><h1>Escalations</h1><p>Review questions that need additional context or specialist judgment.</p></div><button className="button secondary" onClick={() => void loadEscalations()}>↻ Refresh queue</button></div><div className="escalation-layout"><section className="table-card escalation-table"><div className="table-title"><h2>Review queue</h2><span>{escalations.length} cases</span></div><div className="table-scroll"><table><thead><tr><th>Case</th><th>Reason</th><th>Created</th><th>Status</th><th/></tr></thead><tbody>{escalations.map((e) => <tr key={e.escalation_id} className={activeEscalation?.escalation_id === e.escalation_id ? 'selected-row' : ''}><td><strong>{e.escalation_id.slice(0, 12)}</strong><small className="cell-sub">Query {e.query_id.slice(0, 10)}</small></td><td>{e.reason}</td><td>{new Date(e.created_at).toLocaleDateString()}</td><td><span className={`result-status ${e.status}`}>{titleCase(e.status)}</span></td><td><button className="text-button" onClick={() => void openEscalation(e.escalation_id)}>Review →</button></td></tr>)}{!escalations.length && <tr><td colSpan={5} className="empty-cell">No escalation cases are currently available.</td></tr>}</tbody></table></div></section>{activeEscalation && <section className="review-card"><div className="table-title"><div><span className="eyebrow">CASE REVIEW</span><h2>{activeEscalation.escalation_id.slice(0, 16)}</h2></div><button className="icon-button" onClick={() => setActiveEscalation(null)} aria-label="Close case">×</button></div><div className="review-block"><span className="eyebrow">QUESTION</span><p>{activeEscalation.question}</p></div><div className="review-block"><span className="eyebrow">REQUESTED REVIEW</span><p>{activeEscalation.requested_review}</p></div>{activeEscalation.data_gaps.length > 0 && <div className="review-block"><span className="eyebrow">DATA GAPS</span><ul>{activeEscalation.data_gaps.map((d, i) => <li key={i}>{d}</li>)}</ul></div>}<form onSubmit={saveReview} className="review-form"><label>Status<select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></label><label>Outcome (required to resolve)<select required={reviewStatus === "resolved"} value={reviewOutcome} onChange={(e) => setReviewOutcome(e.target.value)}><option value="">Select an outcome</option><option value="guidance_provided">Guidance provided</option><option value="more_information_requested">More information requested</option><option value="no_further_action">No further action</option></select></label><label>Reviewer notes<textarea rows={4} maxLength={4000} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Add review notes…"/></label><button className="button primary full" disabled={busy}>Save review</button></form></section>}</div></>}

      {view === 'ingestion' && <><div className="page-heading"><div><span className="eyebrow">KNOWLEDGE OPERATIONS</span><h1>Knowledge base</h1><p>Add source documents for retrieval and evidence-backed research.</p></div></div><div className="ingestion-layout"><section className="upload-card"><div className="upload-symbol">↑</div><h2>Upload a research document</h2><p>FRIIS will process the document, create searchable chunks, and add them to the knowledge collection.</p><form onSubmit={uploadDocument}><label className="file-drop" htmlFor="document-file"><span className="file-icon">▧</span><strong>{uploadFile?.name ?? 'Choose a document to upload'}</strong><small>{uploadFile ? `${(uploadFile.size / 1024 / 1024).toFixed(2)} MB · Ready to process` : 'Select a supported document from your device'}</small><input id="document-file" type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} /></label><button className="button primary full" disabled={busy || !uploadFile}>{busy ? <><span className="spinner"/> Processing document</> : 'Upload and process'}</button></form>{uploadResult && <div className="upload-success"><strong>Document processed successfully</strong><span>{String(uploadResult.filename)} · {String(uploadResult.total_chunks)} searchable chunks · {String(uploadResult.collection_name)}</span></div>}</section><aside className="aside-card ingestion-info"><span className="aside-icon">◈</span><h3>Operator access required</h3><p>Document ingestion is restricted to authorized operators. Your permissions are checked securely by the API when you submit a document.</p><div className="divider"/><strong>Supported processing</strong><ul><li>Document parsing and chunking</li><li>Searchable vector collection</li><li>Source and chunk metadata</li></ul></aside></div></>}
      <footer className="page-footer"><span>FRIIS · Finance Risk &amp; Investment Intelligence</span><span>Evidence-led decision support <i>·</i> Not investment advice</span></footer></div>
    </main></div>
}

export default App
