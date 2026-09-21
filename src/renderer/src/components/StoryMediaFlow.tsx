import { useEffect, useRef, useState } from 'react'
import type { AIProviderName, BackgroundKind, EmotionDemoDTO, FitMode, FlowSceneSource, GoogleFlowCaptureStatus, ReelVideoProgress, SoundEffectOptions, SoundEffectPreset, StickmanSceneImageDTO, StickVisualStyle, StoryMediaDTO, StoryVideoOutputDTO, VideoFormat } from '../../../shared/types'

export function stickSceneImageUrl(scene: Pick<StickmanSceneImageDTO, 'filePath' | 'fileUrl'>): string {
  if (scene.fileUrl.startsWith('local-media://')) return scene.fileUrl
  return `local-media://file/${encodeURIComponent(scene.filePath)}`
}

export type StickSource = 'API' | 'CODEX_CLI' | 'CLAUDE_CLI' | 'ANTIGRAVITY_CLI'

export function stickSourceForProvider(provider?: AIProviderName): StickSource {
  if (provider === 'claude-cli') return 'CLAUDE_CLI'
  if (provider === 'codex-cli') return 'CODEX_CLI'
  if (provider === 'antigravity-cli') return 'ANTIGRAVITY_CLI'
  return 'API'
}

type Props = {
  projectId?: string
  busy: boolean
  busyMessage?: string
  ffmpegReady: boolean
  hasVoice: boolean
  media: StoryMediaDTO | null
  videoFormat: VideoFormat
  stickVisualStyle: StickVisualStyle
  fitMode: FitMode
  soundEffect: SoundEffectOptions
  includeSubtitles: boolean
  reelProgress: ReelVideoProgress | null
  sceneImages?: StickmanSceneImageDTO[]
  aiProvider?: AIProviderName
  onGenerateStickVideo(source: StickSource): void
  onGenerateStickmanSceneImages?(source: StickSource): void
  onImportFlowSceneImages?(sources: FlowSceneSource[]): void
  googleFlowCapture?: GoogleFlowCaptureStatus | null
  onStartGoogleFlowAutomation?(): void
  onStartGoogleFlowCapture?(): void
  onCancelGoogleFlowCapture?(): void
  onGenerateVideoThumbnail(): void
  onGenerateAudio(): void
  onGenerateReelVideos(): void
  onRegenerateReelThumbnails(): void
  onGenerateMetadata(): void
  onChooseBackground(kind: BackgroundKind): void
  onRender(): void
  onVideoFormatChange(value: VideoFormat): void
  onStickVisualStyleChange(value: StickVisualStyle): void
  onFitModeChange(value: FitMode): void
  onSoundEffectChange(value: SoundEffectOptions): void
  onIncludeSubtitlesChange(value: boolean): void
  onRefreshMedia?(): void
}

function formatDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

const SOUND_EFFECT_LABELS: Record<SoundEffectPreset, string> = {
  DYNAMIC: 'Dynamic · tự đổi theo tập',
  WHOOSH: 'Whoosh · chuyển cảnh',
  IMPACT: 'Impact · nhấn kịch tính',
  CHIME: 'Chime · điểm nhấn'
}

interface PublishMetadataProps {
  title: string | null
  caption?: string | null
  description: string | null
  metadataPath: string | null
  source: string | null
}

function PublishMetadata({ title, caption, description, metadataPath, source }: PublishMetadataProps) {
  const [copied, setCopied] = useState('')
  const [copyFailed, setCopyFailed] = useState(false)
  const feedbackTimer = useRef<number | null>(null)
  const effectiveCaption = caption || (title && description ? `${title}\n\n${description}` : '')
  const hasMetadata = Boolean(title || description || caption)
  const allText = [title, effectiveCaption ? `Caption:\n${effectiveCaption}` : '', description].filter((value): value is string => Boolean(value)).join('\n\n')

  async function copyText(value: string, label: string) {
    if (!value) return
    try {
      await window.contentFactory.app.copyText(value)
      setCopied(label)
      setCopyFailed(false)
    } catch {
      setCopied('Copy thất bại')
      setCopyFailed(true)
    }
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current)
    feedbackTimer.current = window.setTimeout(() => setCopied(''), 1600)
  }

  return <div className={`publish-copy ${hasMetadata ? '' : 'empty-metadata'}`}>
    <div className="publish-copy-head">
      <strong>Title, Caption &amp; Description</strong>
      <div>
        {source && <span className="publish-source">{source}</span>}
        {copied && <span className={copyFailed ? 'copy-error' : 'copy-confirm'}>{copyFailed ? '✕' : '✓'} {copied}</span>}
      </div>
    </div>
    {hasMetadata ? <>
      <label>Title<input readOnly value={title ?? ''} onFocus={(event) => event.currentTarget.select()} /></label>
      {effectiveCaption && <label>Caption (Reels / TikTok / FB)<textarea readOnly rows={3} value={effectiveCaption} onFocus={(event) => event.currentTarget.select()} /></label>}
      <label>Description<textarea readOnly rows={4} value={description ?? ''} onFocus={(event) => event.currentTarget.select()} /></label>
      <div className="copy-actions">
        <button className="secondary" disabled={!title} onClick={() => void copyText(title ?? '', 'Đã copy title')}>Copy title</button>
        {effectiveCaption && <button className="secondary" onClick={() => void copyText(effectiveCaption, 'Đã copy caption')}>Copy caption</button>}
        <button className="secondary" disabled={!description} onClick={() => void copyText(description ?? '', 'Đã copy description')}>Copy description</button>
        <button className="secondary" disabled={!allText} onClick={() => void copyText(allText, 'Đã copy tất cả')}>Copy tất cả</button>
      </div>
      {metadataPath && <span className="publish-path" title={metadataPath}>Metadata: {metadataPath}</span>}
    </> : <span className="publish-empty">Chưa có title và description cho video này.</span>}
  </div>
}

