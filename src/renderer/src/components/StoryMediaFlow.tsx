import { useRef, useState } from 'react'
import type { BackgroundKind, FitMode, ReelVideoProgress, SoundEffectOptions, SoundEffectPreset, StoryMediaDTO, StoryVideoOutputDTO, VideoFormat } from '../../../shared/types'

type Props = {
  busy: boolean
  ffmpegReady: boolean
  hasVoice: boolean
  media: StoryMediaDTO | null
  videoFormat: VideoFormat
  fitMode: FitMode
  soundEffect: SoundEffectOptions
  reelProgress: ReelVideoProgress | null
  onGenerateReelVideos(): void
  onGenerateMetadata(): void
  onChooseBackground(kind: BackgroundKind): void
  onRender(): void
  onVideoFormatChange(value: VideoFormat): void
  onFitModeChange(value: FitMode): void
  onSoundEffectChange(value: SoundEffectOptions): void
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

type PublishMetadataProps = {
  title: string | null
  description: string | null
  metadataPath: string | null
  source: string | null
}

function PublishMetadata({ title, description, metadataPath, source }: PublishMetadataProps) {
  const [copied, setCopied] = useState('')
  const [copyFailed, setCopyFailed] = useState(false)
  const feedbackTimer = useRef<number | null>(null)
  const hasMetadata = Boolean(title || description)
  const allText = [title, description].filter((value): value is string => Boolean(value)).join('\n\n')

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
      <strong>Title &amp; Description</strong>
      <div>
        {source && <span className="publish-source">{source}</span>}
        {copied && <span className={copyFailed ? 'copy-error' : 'copy-confirm'}>{copyFailed ? '✕' : '✓'} {copied}</span>}
      </div>
    </div>
    {hasMetadata ? <>
      <label>Title<input readOnly value={title ?? ''} onFocus={(event) => event.currentTarget.select()} /></label>
      <label>Description<textarea readOnly rows={4} value={description ?? ''} onFocus={(event) => event.currentTarget.select()} /></label>
      <div className="copy-actions">
        <button className="secondary" disabled={!title} onClick={() => void copyText(title ?? '', 'Đã copy title')}>Copy title</button>
        <button className="secondary" disabled={!description} onClick={() => void copyText(description ?? '', 'Đã copy description')}>Copy description</button>
        <button className="secondary" disabled={!allText} onClick={() => void copyText(allText, 'Đã copy tất cả')}>Copy cả hai</button>
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
      ? <div className="story-short-grid">{output.parts.map(part=><article key={part.part}><div><strong>SHORT {part.part}/{part.totalParts}</strong><span>{formatDuration(part.duration)} · bắt đầu {formatDuration(part.startSeconds)}</span></div>{part.url ? <video src={part.url} controls preload="metadata" /> : <div className="short-unavailable">{part.status ?? 'Đang chờ'}</div>}<PublishMetadata title={part.publishTitle} description={part.publishDescription} metadataPath={part.publishMetadataPath} source={part.publishSource} /></article>)}</div>
      : output.parts[0]?.url && <div className="story-long-output"><video src={output.parts[0].url} controls /><PublishMetadata title={output.parts[0].publishTitle} description={output.parts[0].publishDescription} metadataPath={output.parts[0].publishMetadataPath} source={output.parts[0].publishSource} /></div>}
  </section>
}

export function StoryMediaFlow(props: Props) {
  const backgroundDone = Boolean(props.media?.backgroundPath)
  const storyVideoParts = props.media?.storyVideoParts?.length
    ? props.media.storyVideoParts
    : props.media?.renderUrl ? [{ part: 1, totalParts: 1, format: props.videoFormat, startSeconds: 0, duration: null, path: props.media.renderPath, url: props.media.renderUrl, status: props.media.renderStatus, publishTitle: null, publishDescription: null, publishMetadataPath: null, publishSource: null }] : []
  const storyVideoOutputs = props.media?.storyVideoOutputs?.length
    ? props.media.storyVideoOutputs
    : storyVideoParts.length ? [{ format: storyVideoParts[0].format, status: props.media?.renderStatus ?? null, parts: storyVideoParts }] : []
  const selectedOutput = storyVideoOutputs.find(output => output.format === props.videoFormat)
  const renderDone = Boolean(selectedOutput?.parts.length && selectedOutput.parts.every(part => part.status === 'DONE'))
  const canChooseBackground = props.hasVoice
  const canRender = backgroundDone && props.ffmpegReady && props.hasVoice
  const hasReelVideos = Boolean(props.media?.reels.some(reel => reel.videoUrl))
  const hasRenderedVideo = storyVideoOutputs.some(output => output.parts.some(part => Boolean(part.url))) || Boolean(props.media?.reels.some(reel => reel.videoUrl))
  const hasPublishMetadata = storyVideoOutputs.some(output => output.parts.some(part => Boolean(part.publishTitle || part.publishDescription))) || Boolean(props.media?.reels.some(reel => reel.publishTitle || reel.publishDescription))

  const videoHint = props.media?.backgroundName ?? 'Chọn video hoặc ảnh nền từ máy.'

  return <div className="story-media-box">
    <div className="media-flow-title">
      <div><strong>Full Story MP3 + Loop Video</strong><span>Chọn video nền → nhạc nền/sound effect → tự động tạo giọng đọc và render video hoàn chỉnh.</span></div>
      <div className="media-flow-progress">
        <span className={backgroundDone ? 'done' : 'active'}>1</span>
        <i />
        <span className={backgroundDone ? 'active' : ''}>2</span>
        <i />
        <span className={renderDone ? 'done' : backgroundDone ? 'active' : ''}>3</span>
      </div>
    </div>

    <div className="media-step">
      <div><b>1</b><div><strong>Background video / ảnh</strong><span>{videoHint}</span></div></div>
      <div className="background-actions"><button className="secondary" onClick={()=>props.onChooseBackground('VIDEO')} disabled={props.busy || !canChooseBackground}>{backgroundDone && props.media?.backgroundKind === 'VIDEO' ? 'Đổi Video' : 'Chọn Video'}</button><button className="secondary" onClick={()=>props.onChooseBackground('IMAGE')} disabled={props.busy || !canChooseBackground}>{backgroundDone && props.media?.backgroundKind === 'IMAGE' ? 'Đổi Ảnh' : 'Chọn Ảnh'}</button></div>
    </div>
    {props.media?.backgroundUrl && <div className="media-preview">{props.media.backgroundKind === 'IMAGE' ? <img src={props.media.backgroundUrl} alt="Background" /> : <video src={props.media.backgroundUrl} controls muted />}<span>{props.media.backgroundKind === 'IMAGE' ? 'Ảnh tĩnh · tự kéo dài theo voice' : `Duration: ${formatDuration(props.media.backgroundDuration)}`}</span></div>}

    <div className="media-step sound-effect-step">
      <div><b>2</b><div><strong>Sound effect cho mỗi video</strong><span>SFX được tự động trộn vào video hoàn chỉnh cùng với giọng đọc.</span></div></div>
      <span className="sfx-required">LUÔN BẬT</span>
    </div>
    <div className="sound-effect-controls">
      <label>Kiểu SFX<select value={props.soundEffect.preset} disabled={props.busy} onChange={(event)=>props.onSoundEffectChange({ ...props.soundEffect, preset: event.target.value as SoundEffectPreset })}><option value="DYNAMIC">Dynamic · tự đổi theo tập</option><option value="WHOOSH">Whoosh · chuyển cảnh</option><option value="IMPACT">Impact · nhấn kịch tính</option><option value="CHIME">Chime · điểm nhấn</option></select></label>
      <label className="sfx-volume">Mức SFX<div><input type="range" min={10} max={100} step={5} value={props.soundEffect.volume} disabled={props.busy} onChange={(event)=>props.onSoundEffectChange({ ...props.soundEffect, volume: Number(event.target.value) })} /><output>{props.soundEffect.volume}%</output></div></label>
    </div>
    <div className="sfx-note"><strong>{SOUND_EFFECT_LABELS[props.soundEffect.preset]} · {props.soundEffect.volume}%</strong><span>Dynamic luân phiên Whoosh / Impact / Chime và thay đổi vị trí theo từng tập. Video cũ cần bấm Regenerate để có SFX mới.</span></div>

    <div className="media-step render-step">
      <div><b>3</b><div><strong>Tạo giọng đọc &amp; Render video</strong><span>{!props.ffmpegReady ? 'Cần FFmpeg để render.' : !backgroundDone ? 'Chọn video hoặc ảnh background trước.' : 'Hệ thống sẽ tự động tạo Story MP3 và render video.'}</span></div></div>
    </div>
    <div className="render-options">
      <label>Output<select value={props.videoFormat} onChange={(event) => props.onVideoFormatChange(event.target.value as VideoFormat)}><option value="LANDSCAPE">16:9 · 1920x1080 · 1 video</option><option value="REEL">9:16 · tự chia Short ≈2:30–3:00</option><option value="SQUARE">1:1 · 1080x1080 · 1 video</option></select></label>
      <label>Fit<select value={props.fitMode} onChange={(event) => props.onFitModeChange(event.target.value as FitMode)}><option value="CROP">Fill / Crop</option><option value="FIT">Fit / Pad</option></select></label>
      <button className="primary" onClick={props.onRender} disabled={props.busy || !canRender}>{props.videoFormat === 'REEL' ? 'Tạo Short Videos (Âm thanh + Video)' : 'Tạo Story Video (Âm thanh + Video)'}</button>
    </div>
    {props.media?.audioUrl && <div className="media-preview compact"><audio className="voice-player" src={props.media.audioUrl} controls /><span>Duration: {formatDuration(props.media.audioDuration)}</span></div>}
    {!!storyVideoOutputs.length && <div className="story-video-output-groups">{storyVideoOutputs.map(output => <StoryVideoResult key={output.format} output={output} />)}</div>}
    <div className="publish-metadata-toolbar">
      <div><strong>Title &amp; Description theo từng video</strong><span>Tạo nội dung đăng riêng cho video dài 16:9, từng Short 9:16 và từng Reel.</span></div>
      <button className="secondary" onClick={props.onGenerateMetadata} disabled={props.busy || !hasRenderedVideo}>{hasPublishMetadata ? 'Regenerate' : 'Generate'} Titles &amp; Descriptions</button>
    </div>
    <div className="reel-render-section">
      <div className="reel-render-section-title-wrapper" style={{ marginTop: '1.5rem' }}>
        <strong>Final · Reel Videos theo từng tập</strong>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted, #888)', display: 'block', marginTop: '0.2rem' }}>
          {props.media?.reels.length ? `${props.media.reels.length} video dọc + thumbnail số tập + 1 SFX riêng/video · ${SOUND_EFFECT_LABELS[props.soundEffect.preset]} ${props.soundEffect.volume}%.` : 'Generate Reel scripts trước.'}
        </span>
      </div>
      <button className="primary full" onClick={props.onGenerateReelVideos} disabled={props.busy || !props.ffmpegReady || !props.hasVoice || !props.media?.backgroundPath || !props.media?.thumbnailPath || !props.media?.reels.length}>{hasReelVideos ? 'Regenerate' : 'Generate'} {props.media?.reels.length ?? 0} Reel Videos + SFX</button>
      {props.reelProgress && <div className={`reel-progress ${props.reelProgress.stage === 'DONE' ? 'done' : ''}`}>
        <div><strong>{props.reelProgress.percent}%</strong><span>{props.reelProgress.message}</span></div>
        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={props.reelProgress.percent}><i style={{ width: `${props.reelProgress.percent}%` }} /></div>
      </div>}
      {!!props.media?.reels.some(reel => reel.videoUrl) && <div className="reel-output-grid">{props.media.reels.map(reel => reel.videoUrl && <article key={reel.reelId}><div><strong>TẬP {reel.episode}</strong><span>{reel.title}</span></div>{reel.thumbnailUrl && <img src={reel.thumbnailUrl} alt={`Thumbnail tập ${reel.episode}`} />}<video src={reel.videoUrl} controls /><PublishMetadata title={reel.publishTitle} description={reel.publishDescription} metadataPath={reel.publishMetadataPath} source={reel.publishSource} /></article>)}</div>}
    </div>
  </div>
}
