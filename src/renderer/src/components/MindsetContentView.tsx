import { useState } from 'react'
import { MINDSET_PILLARS } from '../../../shared/mindset-pillars'
import type { MindsetArticleDTO, ProjectDTO, ScriptDTO } from '../../../shared/types'

interface MindsetContentViewProps {
  projects: ProjectDTO[]
  selectedProjectId: string | null
  onSelectProject: (id: string) => void
  onImported: (script: ScriptDTO) => void | Promise<void>
}

type Source = 'URL' | 'AI_KNOWLEDGE'

// Tab "Xây dựng nội dung Mindset": 2 cách vào nguồn ý tưởng —
// (1) crawl 1 bài viết web rồi AI viết kịch bản mới lấy cảm hứng từ đó, hoặc
// (2) để AI tự tổng hợp hoàn toàn bằng kiến thức của nó (không cần URL) —
// cả hai đều theo đúng 5 pillar/8 công thức tiêu đề của kế hoạch kênh mindset
// (xem plans/20260916-1400-kenh-mindset-clone-wisejoe/plan.md), rồi lưu
// thành LONG_STORY để tiếp tục ở tab Scripts (Voice → Background → Render).
export function MindsetContentView({ projects, selectedProjectId, onSelectProject, onImported }: MindsetContentViewProps) {
  const [source, setSource] = useState<Source>('URL')
  const [url, setUrl] = useState('')
  const [article, setArticle] = useState<MindsetArticleDTO | null>(null)
  const [forcedPillar, setForcedPillar] = useState('')
  const [targetMinutes, setTargetMinutes] = useState(6)
  const [pillar, setPillar] = useState('')
  const [title, setTitle] = useState('')
  const [hook, setHook] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState<'idle' | 'crawling' | 'drafting' | 'saving'>('idle')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const hasDraft = title.trim().length > 0 && content.trim().length > 0
  const canDraft = source === 'URL' ? Boolean(article) : true

  function switchSource(next: Source) {
    setSource(next)
    setError('')
  }

  async function crawl() {
    if (!url.trim()) { setError('Hãy nhập URL bài viết cần crawl.'); return }
    setBusy('crawling'); setError(''); setMessage('')
    try {
      const result = await window.contentFactory.mindset.crawlArticle({ url: url.trim() })
      setArticle(result)
      setMessage(`Đã crawl "${result.title}" (${result.excerpt.length.toLocaleString('vi-VN')} ký tự).`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  async function draftScript() {
    if (source === 'URL' && !article) { setError('Hãy crawl một bài viết trước.'); return }
    setBusy('drafting'); setError(''); setMessage('')
    try {
      const draft = await window.contentFactory.mindset.draftScript({
        sourceUrl: source === 'URL' ? article?.sourceUrl : undefined,
        sourceTitle: source === 'URL' ? article?.title : undefined,
        sourceExcerpt: source === 'URL' ? article?.excerpt : undefined,
        pillar: forcedPillar || undefined,
        targetMinutes
      })
      setPillar(draft.pillar)
      setTitle(draft.title)
      setHook(draft.hook)
      setContent(draft.content)
      setMessage(`Đã viết kịch bản mới theo pillar "${draft.pillar}". Xem lại và chỉnh sửa trước khi lưu.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  async function saveAndContinue() {
    if (!selectedProjectId) { setError('Hãy chọn một project trước.'); return }
    if (!hasDraft) { setError('Chưa có kịch bản để lưu.'); return }
    setBusy('saving'); setError(''); setMessage('')
    try {
      const fullContent = hook.trim() && !content.trim().startsWith(hook.trim()) ? `${hook.trim()}\n\n${content.trim()}` : content.trim()
      const script = await window.contentFactory.scripts.importStory({
        projectId: selectedProjectId,
        title: title.trim(),
        content: fullContent
      })
      await onImported(script)
      setMessage(`Đã lưu "${script.title}" vào Scripts (v${script.version}). Tiếp tục ở tab Scripts để chọn giọng đọc, background và render.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  return (
    <section className="card">
      <div className="section-title">
        <h2>Xây dựng nội dung Mindset</h2>
        <span>{source === 'URL' ? 'Crawl web → AI viết kịch bản mới → Scripts' : 'AI tự tổng hợp → Scripts'}</span>
      </div>

      <div className="form">
        <label>
          Project
          <select value={selectedProjectId ?? ''} disabled={busy !== 'idle'} onChange={event => onSelectProject(event.target.value)}>
            <option value="" disabled>-- Chọn project --</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>

        <div className="inline-controls">
          <button className={source === 'URL' ? 'primary' : 'secondary'} onClick={() => switchSource('URL')} disabled={busy !== 'idle'}>
            Từ URL bài viết
          </button>
          <button className={source === 'AI_KNOWLEDGE' ? 'primary' : 'secondary'} onClick={() => switchSource('AI_KNOWLEDGE')} disabled={busy !== 'idle'}>
            AI tự tổng hợp (không cần URL)
          </button>
        </div>

        {source === 'URL' ? (
          <>
            <label>
              URL bài viết nguồn (blog/article về tâm lý học, self-help, quote...)
              <div className="inline-controls">
                <input
                  type="text"
                  placeholder="https://..."
                  value={url}
                  disabled={busy !== 'idle'}
                  onChange={event => setUrl(event.target.value)}
                />
                <button className="secondary" onClick={() => void crawl()} disabled={busy !== 'idle' || !url.trim()}>
                  {busy === 'crawling' ? 'Đang crawl...' : 'Crawl'}
                </button>
              </div>
            </label>

            {article && (
              <label>
                Nội dung đã crawl (chỉ dùng làm nguồn cảm hứng, AI sẽ KHÔNG copy nguyên văn)
                <textarea value={`${article.title}\n\n${article.excerpt}`} readOnly rows={8} />
              </label>
            )}
          </>
        ) : (
          <div className="message">
            AI sẽ tự chọn chủ đề bằng kiến thức của nó (không cần bài viết nguồn nào). Với các pillar dựa trên hiệu ứng tâm lý học, AI chỉ nêu tên nghiên cứu/hiệu ứng khi chắc chắn có thật — không bịa số liệu.
          </div>
        )}

        <label>
          Pillar {source === 'AI_KNOWLEDGE' ? '(để trống cho AI tự chọn)' : '(ép AI dùng đúng pillar này, tuỳ chọn)'}
          <select value={forcedPillar} disabled={busy !== 'idle'} onChange={event => setForcedPillar(event.target.value)}>
            <option value="">Để AI tự chọn</option>
            {MINDSET_PILLARS.map(([name]) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        <label>
          Thời lượng kịch bản mục tiêu (phút)
          <input
            type="number"
            min={1}
            max={20}
            value={targetMinutes}
            disabled={busy !== 'idle'}
            onChange={event => setTargetMinutes(Math.min(Math.max(Number(event.target.value) || 1, 1), 20))}
          />
        </label>

        <button className="primary" onClick={() => void draftScript()} disabled={busy !== 'idle' || !canDraft}>
          {busy === 'drafting' ? 'AI đang viết kịch bản...' : source === 'URL' ? 'Viết kịch bản mới (AI)' : 'AI tự tổng hợp kịch bản mới'}
        </button>

        {hasDraft && (
          <>
            <label>
              Pillar đã chọn
              <input type="text" value={pillar} readOnly />
            </label>
            <label>
              Tiêu đề (có thể chỉnh sửa)
              <input type="text" value={title} disabled={busy !== 'idle'} onChange={event => setTitle(event.target.value)} />
            </label>
            <label>
              Hook mở đầu (có thể chỉnh sửa)
              <input type="text" value={hook} disabled={busy !== 'idle'} onChange={event => setHook(event.target.value)} />
            </label>
            <label>
              Nội dung kịch bản (có thể chỉnh sửa)
              <textarea value={content} disabled={busy !== 'idle'} rows={14} onChange={event => setContent(event.target.value)} />
            </label>
            <button className="primary" onClick={() => void saveAndContinue()} disabled={busy !== 'idle' || !selectedProjectId}>
              {busy === 'saving' ? 'Đang lưu...' : 'Lưu vào Scripts & tiếp tục →'}
            </button>
          </>
        )}

        {error && <div className="message">{error}</div>}
        {!error && message && <div className="message">{message}</div>}
      </div>
    </section>
  )
}