function StoryVideoResult({ output }: { output: StoryVideoOutputDTO }) {
  const isShort = output.format === 'REEL'
  const formatLabel = output.format === 'LANDSCAPE' ? 'Video dài 16:9' : output.format === 'SQUARE' ? 'Video vuông 1:1' : `${output.parts.length} Short Video${output.parts.length > 1 ? 's' : ''} 9:16`
  return <section className="render-result">
    <div className="story-video-result-head"><strong>{formatLabel}</strong><span>{output.status}</span></div>
    {isShort
      ? <div className="story-short-grid">{output.parts.map(part=><article key={part.part}><div><strong>SHORT {part.part}/{part.totalParts}</strong><span>{formatDuration(part.duration)} · bắt đầu {formatDuration(part.startSeconds)}</span></div>{part.url ? <video src={part.url} controls preload="metadata" /> : <div className="short-unavailable">{part.status ?? 'Đang chờ'}</div>}<PublishMetadata title={part.publishTitle} caption={part.publishCaption} description={part.publishDescription} metadataPath={part.publishMetadataPath} source={part.publishSource} /></article>)}</div>
      : output.parts[0]?.url && <div className="story-long-output"><video src={output.parts[0].url} controls /><PublishMetadata title={output.parts[0].publishTitle} caption={output.parts[0].publishCaption} description={output.parts[0].publishDescription} metadataPath={output.parts[0].publishMetadataPath} source={output.parts[0].publishSource} /></div>}
  </section>
}

