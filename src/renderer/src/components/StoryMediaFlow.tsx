import { useRef, useState } from 'react'
import type { AIProviderName, BackgroundKind, FitMode, ReelVideoProgress, SoundEffectOptions, SoundEffectPreset, StickmanSceneImageDTO, StoryMediaDTO, StoryVideoOutputDTO, VideoFormat } from '../../../shared/types'

export type StickSource = 'API' | 'CODEX_CLI' | 'CLAUDE_CLI' | 'ANTIGRAVITY_CLI'

type Props = {
  busy: boolean
  ffmpegReady: boolean
  hasVoice: boolean
  media: StoryMediaDTO | null
  videoFormat: VideoFormat
  fitMode: FitMode
  soundEffect: SoundEffectOptions
  includeSubtitles: boolean
  reelProgress: ReelVideoProgress | null
  sceneImages?: StickmanSceneImageDTO[]
  aiProvider?: AIProviderName
  onGenerateStickVideo(source: StickSource): void
  onGenerateStickmanSceneImages?(source: StickSource): void
  onGenerateVideoThumbnail(): void
  onGenerateAudio(): void
  onGenerateReelVideos(): void
  onRegenerateReelThumbnails(): void
  onGenerateMetadata(): void
  onChooseBackground(kind: BackgroundKind): void
  onRender(): void
  onVideoFormatChange(value: VideoFormat): void
  onFitModeChange(value: FitMode): void
  onSoundEffectChange(value: SoundEffectOptions): void
  onIncludeSubtitlesChange(value: boolean): void
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
  const [stickSource, setStickSource] = useState<StickSource>('CLAUDE_CLI')
  const audioDone = Boolean(props.media?.audioPath)
  const backgroundDone = Boolean(props.media?.backgroundPath)
  const storyVideoParts = props.media?.storyVideoParts?.length
    ? props.media.storyVideoParts
    : props.media?.renderUrl ? [{ part: 1, totalParts: 1, format: props.videoFormat, startSeconds: 0, duration: null, path: props.media.renderPath, url: props.media.renderUrl, status: props.media.renderStatus, publishTitle: null, publishDescription: null, publishMetadataPath: null, publishSource: null }] : []
  const storyVideoOutputs = props.media?.storyVideoOutputs?.length
    ? props.media.storyVideoOutputs
    : storyVideoParts.length ? [{ format: storyVideoParts[0].format, status: props.media?.renderStatus ?? null, parts: storyVideoParts }] : []
  const selectedOutput = storyVideoOutputs.find(output => output.format === props.videoFormat)
  const renderDone = Boolean(selectedOutput?.parts.length && selectedOutput.parts.every(part => part.status === 'DONE'))
  const canGenerateAudio = props.hasVoice && props.ffmpegReady
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

  const audioHint = !props.hasVoice
    ? 'Chọn voice trước để tạo MP3.'
    : !props.ffmpegReady
      ? 'Cần FFmpeg để ghép các đoạn MP3.'
      : audioDone ? 'MP3 đã sẵn sàng; có thể tạo lại từ story hiện tại.' : 'Sẵn sàng tạo MP3 từ story hiện tại.'
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
      <div><b>1</b><div><strong>Story MP3</strong><span>{audioHint}</span></div></div>
      <button className="secondary" onClick={props.onGenerateAudio} disabled={props.busy || !canGenerateAudio}>
        {audioDone ? 'Regenerate Story MP3' : 'Generate Story MP3'}
      </button>
    </div>
    {props.media?.audioUrl && <div className="media-preview compact"><audio className="voice-player" src={props.media.audioUrl} controls /><span>Duration: {formatDuration(props.media.audioDuration)}</span></div>}

    <div className="media-step">
      <div><b>2</b><div><strong>Hoạt hình người que / Background</strong><span>{videoHint}</span></div></div>
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
      <div className="background-actions">
        <label className="stick-source-label">
          NGUỒN CHIA CẢNH
          <select value={stickSource} disabled={props.busy} onChange={event => setStickSource(event.target.value as StickSource)}>
            <option value="CLAUDE_CLI">Claude Code (CLI local)</option>
            <option value="ANTIGRAVITY_CLI">Antigravity (Agent CLI)</option>
            <option value="CODEX_CLI">Codex (CLI local)</option>
            <option value="API">Gemini API Key (Settings)</option>
          </select>
        </label>
        <button
          className={props.videoFormat === 'REEL' ? 'primary' : 'secondary'}
          onClick={() => props.onGenerateStickVideo(stickSource)}
          disabled={props.busy || !audioDone || !props.ffmpegReady}
        >
          {props.videoFormat === 'REEL' ? '📱 Tạo hoạt hình Short (9:16)' : '🎬 Tạo hoạt hình người que'}
        </button>
        {props.onGenerateStickmanSceneImages && (
          <button className="secondary" onClick={() => props.onGenerateStickmanSceneImages?.(stickSource)} disabled={props.busy}>
            {props.videoFormat === 'REEL' ? '🖼️ Bộ ảnh phân đoạn (9:16)' : '🖼️ Tạo bộ ảnh phân đoạn'}
          </button>
        )}
        <button className="secondary" onClick={()=>props.onChooseBackground('VIDEO')} disabled={props.busy || !canChooseBackground}>{backgroundDone && props.media?.backgroundKind === 'VIDEO' ? 'Đổi Video' : 'Chọn Video'}</button>
        <button className="secondary" onClick={()=>props.onChooseBackground('IMAGE')} disabled={props.busy || !canChooseBackground}>{backgroundDone && props.media?.backgroundKind === 'IMAGE' ? 'Đổi Ảnh' : 'Chọn Ảnh'}</button>
      </div>
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
              <img src={scene.fileUrl} alt={`Scene ${scene.index}`} />
              <p className="scene-text">{scene.sectionText}</p>
            </div>
          ))}
        </div>
      </div>
    )}

    {props.media?.backgroundUrl && <div className="media-preview">{props.media.backgroundKind === 'IMAGE' ? <img src={props.media.backgroundUrl} alt="Background" /> : <video src={props.media.backgroundUrl} controls muted={props.media.backgroundStyle !== 'STICK_FIGURE'} />}<span>{props.media.backgroundKind === 'IMAGE' ? 'Ảnh tĩnh · tự kéo dài theo voice' : `${props.media.backgroundStyle === 'STICK_FIGURE' ? 'Doodle · Bản tạo mới: 60 fps + lời đọc · ' : ''}Duration: ${formatDuration(props.media.backgroundDuration)}`}</span></div>}

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
  </div>
}
