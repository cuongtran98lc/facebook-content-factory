import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { AIProviderName, AISettingsDTO, AppHealth, FitMode, IdeaDTO, ProjectDTO, ScriptDTO, StoryMediaDTO, VideoFormat, VoiceDTO, VoiceSettingsDTO } from '../../../shared/types'

type View = 'dashboard' | 'ideas' | 'scripts' | 'settings'

const DEFAULT_SETTINGS: AISettingsDTO = {
  provider: 'gemini',
  openaiModel: 'gpt-5.4-mini',
  geminiModel: 'gemini-2.5-flash',
  hasOpenAIKey: false,
  hasGeminiKey: false
}

const DEFAULT_VOICE_SETTINGS: VoiceSettingsDTO = { elevenLabsModel: 'eleven_multilingual_v2', hasElevenLabsKey: false }

function reviewSummary(script?: ScriptDTO): string {
  if (!script?.review) return ''
  try {
    const parsed = JSON.parse(script.review) as { summary?: string }
    return parsed.summary ?? script.review
  } catch { return script.review }
}

function rewriteInstruction(script?: ScriptDTO): string {
  if (!script?.review) return ''
  try {
    const parsed = JSON.parse(script.review) as { rewriteInstruction?: string }
    return parsed.rewriteInstruction ?? ''
  } catch { return '' }
}