export function StoryMediaFlow(props: Props) {
  const [sourceOverride, setStickSource] = useState<StickSource | null>(null)
  const stickSource = sourceOverride ?? stickSourceForProvider(props.aiProvider)
  const [selectedEmotion, setSelectedEmotion] = useState<string>('worried')
  const [isGeneratingDemo, setIsGeneratingDemo] = useState<boolean>(false)
  const [demoModal, setDemoModal] = useState<{ videoUrl: string; videoPath: string; emotion: string } | null>(null)
  const [lastDemo, setLastDemo] = useState<{ videoUrl: string; videoPath: string; emotion: string } | null>(null)
  const [isSettingBackground, setIsSettingBackground] = useState<boolean>(false)
  const [autoApplyBackground, setAutoApplyBackground] = useState<boolean>(true)
  const [demoList, setDemoList] = useState<EmotionDemoDTO[]>([])
  const [videoLoadError, setVideoLoadError] = useState<boolean>(false)
  const [flowImageUrls, setFlowImageUrls] = useState<string[]>([])
  const [flowInputError, setFlowInputError] = useState('')

  const EMOTION_LABELS: Record<string, string> = {
    worried: '😰 Khủng hoảng / Lo âu (Crisis - Chuẩn ảnh mẫu)',
    crying: '😭 Khóc / Đau buồn (Crying)',
    shocked: '⚡ Sốc / Kinh hoàng (Shocked)',
    furious: '🔥 Tức giận / Bùng nổ (Furious)',
    happy: '🎉 Vui sướng / Ăn mừng (Happy)',
    smug: '😎 Tự đắc / Đắc ý (Smug)',
    thinking: '🤔 Đắn đo / Suy nghĩ (Thinking)',
  }

  const refreshDemoList = async () => {
    if (typeof window.contentFactory?.storyMedia?.listEmotionDemos === 'function') {
      try {
        const list = await window.contentFactory.storyMedia.listEmotionDemos({ projectId: props.projectId })
        setDemoList(list)
      } catch {
        // ignore
      }
    }
  }

  useEffect(() => {
    void refreshDemoList()
  }, [props.projectId])

  const audioSegmentKey = (props.media?.audioSegments ?? []).map(segment => segment.path).join('|')
  useEffect(() => {
    const count = props.media?.audioSegments?.length ?? 0
    setFlowImageUrls(current => Array.from({ length: count }, (_, index) => current[index] ?? ''))
    setFlowInputError('')
  }, [props.projectId, audioSegmentKey])

  function handleFetchFlowUrls() {
    const sources = flowImageUrls.map(value => ({ kind: 'URL' as const, value: value.trim() }))
    if (sources.some(source => !source.value)) {
      setFlowInputError('Mỗi audio phân đoạn cần một link ảnh Google Flow.')
      return
    }
    setFlowInputError('')
    props.onImportFlowSceneImages?.(sources)
  }

  async function handleChooseFlowFiles() {
    if (typeof window.contentFactory?.storyMedia?.chooseFlowSceneImageFiles !== 'function') {
      setFlowInputError('Main process đang chạy bản cũ. Hãy thoát hoàn toàn app rồi mở lại.')
      return
    }
    const paths = await window.contentFactory.storyMedia.chooseFlowSceneImageFiles()
    if (!paths) return
    const expected = props.media?.audioSegments?.length ?? 0
    if (paths.length !== expected) {
      setFlowInputError(`Đã chọn ${paths.length} ảnh; cần đúng ${expected} ảnh theo thứ tự phân đoạn.`)
      return
    }
    setFlowInputError('')
    props.onImportFlowSceneImages?.(paths.map(value => ({ kind: 'FILE', value })))
  }

  async function handleReveal(path: string) {
    try {
      await window.contentFactory.app.revealFile(path)
    } catch (err) {
      alert(`Không thể mở thư mục: ${String(err)}`)
    }
  }

  async function handleOpenFile(path: string) {
    try {
      if (typeof window.contentFactory.app.openFile === 'function') {
        await window.contentFactory.app.openFile(path)
      } else {
        await window.contentFactory.app.revealFile(path)
      }
    } catch (err) {
      alert(`Không thể mở file: ${String(err)}`)
    }
  }

  async function handleGenerateEmotionDemo() {
    if (typeof window.contentFactory?.storyMedia?.generateEmotionDemo !== 'function') {
      alert('Preload Electron đang là bản cũ (do app được khởi động trước khi thêm tính năng mới). Vui lòng tắt app và chạy lại `yarn start` để cập nhật!')
      return
    }
    try {
      setIsGeneratingDemo(true)
      setVideoLoadError(false)
      const res = await window.contentFactory.storyMedia.generateEmotionDemo({
        projectId: props.projectId,
        emotion: selectedEmotion,
        format: props.videoFormat,
        visualStyle: props.stickVisualStyle,
      })
      const data = {
        videoUrl: res.videoUrl,
        videoPath: res.videoPath,
        emotion: selectedEmotion,
      }
      setLastDemo(data)
      setDemoModal(data)
      void refreshDemoList()

      if (autoApplyBackground && props.projectId) {
        await handleUseDemoAsBackground(res.videoPath, true)
      }
    } catch (err) {
      alert(`Lỗi khi tạo demo hoạt ảnh: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsGeneratingDemo(false)
    }
  }

  async function handleUseDemoAsBackground(customPath?: string, isAuto = false) {
    const targetPath = customPath || demoModal?.videoPath || lastDemo?.videoPath
    if (!props.projectId || !targetPath) return
    try {
      setIsSettingBackground(true)
      await window.contentFactory.storyMedia.useDemoAsBackground?.({
        projectId: props.projectId,
        videoPath: targetPath,
      })
      props.onRefreshMedia?.()
      if (!isAuto) {
        setDemoModal(null)
        alert('✓ Đã áp dụng video demo làm background video cho dự án!')
      }
    } catch (err) {
      alert(`Lỗi khi đặt làm background: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsSettingBackground(false)
    }
  }

  const audioDone = Boolean(props.media?.audioPath)
  const audioSegmentSupport = props.media?.audioSegmentSupport === true
  const audioSegments = props.media?.audioSegments ?? []
  const projectFlowCapture = props.googleFlowCapture?.projectId === props.projectId ? props.googleFlowCapture : null
  const flowCaptureActive = Boolean(projectFlowCapture && ['CONNECTING', 'WAITING_LOGIN', 'GENERATING', 'CAPTURING', 'BUILDING'].includes(projectFlowCapture.stage))
  const backgroundDone = Boolean(props.media?.backgroundPath)
  const storyVideoParts = props.media?.storyVideoParts?.length
    ? props.media.storyVideoParts
    : props.media?.renderUrl ? [{ part: 1, totalParts: 1, format: props.videoFormat, startSeconds: 0, duration: null, path: props.media.renderPath, url: props.media.renderUrl, status: props.media.renderStatus, publishTitle: null, publishDescription: null, publishMetadataPath: null, publishSource: null }] : []
  const storyVideoOutputs = props.media?.storyVideoOutputs?.length
    ? props.media.storyVideoOutputs
    : storyVideoParts.length ? [{ format: storyVideoParts[0].format, status: props.media?.renderStatus ?? null, parts: storyVideoParts }] : []
  const selectedOutput = storyVideoOutputs.find(output => output.format === props.videoFormat)
  const renderDone = Boolean(selectedOutput?.parts.length && selectedOutput.parts.every(part => part.status === 'DONE'))
  const canGenerateAudio = props.hasVoice && props.ffmpegReady && audioSegmentSupport
  const canChooseBackground = audioDone
  const canRender = audioDone && backgroundDone && props.ffmpegReady
  const hasReelVideos = Boolean(props.media?.reels.some(reel => reel.videoUrl))
  const hasRenderedVideo = storyVideoOutputs.some(output => output.parts.some(part => Boolean(part.url))) || Boolean(props.media?.reels.some(reel => reel.videoUrl))
  const hasPublishMetadata = storyVideoOutputs.some(output => output.parts.some(part => Boolean(part.publishTitle || part.publishDescription))) || Boolean(props.media?.reels.some(reel => reel.publishTitle || reel.publishDescription))
  const renderFeatures = `SFX${props.includeSubtitles ? ' + Sub' : ''}`
  const isStickBg = props.media?.backgroundStyle === 'STICK_FIGURE'
  const reelRequirements = [
    { label: 'FFmpeg', ready: props.ffmpegReady },
    { label: 'Voice', ready: props.hasVoice },
    { label: isStickBg ? 'Nền: Người que 9:16 (sẽ vẽ riêng cho từng tập)' : 'Video/Ảnh nền', ready: Boolean(props.media?.backgroundPath) },
    { label: props.media?.thumbnailPath ? 'Thumbnail truyện' : 'Thumbnail tự lấy từ video/nền', ready: Boolean(props.media?.thumbnailPath || props.media?.backgroundPath) },
    { label: `${props.media?.reels.length ?? 0} Reel scripts`, ready: Boolean(props.media?.reels.length) }
  ]
  const missingReelRequirements = reelRequirements.filter(item => !item.ready).map(item => item.label)

  const audioHint = !audioSegmentSupport
    ? 'Main process đang chạy bản cũ. Đóng hoàn toàn app rồi mở lại để bật xuất audio phân đoạn.'
    : !props.hasVoice
    ? 'Chọn voice trước để tạo MP3.'
    : !props.ffmpegReady
      ? 'Cần FFmpeg để ghép các đoạn MP3.'
      : audioDone
        ? audioSegments.length
          ? 'MP3 tổng và các phân đoạn đã sẵn sàng; có thể tạo lại từ story hiện tại.'
          : 'MP3 cũ chưa có file phân đoạn; hãy regenerate để tạo các đoạn riêng.'
        : 'Tạo MP3 tổng kèm từng file phân đoạn.'
  const videoHint = audioDone
    ? (props.media?.backgroundName ?? 'Chọn video hoặc ảnh nền từ máy.')
    : 'Hoàn tất Story MP3 trước.'

  return <div className="story-media-box">
    <div className="media-flow-title">
      <div><strong>Video truyện · Người que / nền tùy chọn</strong><span>Idea → Story → MP3 → hoạt hình người que hoặc nền tùy chọn → video hoàn chỉnh.</span></div>
      <div className="media-flow-progress">
        <span className={audioDone ? 'done' : 'active'}>1</span>
        <i />
        <span className={backgroundDone ? 'done' : audioDone ? 'active' : ''}>2</span>
        <i />
        <span className={backgroundDone ? 'done' : ''}>3</span>
        <i />
        <span className={renderDone ? 'done' : backgroundDone ? 'active' : ''}>4</span>
      </div>
    </div>

    <div className="media-step">
      <div><b>1</b><div><strong>Story MP3 + phân đoạn</strong><span>{audioHint}</span></div></div>
      <button className="secondary" onClick={props.onGenerateAudio} disabled={props.busy || !canGenerateAudio}>
        {audioDone ? 'Regenerate MP3 + phân đoạn' : 'Generate MP3 + phân đoạn'}
      </button>
    </div>
    {props.media?.audioUrl && <div className="media-preview compact"><audio className="voice-player" src={props.media.audioUrl} controls /><span>Duration: {formatDuration(props.media.audioDuration)}</span></div>}
    {!!audioSegments.length && (
      <details className="audio-segments">
        <summary>Audio phân đoạn ({audioSegments.length} file)</summary>
        <div className="audio-segment-list">
          {audioSegments.map(segment => (
            <article className="audio-segment" key={`${segment.index}-${segment.path}`}>
              <div className="audio-segment-head">
                <div>
                  <strong>{segment.kind === 'CTA' ? 'CTA' : `Phân đoạn ${segment.index}`}</strong>
                  <span>{formatDuration(segment.duration)}</span>
                </div>
                <button
                  type="button"
                  className="secondary"
                  title="Mở thư mục chứa file audio"
                  onClick={() => void window.contentFactory.app.revealFile(segment.path)}>
                  Mở file
                </button>
              </div>
              <audio className="voice-player" src={segment.url} controls preload="none" />
              <p>{segment.text}</p>
            </article>
          ))}
        </div>
      </details>
    )}

    {!!audioSegments.length && props.onImportFlowSceneImages && (
      <section className="flow-scenes-import">
        <div className="flow-scenes-heading">
          <div>
            <strong>Ảnh Google Flow theo phân đoạn</strong>
            <span>{flowCaptureActive ? `${projectFlowCapture?.captured ?? 0}/${audioSegments.length} ảnh đang nhận` : `${props.media?.flowSceneImages?.length ?? 0}/${audioSegments.length} ảnh đã ghép`}</span>
          </div>
          <div className="flow-connect-actions">
            {flowCaptureActive ? (
              <button type="button" className="secondary" onClick={props.onCancelGoogleFlowCapture} disabled={props.googleFlowCapture?.stage === 'BUILDING'}>
                {projectFlowCapture?.stage === 'BUILDING' ? 'Đang ghép video...' : 'Dừng nhận ảnh'}
              </button>
            ) : (
              <>
                <button type="button" className="primary" onClick={props.onStartGoogleFlowAutomation} disabled={props.busy}>
                  Tự động tạo bằng Flow
                </button>
                <button type="button" className="secondary" onClick={props.onStartGoogleFlowCapture} disabled={props.busy}>
                  Nhận ảnh tải từ Flow
                </button>
              </>
            )}
            <button type="button" className="secondary" onClick={() => void handleChooseFlowFiles()} disabled={props.busy || flowCaptureActive}>
              Chọn ảnh đã tải
            </button>
          </div>
        </div>
        {projectFlowCapture && (
          <div className={`flow-capture-status stage-${projectFlowCapture.stage.toLowerCase()}`} role="status">
            <progress value={projectFlowCapture.captured} max={Math.max(1, projectFlowCapture.total)} />
            <span>{projectFlowCapture.message}</span>
          </div>
        )}
        <div className="flow-url-list">
          {audioSegments.map((segment, index) => (
            <label className="flow-url-row" key={segment.path}>
              <span>{segment.kind === 'CTA' ? 'CTA' : `Đoạn ${segment.index}`} · {formatDuration(segment.duration)}</span>
              <input
                type="url"
                value={flowImageUrls[index] ?? ''}
                placeholder="https://...googleusercontent.com/..."
                disabled={props.busy}
                onChange={event => setFlowImageUrls(current => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}
              />
              <small>{segment.text}</small>
            </label>
          ))}
        </div>
        <div className="flow-scenes-actions">
          {flowInputError && <span role="alert">{flowInputError}</span>}
          <button type="button" className="secondary" onClick={handleFetchFlowUrls} disabled={props.busy}>
            Tải link và ghép video
          </button>
        </div>
      </section>
    )}

    {!!props.media?.flowSceneImages?.length && (
      <div className={`scene-images-gallery flow-scenes-gallery format-${props.videoFormat.toLowerCase()}`}>
        <h4>Ảnh Google Flow đã đồng bộ ({props.media.flowSceneImages.length} đoạn)</h4>
        <div className="scene-images-grid">
          {props.media.flowSceneImages.map(scene => (
            <div key={scene.index} className="scene-image-card">
              <div className="scene-image-header">
                <span className="scene-number">{scene.kind === 'CTA' ? 'CTA' : `Đoạn ${scene.index}`}</span>
                <span className="scene-setting-tag">{formatDuration(scene.duration)} · {scene.source}</span>
              </div>
              <img src={stickSceneImageUrl(scene)} alt={`Google Flow ${scene.index}`} />
              <p className="scene-text">{scene.sectionText}</p>
            </div>
          ))}
        </div>
      </div>
    )}

    <div className="media-step media-step-2">
      <div className="media-step-head">
        <b>2</b>
        <div>
          <strong>{props.stickVisualStyle === 'ENGINEER_3D' ? 'Hoạt hình 3D Engineer' : 'Hoạt hình người que 2D'} / Background</strong>
          <span>{videoHint}</span>
        </div>
      </div>
      <div className="media-step-row">
        <div className="stick-render-settings">
         <div className="stick-style-selector" aria-label="Phong cách nhân vật">
          <span className="stick-format-label">NHÂN VẬT:</span>
          <div className="stick-format-group">
            <button
              type="button"
              className={`stick-format-btn ${props.stickVisualStyle === 'DOODLE_2D' ? 'active' : ''}`}
              onClick={() => props.onStickVisualStyleChange('DOODLE_2D')}
              disabled={props.busy}
            >
              2D Doodle
            </button>
            <button
              type="button"
              className={`stick-format-btn ${props.stickVisualStyle === 'ENGINEER_3D' ? 'active engineer-3d' : ''}`}
              onClick={() => props.onStickVisualStyleChange('ENGINEER_3D')}
              disabled={props.busy}
            >
              3D Engineer
            </button>
          </div>
         </div>
         <div className="stick-format-selector">
          <span className="stick-format-label">ĐỊNH DẠNG:</span>
          <div className="stick-format-group">
            <button
              type="button"
              className={`stick-format-btn ${props.videoFormat === 'REEL' ? 'active short' : ''}`}
              onClick={() => props.onVideoFormatChange('REEL')}
              disabled={props.busy}
            >
              📱 Video Short (9:16 Dọc)
            </button>
            <button
              type="button"
              className={`stick-format-btn ${props.videoFormat === 'LANDSCAPE' ? 'active' : ''}`}
              onClick={() => props.onVideoFormatChange('LANDSCAPE')}
              disabled={props.busy}
            >
              🖥️ Video Dài (16:9 Ngang)
            </button>
            <button
              type="button"
              className={`stick-format-btn ${props.videoFormat === 'SQUARE' ? 'active' : ''}`}
              onClick={() => props.onVideoFormatChange('SQUARE')}
              disabled={props.busy}
            >
              ⏹️ Vuông (1:1)
            </button>
          </div>
         </div>
        </div>
        <div className="background-actions">
          <label className="stick-source-label">
            NGUỒN CHIA CẢNH
            <select value={stickSource} disabled={props.busy} onChange={event => setStickSource(event.target.value as StickSource)}>
              <option value="CLAUDE_CLI">Claude Code (CLI local)</option>
              <option value="ANTIGRAVITY_CLI">Antigravity (Agent CLI)</option>
              <option value="CODEX_CLI">Codex (CLI local)</option>
              <option value="API">AI đang chọn trong Settings ({props.aiProvider ?? 'mặc định'})</option>
            </select>
          </label>
          <button
            className={props.videoFormat === 'REEL' ? 'primary' : 'secondary'}
            onClick={() => props.onGenerateStickVideo(stickSource)}
            disabled={props.busy}
          >
            {props.videoFormat === 'REEL'
              ? props.stickVisualStyle === 'ENGINEER_3D' ? 'Tạo Short 3D (9:16)' : 'Tạo Short 2D (9:16)'
              : props.stickVisualStyle === 'ENGINEER_3D' ? 'Tạo hoạt hình 3D Engineer' : 'Tạo hoạt hình người que 2D'}
          </button>
          {props.busy && <p role="status">Chưa thể tạo video: {props.busyMessage || 'app đang xử lý tác vụ khác'}. Nút sẽ mở khi tác vụ kết thúc.</p>}
          {props.onGenerateStickmanSceneImages && (
            <button className="secondary" onClick={() => props.onGenerateStickmanSceneImages?.(stickSource)} disabled={props.busy}>
              {props.videoFormat === 'REEL'
                ? props.stickVisualStyle === 'ENGINEER_3D' ? 'Bộ ảnh 3D (9:16)' : 'Bộ ảnh 2D (9:16)'
                : props.stickVisualStyle === 'ENGINEER_3D' ? 'Tạo bộ ảnh 3D' : 'Tạo bộ ảnh 2D'}
            </button>
          )}
          <button className="secondary" onClick={()=>props.onChooseBackground('VIDEO')} disabled={props.busy || !canChooseBackground}>{backgroundDone && props.media?.backgroundKind === 'VIDEO' ? 'Đổi Video' : 'Chọn Video'}</button>
          <button className="secondary" onClick={()=>props.onChooseBackground('IMAGE')} disabled={props.busy || !canChooseBackground}>{backgroundDone && props.media?.backgroundKind === 'IMAGE' ? 'Đổi Ảnh' : 'Chọn Ảnh'}</button>
        </div>
      </div>

      <div className="emotion-demo-bar">
        <div className="emotion-demo-controls">
          <label className="emotion-demo-select-label">
            <span>🎭 CẢM XÚC:</span>
            <select
              value={selectedEmotion}
              disabled={props.busy || isGeneratingDemo}
              onChange={e => setSelectedEmotion(e.target.value)}
            >
              <option value="worried">😰 Khủng hoảng / Lo âu (Crisis - Chuẩn ảnh mẫu)</option>
              <option value="crying">😭 Khóc / Đau buồn (Crying)</option>
              <option value="shocked">⚡ Sốc / Kinh hoàng (Shocked)</option>
              <option value="furious">🔥 Tức giận / Bùng nổ (Furious)</option>
              <option value="happy">🎉 Vui sướng / Ăn mừng (Happy)</option>
              <option value="smug">😎 Tự đắc / Đắc ý (Smug)</option>
              <option value="thinking">🤔 Đắn đo / Suy nghĩ (Thinking)</option>
            </select>
          </label>
          <button
            type="button"
            className="emotion-demo-btn"
            onClick={handleGenerateEmotionDemo}
            disabled={props.busy || isGeneratingDemo}
          >
            {isGeneratingDemo ? '⏳ Đang gen demo...' : '⚡ Gen Demo Hoạt Ảnh'}
          </button>
          <label className="emotion-auto-bg">
            <input
              type="checkbox"
              checked={autoApplyBackground}
              onChange={e => setAutoApplyBackground(e.target.checked)}
            />
            <span>Tự đặt làm Background dự án sau khi gen</span>
          </label>
        </div>
        <span className="emotion-demo-hint">
          ✨ Tạo nhanh clip loop 3s 60fps để xem thử biểu cảm và chuyển động nhân vật.
        </span>
      </div>

      {demoList.length > 0 && (
        <div style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '8px', background: '#0b1120', border: '1px solid #1e293b', fontSize: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ color: '#93c5fd' }}>🎞️ Các video demo đã tạo trong dự án ({demoList.length}):</strong>
            <button
              type="button"
              className="secondary"
              style={{ padding: '2px 8px', fontSize: '11px' }}
              onClick={() => void refreshDemoList()}
            >
              🔄 Làm mới danh sách
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
            {demoList.map(demo => (
              <div
                key={demo.fileName}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  background: '#131b2e',
                  border: '1px solid #23304b',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px' }}>🎬</span>
                  <strong style={{ color: '#f1f5f9' }}>{EMOTION_LABELS[demo.emotion] || demo.emotion}</strong>
                  <span style={{ color: '#64748b', fontSize: '11px' }}>({Math.round(demo.size / 1024)} KB · {new Date(demo.createdAt).toLocaleTimeString()})</span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                    onClick={() => {
                      const d = { videoUrl: demo.videoUrl, videoPath: demo.videoPath, emotion: demo.emotion }
                      setLastDemo(d)
                      setDemoModal(d)
                    }}
                  >
                    👁️ Xem video
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                    onClick={() => void handleReveal(demo.videoPath)}
                    title="Mở thư mục chứa file"
                  >
                    📂 Finder
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                    onClick={() => void handleOpenFile(demo.videoPath)}
                    title="Mở bằng QuickTime hoặc trình xem mặc định"
                  >
                    ▶️ QuickTime
                  </button>
                  {props.projectId && (
                    <button
                      type="button"
                      className="primary"
                      style={{ padding: '3px 10px', fontSize: '11px', background: '#059669', borderColor: '#047857' }}
                      onClick={() => void handleUseDemoAsBackground(demo.videoPath)}
                      disabled={isSettingBackground}
                    >
                      ✓ Dùng làm nền
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {lastDemo && (
        <div
          className="demo-inline-preview"
          style={{
            marginTop: '14px',
            padding: '14px',
            borderRadius: '10px',
            background: '#090d16',
            border: '2px solid #6366f1',
            boxShadow: '0 4px 16px rgba(99, 102, 241, 0.25)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>🎬</span>
              <strong style={{ color: '#c7d2fe', fontSize: '14px' }}>
                Video Demo Đang Xem: <span style={{ color: '#818cf8' }}>{EMOTION_LABELS[lastDemo.emotion] || lastDemo.emotion}</span>
              </strong>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="secondary"
                onClick={() => void handleReveal(lastDemo.videoPath)}
                style={{ padding: '5px 12px', fontSize: '12px' }}
                title="Mở thư mục chứa file trên máy"
              >
                📂 Mở thư mục (Finder)
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void handleOpenFile(lastDemo.videoPath)}
                style={{ padding: '5px 12px', fontSize: '12px' }}
                title="Mở bằng QuickTime Player"
              >
                ▶️ QuickTime
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setDemoModal(lastDemo)}
                style={{ padding: '5px 12px', fontSize: '12px' }}
              >
                🔍 Xem Lớn
              </button>
              {props.projectId && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => handleUseDemoAsBackground(lastDemo.videoPath)}
                  disabled={isSettingBackground}
                  style={{ padding: '5px 14px', fontSize: '12px', background: '#10b981', borderColor: '#059669' }}
                >
                  {isSettingBackground ? 'Đang áp dụng...' : '✓ Dùng làm Video Nền'}
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => setLastDemo(null)}
                style={{ padding: '5px 10px', fontSize: '12px' }}
                title="Đóng bản xem thử này"
              >
                ✕
              </button>
            </div>
          </div>
          <div
            style={{
              background: '#000000',
              borderRadius: '8px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              maxHeight: '440px',
              position: 'relative',
            }}
          >
            <video
              key={lastDemo.videoUrl}
              src={lastDemo.videoUrl}
              autoPlay
              loop
              muted
              playsInline
              controls
              onError={() => setVideoLoadError(true)}
              style={{ maxHeight: '420px', maxWidth: '100%', objectFit: 'contain' }}
            />
            {videoLoadError && (
              <div style={{ padding: '16px', textAlign: 'center', color: '#f87171', background: 'rgba(239, 68, 68, 0.15)', width: '100%' }}>
                <p style={{ margin: '0 0 6px', fontWeight: 600 }}>⚠️ Trình duyệt Electron gặp khó khăn khi stream trực tiếp file này.</p>
                <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Video MP4 đã tạo thành công 100%! Bạn hãy bấm <strong>"📂 Mở thư mục (Finder)"</strong> hoặc <strong>"▶️ QuickTime"</strong> ở góc trên để xem ngay.</p>
              </div>
            )}
          </div>
          <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '6px', background: '#111827', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#94a3b8' }}>
            <span>📁 <strong>File:</strong> <code style={{ color: '#38bdf8' }}>{lastDemo.videoPath}</code></span>
            <button
              type="button"
              className="secondary"
              style={{ padding: '2px 8px', fontSize: '11px' }}
              onClick={() => void window.contentFactory.app.copyText(lastDemo.videoPath).then(() => alert('Đã copy đường dẫn file!'))}
            >
              📋 Copy đường dẫn
            </button>
          </div>
          <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#94a3b8' }}>
            <span>Định dạng: {props.videoFormat === 'REEL' ? '9:16 Dọc (Short)' : '16:9 Ngang'} · 60 fps · Chu kỳ loop 3 giây</span>
            {props.projectId && <span style={{ color: '#34d399' }}>Bấm "✓ Dùng làm Video Nền" nếu bạn muốn xuất video theo hoạt cảnh này.</span>}
          </div>
        </div>
      )}
    </div>
    <p className="sfx-note">
      {props.videoFormat === 'REEL'
        ? '📱 Đang chọn định dạng Video Short (9:16 Dọc): AI tự động chia nhịp cảnh nhanh (3–7s/cảnh), canh giữa nhân vật tránh che bởi UI điện thoại. Hoạt hình doodle 60 fps chuẩn YouTube Shorts / TikTok / Reels.'
        : 'Nguồn chia cảnh hỗ trợ Claude Code, Antigravity, Codex hoặc Gemini API. AI giữ tên và nhận diện nhân vật theo truyện, tạo đầu tròn trắng, thân đen, cà vạt đỏ cho vai chính; chọn biểu cảm, đạo cụ và chuyển động theo đúng lời đọc.'}
    </p>
    
    {props.sceneImages && props.sceneImages.length > 0 && (
      <div className="scene-images-gallery">
        <h4>🖼️ Thư viện Ảnh Người Que theo Phân đoạn Truyện ({props.sceneImages.length} cảnh)</h4>
        <div className="scene-images-grid">
          {props.sceneImages.map(scene => (
            <div key={scene.index} className="scene-image-card">
              <div className="scene-image-header">
                <span className="scene-number">Cảnh {scene.index}</span>
                <span className="scene-setting-tag">{scene.setting}</span>
              </div>
              <img src={stickSceneImageUrl(scene)} alt={`Scene ${scene.index}`} />
              <p className="scene-text">{scene.sectionText}</p>
            </div>
          ))}
        </div>
      </div>
    )}

    {props.media?.backgroundUrl && <div className="media-preview">{props.media.backgroundKind === 'IMAGE' ? <img src={props.media.backgroundUrl} alt="Background" /> : <video src={props.media.backgroundUrl} controls muted={props.media.backgroundStyle !== 'STICK_FIGURE'} />}<span>{props.media.backgroundKind === 'IMAGE' ? 'Ảnh tĩnh · tự kéo dài theo voice' : `${props.media.backgroundStyle === 'STICK_FIGURE' ? `${props.media.backgroundVisualStyle === 'ENGINEER_3D' ? '3D Engineer' : '2D Doodle'} · 60 fps + lời đọc · ` : ''}Duration: ${formatDuration(props.media.backgroundDuration)}`}</span></div>}

    {props.media?.backgroundStyle === 'STICK_FIGURE' && <div className="media-step">
      <div><strong>Thumbnail hoạt hình</strong><span>Lấy ảnh từ video đã tạo, giữ đúng tỉ lệ khung hình.</span></div>
      <button className="secondary" disabled={props.busy || !props.ffmpegReady} onClick={props.onGenerateVideoThumbnail}>Tạo thumbnail từ video</button>
    </div>}
    {props.media?.backgroundStyle === 'STICK_FIGURE' && props.media.thumbnailUrl && <div className="media-preview"><img src={props.media.thumbnailUrl} alt="Thumbnail video hoạt hình" /></div>}

    <div className="media-step sound-effect-step">
      <div><b>3</b><div><strong>Sound effect cho mỗi video</strong><span>SFX chỉ được trộn vào MP4 cuối; MP3 voice gốc không bị thay đổi.</span></div></div>
      <span className="sfx-required">LUÔN BẬT</span>
    </div>
    <div className="sound-effect-controls">
      <label>Kiểu SFX<select value={props.soundEffect.preset} disabled={props.busy} onChange={(event)=>props.onSoundEffectChange({ ...props.soundEffect, preset: event.target.value as SoundEffectPreset })}><option value="DYNAMIC">Dynamic · tự đổi theo tập</option><option value="WHOOSH">Whoosh · chuyển cảnh</option><option value="IMPACT">Impact · nhấn kịch tính</option><option value="CHIME">Chime · điểm nhấn</option></select></label>
      <label className="sfx-volume">Mức SFX<div><input type="range" min={10} max={100} step={5} value={props.soundEffect.volume} disabled={props.busy} onChange={(event)=>props.onSoundEffectChange({ ...props.soundEffect, volume: Number(event.target.value) })} /><output>{props.soundEffect.volume}%</output></div></label>
    </div>
    <div className="sfx-note"><strong>{SOUND_EFFECT_LABELS[props.soundEffect.preset]} · {props.soundEffect.volume}%</strong><span>Dynamic luân phiên Whoosh / Impact / Chime và thay đổi vị trí theo từng tập. Video cũ cần bấm Regenerate để có SFX mới.</span></div>

    <div className="media-step render-step">
      <div><b>4</b><div><strong>{props.videoFormat === 'REEL' ? `Render các Short 9:16 + ${renderFeatures}` : `Render Story video + ${renderFeatures}`}</strong><span>{!props.ffmpegReady ? 'Cần FFmpeg để render.' : !backgroundDone ? 'Chọn video hoặc ảnh background trước.' : props.videoFormat === 'REEL' ? `Tự chia liên tục thành các phần cân bằng, tối đa 3:00/phần; mỗi Short có ${SOUND_EFFECT_LABELS[props.soundEffect.preset]}${props.includeSubtitles ? ' và phụ đề tự động' : ''}.` : `Sẽ trộn ${SOUND_EFFECT_LABELS[props.soundEffect.preset]} ở mức ${props.soundEffect.volume}%${props.includeSubtitles ? ' và đốt phụ đề vào video' : ''}, có ducking để không lấn giọng.`}</span></div></div>
    </div>
    <div className="render-options">
      <label>Output<select value={props.videoFormat} disabled={props.busy} onChange={(event) => props.onVideoFormatChange(event.target.value as VideoFormat)}><option value="LANDSCAPE">16:9 · 1920x1080 · 1 video</option><option value="REEL">9:16 · tự chia Short ≈2:30–3:00</option><option value="SQUARE">1:1 · 1080x1080 · 1 video</option></select></label>
      <label>Fit<select value={props.fitMode} onChange={(event) => props.onFitModeChange(event.target.value as FitMode)}><option value="CROP">Fill / Crop</option><option value="FIT">Fit / Pad</option></select></label>
      <label className="subtitle-option">Phụ đề<span><input type="checkbox" checked={props.includeSubtitles} disabled={props.busy} onChange={(event) => props.onIncludeSubtitlesChange(event.target.checked)} />Đốt vào video</span></label>
      <button className="primary" onClick={props.onRender} disabled={props.busy || !canRender}>{props.videoFormat === 'REEL' ? `${renderDone ? 'Regenerate' : 'Generate'} Short Videos + ${renderFeatures}` : `${renderDone ? 'Regenerate' : 'Generate'} Story Video + ${renderFeatures}`}</button>
    </div>
    {!!storyVideoOutputs.length && <div className="story-video-output-groups">{storyVideoOutputs.map(output => <StoryVideoResult key={output.format} output={output} />)}</div>}
    <div className="publish-metadata-toolbar">
      <div><strong>Title &amp; Description theo từng video</strong><span>Tạo nội dung đăng riêng cho video dài 16:9, từng Short 9:16 và từng Reel.</span></div>
      <button className="secondary" onClick={props.onGenerateMetadata} disabled={props.busy || !hasRenderedVideo}>{hasPublishMetadata ? 'Regenerate' : 'Generate'} Titles &amp; Descriptions</button>
    </div>
    <div className="reel-render-section">
      <div className="media-flow-title"><div><strong>Final · Reel Videos theo từng tập</strong><span>{props.media?.reels.length ? `${props.media.reels.length} video dọc + thumbnail số tập + 1 SFX riêng/video${props.includeSubtitles ? ' + phụ đề' : ''} · ${SOUND_EFFECT_LABELS[props.soundEffect.preset]} ${props.soundEffect.volume}%.` : 'Generate Reel scripts trước.'}</span></div></div>
      <div className="reel-requirements">
        {reelRequirements.map(item => <span className={item.ready ? 'ready' : 'missing'} key={item.label}>{item.ready ? '✓' : '○'} {item.label}</span>)}
      </div>
      {!!missingReelRequirements.length && <p className="reel-blocker-hint">Còn thiếu: {missingReelRequirements.join(' · ')}. Bạn vẫn có thể bấm nút để xem hướng dẫn tương ứng.</p>}
      <button className="primary full" onClick={props.onGenerateReelVideos} disabled={props.busy}>{hasReelVideos ? 'Regenerate' : 'Generate'} {props.media?.reels.length ?? 0} Reel Videos + {renderFeatures}</button>
      {hasReelVideos && <button className="secondary full" onClick={props.onRegenerateReelThumbnails} disabled={props.busy}>Generate lại Thumbnail Reel từ video đã tạo</button>}
      {props.reelProgress && <div className={`reel-progress ${props.reelProgress.stage === 'DONE' ? 'done' : ''}`}>
        <div><strong>{props.reelProgress.percent}%</strong><span>{props.reelProgress.message}</span></div>
        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={props.reelProgress.percent}><i style={{ width: `${props.reelProgress.percent}%` }} /></div>
      </div>}
      {!!props.media?.reels.some(reel => reel.videoUrl) && <div className="reel-output-grid">{props.media.reels.map(reel => reel.videoUrl && <article key={reel.reelId}><div><strong>TẬP {reel.episode}</strong><span>{reel.title}</span></div>{reel.thumbnailUrl && <img src={reel.thumbnailUrl} alt={`Thumbnail tập ${reel.episode}`} />}<video src={reel.videoUrl} controls /><PublishMetadata title={reel.publishTitle} caption={reel.publishCaption} description={reel.publishDescription} metadataPath={reel.publishMetadataPath} source={reel.publishSource} /></article>)}</div>}
    </div>

    {demoModal && (
      <div className="modal-backdrop" onClick={() => setDemoModal(null)}>
        <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '680px', width: '92%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>⚡ Video Hoạt Ảnh Demo:</span>
              <span style={{ color: '#6366f1' }}>
                {EMOTION_LABELS[demoModal.emotion] || demoModal.emotion}
              </span>
            </h4>
            <button
              type="button"
              onClick={() => setDemoModal(null)}
              style={{ border: 'none', background: 'transparent', fontSize: '20px', cursor: 'pointer', color: '#64748b' }}
            >
              ✕
            </button>
          </div>

          <div style={{ background: '#020617', borderRadius: '8px', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '280px', position: 'relative' }}>
            <video
              key={demoModal.videoUrl}
              src={demoModal.videoUrl}
              autoPlay
              loop
              muted
              playsInline
              controls
              onError={() => setVideoLoadError(true)}
              style={{ maxHeight: '50vh', maxWidth: '100%', objectFit: 'contain' }}
            />
            {videoLoadError && (
              <div style={{ padding: '16px', textAlign: 'center', color: '#f87171', background: 'rgba(239, 68, 68, 0.15)', width: '100%' }}>
                <p style={{ margin: '0 0 6px', fontWeight: 600 }}>⚠️ Trình duyệt Electron gặp khó khăn khi stream trực tiếp file này.</p>
                <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Video MP4 đã tạo thành công 100%! Bạn hãy bấm <strong>"📂 Mở thư mục (Finder)"</strong> hoặc <strong>"▶️ QuickTime"</strong> bên dưới để xem ngay.</p>
              </div>
            )}
          </div>

          <div style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '6px', background: '#0f172a', border: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#94a3b8' }}>
            <span>📁 <strong>File:</strong> <code style={{ color: '#38bdf8' }}>{demoModal.videoPath}</code></span>
            <button
              type="button"
              className="secondary"
              style={{ padding: '2px 8px', fontSize: '11px' }}
              onClick={() => void window.contentFactory.app.copyText(demoModal.videoPath).then(() => alert('Đã copy đường dẫn file!'))}
            >
              📋 Copy đường dẫn
            </button>
          </div>

          <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="secondary" onClick={() => void handleReveal(demoModal.videoPath)}>
                📂 Mở thư mục (Finder)
              </button>
              <button type="button" className="secondary" onClick={() => void handleOpenFile(demoModal.videoPath)}>
                ▶️ QuickTime
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="secondary" onClick={() => setDemoModal(null)}>
                Đóng
              </button>
              {props.projectId && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => void handleUseDemoAsBackground(demoModal.videoPath)}
                  disabled={isSettingBackground}
                  style={{ background: '#10b981', borderColor: '#059669' }}
                >
                  {isSettingBackground ? 'Đang áp dụng...' : '✓ Đặt làm Background Video dự án'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
}