export default function App() {
  const [view, setView] = useState<View>('dashboard')
  const [projects, setProjects] = useState<ProjectDTO[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [ideas, setIdeas] = useState<IdeaDTO[]>([])
  const [scripts, setScripts] = useState<ScriptDTO[]>([])
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [health, setHealth] = useState<AppHealth | null>(null)
  const [name, setName] = useState('Story 001')
  const [topic, setTopic] = useState('Mẹ chia tài sản cho 3 người con')
  const [niche, setNiche] = useState('family')
  const [ideaCount, setIdeaCount] = useState(10)
  const [targetWords, setTargetWords] = useState(2200)
  const [reelCount, setReelCount] = useState(5)
  const [rewriteNote, setRewriteNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [settings, setSettings] = useState<AISettingsDTO>(DEFAULT_SETTINGS)
  const [openaiKey, setOpenaiKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [clearOpenAIKey, setClearOpenAIKey] = useState(false)
  const [clearGeminiKey, setClearGeminiKey] = useState(false)
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsDTO>(DEFAULT_VOICE_SETTINGS)
  const [elevenLabsKey, setElevenLabsKey] = useState('')
  const [clearElevenLabsKey, setClearElevenLabsKey] = useState(false)
  const [voices, setVoices] = useState<VoiceDTO[]>([])
  const [voiceId, setVoiceId] = useState('')
  const [voiceTestText, setVoiceTestText] = useState('Ngày hôm đó, tôi trở về căn nhà cũ và không ngờ điều đang chờ mình phía sau cánh cửa.')
  const [voiceAudio, setVoiceAudio] = useState('')
  const [storyMedia, setStoryMedia] = useState<StoryMediaDTO | null>(null)
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('LANDSCAPE')
  const [fitMode, setFitMode] = useState<FitMode>('CROP')

  const selected = useMemo(() => projects.find((project) => project.id === selectedId) ?? projects[0], [projects, selectedId])
  const stories = useMemo(() => scripts.filter((script) => script.type === 'LONG_STORY').sort((a, b) => b.version - a.version), [scripts])
  const reels = useMemo(() => scripts.filter((script) => script.type === 'REEL').sort((a, b) => a.version - b.version), [scripts])
  const activeScript = useMemo(() => scripts.find((script) => script.id === activeScriptId) ?? stories[0], [scripts, activeScriptId, stories])

  async function loadProjectData(projectId: string) {
    const [ideaRows, scriptRows] = await Promise.all([
      window.contentFactory.ideas.list(projectId),
      window.contentFactory.scripts.list(projectId)
    ])
    setIdeas(ideaRows)
    setScripts(scriptRows)
    setStoryMedia(await window.contentFactory.storyMedia.get(projectId))
    const preferred = scriptRows.filter((item) => item.type === 'LONG_STORY').sort((a, b) => b.version - a.version)[0]
    if (preferred) setActiveScriptId(preferred.id)
  }

  async function reloadProjects() {
    const list = await window.contentFactory.projects.list()
    setProjects(list)
    if (!selectedId && list[0]) setSelectedId(list[0].id)
    return list
  }

  async function reloadAll() {
    const [list, appHealth, aiSettings, ttsSettings] = await Promise.all([
      window.contentFactory.projects.list(),
      window.contentFactory.app.health(),
      window.contentFactory.settings.getAI(),
      window.contentFactory.settings.getVoice()
    ])
    setProjects(list)
    setHealth(appHealth)
    setSettings(aiSettings)
    setVoiceSettings(ttsSettings)
    const nextId = selectedId ?? list[0]?.id ?? null
    if (nextId) {
      setSelectedId(nextId)
      await loadProjectData(nextId)
    } else {
      setIdeas([]); setScripts([])
    }
  }

  useEffect(() => { void reloadAll() }, [])
  useEffect(() => { if (selectedId) void loadProjectData(selectedId); else { setIdeas([]); setScripts([]) } }, [selectedId])
  useEffect(() => { setEditorContent(activeScript?.content ?? ''); setRewriteNote(rewriteInstruction(activeScript)) }, [activeScript?.id])
  useEffect(() => { setVoiceId(selected?.voiceId ?? '') }, [selected?.id, selected?.voiceId])

  async function createProject(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      const created = await window.contentFactory.projects.create({ name, topic, niche })
      setSelectedId(created.id); await reloadProjects(); setIdeas([]); setScripts([]); setMessage('Đã tạo project local.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function generateIdeas() {
    if (!selected) return
    setBusy(true); setMessage(`Đang tạo ${ideaCount} idea bằng ${settings.provider}...`)
    try {
      const rows = await window.contentFactory.ideas.generate({ projectId: selected.id, count: ideaCount })
      setIdeas(rows); await reloadProjects(); setView('ideas'); setMessage(`Đã tạo ${rows.length} idea.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function selectIdea(id: string) {
    if (!selected) return
    setBusy(true)
    try {
      await window.contentFactory.ideas.select(id); await loadProjectData(selected.id); await reloadProjects(); setMessage('Đã chọn idea. Có thể chuyển sang Scripts để Generate Story.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function generateStory() {
    if (!selected) return
    setBusy(true); setMessage('Đang Generate Story...')
    try {
      const row = await window.contentFactory.scripts.generateStory({ projectId: selected.id, targetWords })
      await loadProjectData(selected.id); await reloadProjects(); setActiveScriptId(row.id); setView('scripts'); setMessage(`Đã tạo LONG_STORY v${row.version}.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function reviewStory() {
    if (!activeScript) return
    setBusy(true); setMessage('AI đang review story...')
    try {
      const row = await window.contentFactory.scripts.review(activeScript.id)
      await loadProjectData(row.projectId); setActiveScriptId(row.id); setMessage(`Review xong. Score: ${row.score?.toFixed(1) ?? '-'}/10`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function saveStory() {
    if (!activeScript) return
    setBusy(true)
    try {
      const row = await window.contentFactory.scripts.update({ scriptId: activeScript.id, title: activeScript.title ?? undefined, content: editorContent })
      await loadProjectData(row.projectId); setActiveScriptId(row.id); setMessage('Đã lưu nội dung script.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function rewriteStory() {
    if (!activeScript) return
    setBusy(true); setMessage('AI đang rewrite thành version mới...')
    try {
      const row = await window.contentFactory.scripts.rewrite({ scriptId: activeScript.id, instruction: rewriteNote || undefined })
      await loadProjectData(row.projectId); setActiveScriptId(row.id); setMessage(`Đã tạo LONG_STORY v${row.version}. Bản cũ vẫn được giữ lại.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function approveStory() {
    if (!activeScript) return
    setBusy(true)
    try {
      const row = await window.contentFactory.scripts.approve(activeScript.id)
      await loadProjectData(row.projectId); setActiveScriptId(row.id); setMessage(`Đã approve LONG_STORY v${row.version}.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function generateReels() {
    if (!selected) return
    setBusy(true); setMessage(`Đang generate ${reelCount} Reel scripts...`)
    try {
      const rows = await window.contentFactory.scripts.generateReels({ projectId: selected.id, count: reelCount })
      await loadProjectData(selected.id); await reloadProjects(); setMessage(`Đã tạo ${rows.length} Reel scripts.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function approveAndGenerateReels() {
    if (!selected || !activeScript || activeScript.type !== 'LONG_STORY') return
    setBusy(true); setMessage(`Đang lưu LONG_STORY v${activeScript.version}, approve và generate ${reelCount} Reel scripts...`)
    try {
      const saved = await window.contentFactory.scripts.update({
        scriptId: activeScript.id,
        title: activeScript.title ?? undefined,
        content: editorContent
      })
      const approved = await window.contentFactory.scripts.approve(saved.id)
      const rows = await window.contentFactory.scripts.generateReels({ projectId: approved.projectId, count: reelCount })
      await loadProjectData(approved.projectId)
      await reloadProjects()
      setActiveScriptId(approved.id)
      setMessage(`✓ LONG_STORY v${approved.version} đã được approve và tạo ${rows.length} Reel scripts.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function loadVoices() {
    setBusy(true); setMessage('Đang tải danh sách voice từ ElevenLabs...')
    try {
      const rows = await window.contentFactory.voices.list()
      setVoices(rows)
      if (!voiceId && rows[0]) setVoiceId(rows[0].id)
      setMessage(`Đã tải ${rows.length} voice.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function testVoice() {
    if (!voiceId) return setMessage('Hãy chọn voice trước.')
    setBusy(true); setMessage('Đang generate câu test bằng ElevenLabs...'); setVoiceAudio('')
    try {
      const result = await window.contentFactory.voices.preview({ voiceId, text: voiceTestText })
      setVoiceAudio(result.dataUrl)
      setMessage('✓ Đã tạo voice test. Nghe thử bên dưới rồi chọn Use this voice.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function useVoice() {
    if (!selected || !voiceId) return
    const voice = voices.find(v => v.id === voiceId)
    if (!voice) return setMessage('Voice chưa được load hoặc không còn trong danh sách.')
    setBusy(true)
    try {
      await window.contentFactory.voices.select({ projectId: selected.id, voiceId: voice.id, voiceName: voice.name })
      await reloadProjects()
      setMessage(`✓ Đã chọn giọng ${voice.name} cho project. Có thể approve và generate reels.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }


  async function generateStoryMp3() {
    if (!selected || !activeScript || activeScript.type !== 'LONG_STORY') return
    setBusy(true); setMessage('Đang generate full Story MP3. Story dài sẽ tự chia chunk...')
    try {
      const saved = await window.contentFactory.scripts.update({ scriptId: activeScript.id, title: activeScript.title ?? undefined, content: editorContent })
      const media = await window.contentFactory.storyMedia.generateAudio({ projectId: selected.id, scriptId: saved.id })
      setStoryMedia(media); setMessage(`✓ Đã export story.mp3${media.audioDuration ? ` · ${formatDuration(media.audioDuration)}` : ''}.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function chooseBackground() {
    if (!selected) return
    setBusy(true); setMessage('Đang chọn background video...')
    try {
      const media = await window.contentFactory.storyMedia.chooseBackground(selected.id)
      if (media) { setStoryMedia(media); setMessage(`✓ Đã chọn background${media.backgroundDuration ? ` · ${formatDuration(media.backgroundDuration)}` : ''}.`) }
      else setMessage('Đã hủy chọn video.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function renderStoryVideo() {
    if (!selected) return
    if (!health?.ffmpeg) return setMessage('FFmpeg/ffprobe chưa sẵn sàng trên máy.')
    setBusy(true); setMessage('Đang loop background và render video theo đúng độ dài MP3...')
    try {
      const media = await window.contentFactory.storyMedia.render({ projectId: selected.id, format: videoFormat, fitMode })
      setStoryMedia(media); await reloadProjects(); setMessage('✓ Render xong story video.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  function formatDuration(seconds?: number | null): string {
    if (!seconds || !Number.isFinite(seconds)) return '--:--'
    const total = Math.round(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      const saved = await window.contentFactory.settings.saveAI({ provider: settings.provider, openaiModel: settings.openaiModel, geminiModel: settings.geminiModel, openaiApiKey: openaiKey || undefined, geminiApiKey: geminiKey || undefined, clearOpenAIKey, clearGeminiKey })
      setSettings(saved); setOpenaiKey(''); setGeminiKey(''); setClearOpenAIKey(false); setClearGeminiKey(false); setMessage('Đã lưu AI Settings.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function saveVoiceSettings() {
    setBusy(true); setMessage('')
    try {
      const saved = await window.contentFactory.settings.saveVoice({
        elevenLabsModel: voiceSettings.elevenLabsModel,
        elevenLabsApiKey: elevenLabsKey || undefined,
        clearElevenLabsKey
      })
      setVoiceSettings(saved); setElevenLabsKey(''); setClearElevenLabsKey(false); setMessage('Đã lưu ElevenLabs settings.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function testAI(provider: AIProviderName) {
    setBusy(true); setMessage(`Đang test ${provider}...`)
    try { const result = await window.contentFactory.settings.testAI(provider); setMessage(`${result.ok ? '✓' : '✕'} ${provider}: ${result.message}`) } finally { setBusy(false) }
  }

  async function removeProject(id: string) { await window.contentFactory.projects.remove(id); if (selectedId === id) setSelectedId(null); await reloadAll() }

  const stepsDone = selected?.status === 'READY' ? 6 : ['MEDIA_READY','RENDERING'].includes(selected?.status ?? '') ? 5 : selected?.status === 'REELS_READY' ? 4 : ['SCRIPT_READY','SCRIPT_REVIEW','GENERATING_REELS'].includes(selected?.status ?? '') ? 3 : selected?.status === 'IDEAS_READY' ? 2 : 1

  return <div className="app-shell">
    <aside className="sidebar">
      <div><div className="brand">Content Factory</div><div className="brand-sub">Desktop MVP v0.3.3</div></div>
      <nav>
        <button className={`nav ${view === 'dashboard' ? 'active' : ''}`} onClick={() => setView('dashboard')}>Dashboard</button>
        <button className={`nav ${view === 'ideas' ? 'active' : ''}`} onClick={() => setView('ideas')}>Idea Bank</button>
        <button className={`nav ${view === 'scripts' ? 'active' : ''}`} onClick={() => setView('scripts')}>Scripts</button>
        <button className="nav" disabled>Media · v0.4</button><button className="nav" disabled>Renders · later</button>
        <button className={`nav ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>Settings</button>
      </nav>
      <div className="health"><div><span className={health?.database ? 'dot ok' : 'dot'} /> SQLite</div><div><span className={health?.ffmpeg ? 'dot ok' : 'dot warn'} /> FFmpeg</div><div className="tiny">AI: {settings.provider}</div></div>
    </aside>

    <main className="main">
      <header className="topbar"><div><h1>{view === 'dashboard' ? 'Local Content Factory' : view === 'ideas' ? 'Idea Bank' : view === 'scripts' ? 'Story & Reels' : 'Settings'}</h1><p>{view === 'scripts' ? 'Selected Idea → Story → Review → Rewrite/Approve → Reels' : 'Local-first Facebook content workflow.'}</p></div><button className="secondary" onClick={() => window.contentFactory.app.openStorageFolder()}>Open storage</button></header>
      {message && <div className="banner">{message}</div>}

      {view === 'dashboard' && <><section className="grid"><div className="card"><h2>Create project</h2><form onSubmit={createProject} className="form"><label>Project name<input value={name} onChange={(e) => setName(e.target.value)} required /></label><label>Topic<textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={4} /></label><label>Niche<select value={niche} onChange={(e) => setNiche(e.target.value)}><option value="family">Family</option><option value="life">Life</option><option value="love">Love</option><option value="knowledge">Knowledge</option></select></label><button className="primary" disabled={busy}>Create project</button></form></div>
      <div className="card project-card"><h2>Current project</h2>{selected ? <><div className="project-title">{selected.name}</div><div className="meta">{selected.niche ?? 'general'} · {selected.status}</div><div className="topic">{selected.topic ?? 'No topic'}</div><div className="steps">{['Project','Ideas','Story','Reels','Media','Render'].map((step,index)=><div className="step" key={step}><span className={index < stepsDone ? 'step-dot done' : 'step-dot'} />{step}</div>)}</div><div className="inline-controls"><label>Ideas<input type="number" min={1} max={30} value={ideaCount} onChange={(e)=>setIdeaCount(Number(e.target.value))}/></label><button className="primary grow" onClick={generateIdeas} disabled={busy}>Generate ideas</button></div></> : <div className="empty">Chưa có project.</div>}</div></section>
      <section className="card list-card"><div className="section-title"><h2>Projects</h2><span>{projects.length} items</span></div><div className="project-list">{projects.map(project=><button key={project.id} className={`project-row ${selected?.id === project.id ? 'selected':''}`} onClick={()=>setSelectedId(project.id)}><div><strong>{project.name}</strong><small>{project.topic ?? 'No topic'}</small></div><span className="status">{project.status}</span><span className="delete" onClick={(e)=>{e.stopPropagation(); void removeProject(project.id)}}>Delete</span></button>)}{!projects.length && <div className="empty">Create project đầu tiên để bắt đầu.</div>}</div></section></>}

      {view === 'ideas' && <section className="card"><div className="section-title"><div><h2>{selected?.name ?? 'No project'}</h2><span>{ideas.length} ideas</span></div><button className="primary" onClick={generateIdeas} disabled={!selected || busy}>Regenerate {ideaCount}</button></div><div className="ideas-grid">{ideas.map(idea=><article className={`idea-card ${idea.selected ? 'chosen':''}`} key={idea.id}><div className="idea-top"><span className="score">{idea.score?.toFixed(1) ?? '-'}</span>{idea.selected && <span className="chosen-label">SELECTED</span>}</div><h3>{idea.title}</h3><p className="hook">{idea.hook}</p><p>{idea.description}</p><button className={idea.selected ? 'secondary full':'primary full'} disabled={busy || idea.selected} onClick={()=>selectIdea(idea.id)}>{idea.selected ? 'Đang sử dụng':'Use this idea'}</button>{idea.selected && <button className="secondary full top-gap" onClick={()=>setView('scripts')}>Go to Story →</button>}</article>)}</div>{selected && !ideas.length && <div className="empty">Chưa có idea.</div>}</section>}

      {view === 'scripts' && <section className="script-layout"><div className="card script-sidebar"><div className="section-title"><div><h2>Story versions</h2><span>{stories.length} versions</span></div></div>{!stories.length && <div className="empty">Chưa có story. Chọn Idea rồi Generate Story.</div>}{stories.map(story=><button key={story.id} className={`script-version ${activeScript?.id === story.id ? 'selected':''}`} onClick={()=>setActiveScriptId(story.id)}><strong>v{story.version} {story.approved ? '✓ Approved':''}</strong><span>{story.score ? `${story.score.toFixed(1)}/10` : 'Not reviewed'}</span></button>)}<hr/><h3>Reels ({reels.length})</h3>{reels.map(reel=><button key={reel.id} className={`script-version ${activeScript?.id === reel.id ? 'selected':''}`} onClick={()=>setActiveScriptId(reel.id)}><strong>{reel.title ?? `Reel ${reel.version}`}</strong><span>Reel #{reel.version}</span></button>)}</div>
      <div className="card script-main">{!selected ? <div className="empty">Chọn project trước.</div> : !activeScript ? <div className="empty action-empty"><p>Idea selected: {ideas.find(i=>i.selected)?.title ?? 'chưa chọn'}</p><label>Target words<input type="number" min={800} max={4500} value={targetWords} onChange={(e)=>setTargetWords(Number(e.target.value))}/></label><button className="primary" onClick={generateStory} disabled={busy || !ideas.some(i=>i.selected)}>Generate Story</button></div> : <><div className="script-toolbar"><div><h2>{activeScript.title ?? activeScript.type}</h2><span>{activeScript.type} · v{activeScript.version} {activeScript.approved ? '· APPROVED':''}</span></div>{activeScript.type === 'LONG_STORY' && <div className="button-row"><button className="secondary" onClick={reviewStory} disabled={busy}>AI Review</button><button className="secondary" onClick={saveStory} disabled={busy}>Save</button><button className="primary" onClick={approveStory} disabled={busy || activeScript.approved || !selected?.voiceId}>Approve</button></div>}</div>
      {activeScript.type === 'LONG_STORY' && activeScript.score && <div className="review-box"><strong>AI Score: {activeScript.score.toFixed(1)}/10</strong><p>{reviewSummary(activeScript)}</p></div>}
      <textarea className="script-editor" value={editorContent} onChange={(e)=>setEditorContent(e.target.value)} readOnly={activeScript.type === 'REEL'} />
      {activeScript.type === 'LONG_STORY' && <><div className="rewrite-row"><input placeholder="Rewrite instruction / dùng feedback AI nếu để trống" value={rewriteNote} onChange={(e)=>setRewriteNote(e.target.value)}/><button className="secondary" onClick={rewriteStory} disabled={busy}>Rewrite → new version</button></div><div className="voice-gate"><div className="voice-title"><div><strong>Voice before approve</strong><span>{selected?.voiceName ? `Selected: ${selected.voiceName}` : 'Test và chọn giọng trước khi approve'}</span></div><button className="secondary" onClick={loadVoices} disabled={busy || !voiceSettings.hasElevenLabsKey}>Load voices</button></div>{!voiceSettings.hasElevenLabsKey && <p className="voice-warning">Chưa có ElevenLabs API key. Vào Settings → Voice/TTS.</p>}{voices.length > 0 && <><div className="voice-controls"><label>Voice<select value={voiceId} onChange={(e)=>{setVoiceId(e.target.value);setVoiceAudio('')}}>{voices.map(v=><option key={v.id} value={v.id}>{v.name}{v.labels.gender ? ` · ${v.labels.gender}` : ''}{v.labels.accent ? ` · ${v.labels.accent}` : ''}</option>)}</select></label><label>Test sentence<input value={voiceTestText} onChange={(e)=>setVoiceTestText(e.target.value)}/></label></div><div className="button-row voice-actions"><button className="secondary" onClick={testVoice} disabled={busy}>Test voice</button><button className="primary" onClick={useVoice} disabled={busy || !voiceId}>Use this voice</button></div>{voiceAudio && <audio className="voice-player" src={voiceAudio} controls autoPlay />}</>}</div><div className="story-media-box"><div className="media-head"><div><strong>Full Story MP3 + Loop Video</strong><span>Generate MP3 từ story hiện tại rồi ghép với video nền local.</span></div><button className="secondary" onClick={generateStoryMp3} disabled={busy || !selected?.voiceId || !health?.ffmpeg}>Generate Story MP3</button></div>{storyMedia?.audioUrl && <div className="media-item"><div><strong>story.mp3</strong><span>{formatDuration(storyMedia.audioDuration)}</span></div><audio className="voice-player" src={storyMedia.audioUrl} controls /></div>}<div className="media-head top-gap"><div><strong>Background video</strong><span>{storyMedia?.backgroundName ?? 'Chưa chọn video'}</span></div><button className="secondary" onClick={chooseBackground} disabled={busy || !health?.ffmpeg}>Select Video</button></div>{storyMedia?.backgroundUrl && <div className="media-preview"><video src={storyMedia.backgroundUrl} controls muted /><span>Duration: {formatDuration(storyMedia.backgroundDuration)}</span></div>}<div className="render-options"><label>Output<select value={videoFormat} onChange={(e)=>setVideoFormat(e.target.value as VideoFormat)}><option value="LANDSCAPE">16:9 · 1920x1080</option><option value="REEL">9:16 · 1080x1920</option><option value="SQUARE">1:1 · 1080x1080</option></select></label><label>Fit<select value={fitMode} onChange={(e)=>setFitMode(e.target.value as FitMode)}><option value="CROP">Fill / Crop</option><option value="FIT">Fit / Pad</option></select></label><button className="primary" onClick={renderStoryVideo} disabled={busy || !storyMedia?.audioPath || !storyMedia?.backgroundPath || !health?.ffmpeg}>Generate Story Video</button></div>{storyMedia?.renderUrl && <div className="render-result"><strong>Rendered Story Video</strong><video src={storyMedia.renderUrl} controls /><div className="button-row"><button className="secondary" onClick={()=>selected && window.contentFactory.storyMedia.openOutput(selected.id)}>Open Output Folder</button></div></div>}</div><div className="generate-reels"><label>Reels<input type="number" min={1} max={10} value={reelCount} onChange={(e)=>setReelCount(Number(e.target.value))}/></label><div className="button-row grow"><button className="primary" onClick={approveAndGenerateReels} disabled={busy || !selected?.voiceId}>Approve Version & Generate Reels</button><button className="secondary" onClick={generateReels} disabled={busy || !stories.some(s=>s.approved)}>Generate Again</button></div></div></>}</>}</div></section>}

      {view === 'settings' && <section className="settings-grid"><form className="card form" onSubmit={saveSettings}><h2>AI provider</h2><label>Default provider<select value={settings.provider} onChange={(e)=>setSettings({...settings,provider:e.target.value as AIProviderName})}><option value="gemini">Gemini</option><option value="openai">OpenAI</option></select></label><label>Gemini model<input value={settings.geminiModel} onChange={(e)=>setSettings({...settings,geminiModel:e.target.value})}/></label><label>Gemini API key<input type="password" placeholder={settings.hasGeminiKey ? 'Saved — nhập key mới để thay thế':'Paste Gemini API key'} value={geminiKey} onChange={(e)=>setGeminiKey(e.target.value)}/></label><label className="check"><input type="checkbox" checked={clearGeminiKey} onChange={(e)=>setClearGeminiKey(e.target.checked)}/> Xóa Gemini key đã lưu</label><button type="button" className="secondary" disabled={busy} onClick={()=>testAI('gemini')}>Test Gemini</button><label>OpenAI model<input value={settings.openaiModel} onChange={(e)=>setSettings({...settings,openaiModel:e.target.value})}/></label><label>OpenAI API key<input type="password" placeholder={settings.hasOpenAIKey ? 'Saved — nhập key mới để thay thế':'Paste OpenAI API key'} value={openaiKey} onChange={(e)=>setOpenaiKey(e.target.value)}/></label><label className="check"><input type="checkbox" checked={clearOpenAIKey} onChange={(e)=>setClearOpenAIKey(e.target.checked)}/> Xóa OpenAI key đã lưu</label><button type="button" className="secondary" disabled={busy} onClick={()=>testAI('openai')}>Test OpenAI</button><button className="primary" disabled={busy}>Save settings</button></form><div className="stack-cards"><div className="card form"><h2>Voice / TTS · ElevenLabs</h2><label>TTS model<input value={voiceSettings.elevenLabsModel} onChange={(e)=>setVoiceSettings({...voiceSettings,elevenLabsModel:e.target.value})}/></label><label>ElevenLabs API key<input type="password" placeholder={voiceSettings.hasElevenLabsKey ? 'Saved — nhập key mới để thay thế':'Paste ElevenLabs API key'} value={elevenLabsKey} onChange={(e)=>setElevenLabsKey(e.target.value)}/></label><label className="check"><input type="checkbox" checked={clearElevenLabsKey} onChange={(e)=>setClearElevenLabsKey(e.target.checked)}/> Xóa ElevenLabs key đã lưu</label><button type="button" className="primary" disabled={busy} onClick={saveVoiceSettings}>Save Voice/TTS</button></div><div className="card help-card"><h2>v0.3.3 scope</h2><p>Story → chọn/test voice → export full story.mp3 → chọn video nền → loop bằng FFmpeg → story.mp4.</p><p>Background được copy vào project local để lần sau mở app vẫn dùng lại.</p></div></div></section>}
    </main>
  </div>
}
