import { useEffect, useMemo, useRef, useState } from 'react'
import type { AIProviderName, BackgroundKind, EmotionDemoDTO, FitMode, FlowSceneImageDTO, FlowSceneSource, GenerateSingleImageResult, GoogleFlowCaptureStatus, ReelVideoProgress, SingleImageAspectRatio, SoundEffectOptions, SoundEffectPreset, StickmanSceneImageDTO, StickVisualStyle, StoryMediaDTO, StoryVideoOutputDTO, VideoFormat } from '../../../shared/types'
import { getCtaText } from '../../../shared/audience'

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

export const DEFAULT_STICKY_MAN_PROMPT =
  '2D animated comic style, character Sticky Man, iconic minimalist stick figure with perfectly round white head, thick bold black outlines, expressive cartoon face with thick angular black eyebrows, large black cartoon eyes, and expressive smirk or talking mouth line. Wearing a sharp tailored black suit blazer, white collared shirt, and vibrant red necktie. High contrast dramatic background, cel-shaded 2D vector animation art, graphic novel illustration, wide angle framed shot, medium shot, entire character positioned fully inside the camera view with plenty of headroom and margins on all sides, centered composition, entire figure fully visible, no 3D, no CGI, no realistic human skin, no close-up, no cropped head, no clipped body, no cropped edges.'
export const DEFAULT_BETTER_MIND_PROMPT = DEFAULT_STICKY_MAN_PROMPT
export const DEFAULT_FLUX_PROMPT =
  'Masterpiece, cinematic lighting, photorealistic, highly detailed, 8k resolution, dramatic atmosphere, expressive storytelling composition, professional cinematography, wide angle framed composition, entire subject fully inside frame with generous margins, centered, no cropped head, no cut off edges, no text, no watermark, no split screens.'

type Props = {
  projectId?: string
  contentLanguage?: string
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
  onStartFluxSceneAutomation?(hfToken?: string): void
  onStartBetterMindAutomation?(hfToken?: string, customPrompt?: string, cleanPrevious?: boolean): void
  onChangeHfToken?(): void
  onStartGoogleFlowCapture?(): void
  onCancelGoogleFlowCapture?(): void
  onGenerateVideoThumbnail(): void
  onGenerateAudio(customCta?: string): void
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
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [expandedSegments, setExpandedSegments] = useState<Record<string, boolean>>({})
  const [hfModalOpen, setHfModalOpen] = useState(false)
  const [hfTokenInput, setHfTokenInput] = useState('')
  const [activeStylePreset, setActiveStylePreset] = useState<'FLUX_CINEMATIC' | 'BETTER_MIND'>('FLUX_CINEMATIC')
  const [betterMindPromptInput, setBetterMindPromptInput] = useState<string>(DEFAULT_BETTER_MIND_PROMPT)
  const [cleanPreviousScenes, setCleanPreviousScenes] = useState<boolean>(false)
  const [lightboxSceneIndex, setLightboxSceneIndex] = useState<number | null>(null)
  const [ctaTextInput, setCtaTextInput] = useState<string>(() => getCtaText(props.contentLanguage))

  // State cho Studio tạo 1 ảnh độc lập (Clone modal HF)
  const [singleGenModalOpen, setSingleGenModalOpen] = useState(false)
  const [singlePrompt, setSinglePrompt] = useState<string>(DEFAULT_BETTER_MIND_PROMPT)
  const [singleAspect, setSingleAspect] = useState<SingleImageAspectRatio>('9:16')
  const [singlePreset, setSinglePreset] = useState<'BETTER_MIND' | 'FLUX_CINEMATIC' | 'CUSTOM'>('BETTER_MIND')
  const [singleLoading, setSingleLoading] = useState(false)
  const [singleResult, setSingleResult] = useState<GenerateSingleImageResult | null>(null)
  const [singleError, setSingleError] = useState<string | null>(null)
  const [singleSaveSuccess, setSingleSaveSuccess] = useState<string | null>(null)
  const [singleSaving, setSingleSaving] = useState(false)

  useEffect(() => {
    setCtaTextInput(getCtaText(props.contentLanguage))
  }, [props.contentLanguage])

  const handleCopyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => {
        setCopiedKey(current => (current === key ? null : current))
      }, 2000)
    } catch {
      // fallback
    }
  }

  const handleCopyAllSegmentsText = (e: React.MouseEvent) => {
    e.stopPropagation()
    const segments = props.media?.audioSegments ?? []
    if (!segments.length) return
    const allText = segments
      .map(seg => `[${seg.kind === 'CTA' ? 'CTA' : `Phân đoạn ${seg.index}`} · ${formatDuration(seg.duration)}]\n${seg.text}`)
      .join('\n\n')
    void handleCopyText(allText, 'all')
  }

  const toggleExpandSegment = (key: string) => {
    setExpandedSegments(prev => ({ ...prev, [key]: !prev[key] }))
  }

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

  async function handleStartFluxClick() {
    setActiveStylePreset('FLUX_CINEMATIC')
    try {
      const token = typeof window.contentFactory?.settings?.getHuggingFaceToken === 'function'
        ? await window.contentFactory.settings.getHuggingFaceToken()
        : ''
      if (!token) {
        setHfTokenInput('')
        setHfModalOpen(true)
        return
      }
      props.onStartFluxSceneAutomation?.(token)
    } catch {
      setHfModalOpen(true)
    }
  }

  function handleStartBetterMindClick() {
    setActiveStylePreset('BETTER_MIND')
    setHfModalOpen(true)
  }

  async function handleOpenHfModal() {
    try {
      const token = typeof window.contentFactory?.settings?.getHuggingFaceToken === 'function'
        ? await window.contentFactory.settings.getHuggingFaceToken()
        : ''
      setHfTokenInput(token || '')
      setHfModalOpen(true)
    } catch {
      setHfModalOpen(true)
    }
  }

  async function handleSaveHfTokenAndRun() {
    const trimmed = hfTokenInput.trim()
    if (!trimmed) {
      alert('Vui lòng nhập Hugging Face Token (bắt đầu bằng hf_...)')
      return
    }
    try {
      if (typeof window.contentFactory?.settings?.saveHuggingFaceToken === 'function') {
        await window.contentFactory.settings.saveHuggingFaceToken(trimmed)
      }
    } catch (err) {
      console.error(err)
    }
    setHfModalOpen(false)
    if (activeStylePreset === 'BETTER_MIND') {
      props.onStartBetterMindAutomation?.(trimmed, betterMindPromptInput, cleanPreviousScenes)
    } else {
      props.onStartFluxSceneAutomation?.(trimmed)
    }
  }

  function handleRunWithoutToken() {
    setHfModalOpen(false)
    if (activeStylePreset === 'BETTER_MIND') {
      props.onStartBetterMindAutomation?.('', betterMindPromptInput, cleanPreviousScenes)
    } else {
      props.onStartFluxSceneAutomation?.('')
    }
  }

  async function handleOpenSingleStudio(preset: 'BETTER_MIND' | 'FLUX_CINEMATIC' | 'CUSTOM' = 'BETTER_MIND') {
    setSinglePreset(preset)
    if (preset === 'BETTER_MIND') {
      setSinglePrompt(DEFAULT_BETTER_MIND_PROMPT)
    } else if (preset === 'FLUX_CINEMATIC') {
      setSinglePrompt(DEFAULT_FLUX_PROMPT)
    } else {
      setSinglePrompt('')
    }
    setSingleError(null)
    setSingleSaveSuccess(null)
    try {
      const token = typeof window.contentFactory?.settings?.getHuggingFaceToken === 'function'
        ? await window.contentFactory.settings.getHuggingFaceToken()
        : ''
      setHfTokenInput(token || '')
    } catch {}
    setSingleGenModalOpen(true)
  }

  function handleSelectSinglePreset(preset: 'BETTER_MIND' | 'FLUX_CINEMATIC' | 'CUSTOM') {
    setSinglePreset(preset)
    if (preset === 'BETTER_MIND') {
      setSinglePrompt(DEFAULT_BETTER_MIND_PROMPT)
    } else if (preset === 'FLUX_CINEMATIC') {
      setSinglePrompt(DEFAULT_FLUX_PROMPT)
    }
  }

  async function handleGenerateSingleImage(forceFree: boolean = false) {
    if (!singlePrompt.trim()) {
      alert('Vui lòng nhập prompt để tạo ảnh.')
      return
    }
    setSingleLoading(true)
    setSingleError(null)
    setSingleSaveSuccess(null)
    try {
      const tokenToUse = forceFree ? '' : hfTokenInput.trim()
      if (tokenToUse && typeof window.contentFactory?.settings?.saveHuggingFaceToken === 'function') {
        await window.contentFactory.settings.saveHuggingFaceToken(tokenToUse).catch(() => undefined)
      }

      const res = await window.contentFactory.storyMedia.generateSingleImage({
        prompt: singlePrompt.trim(),
        aspectRatio: singleAspect,
        stylePreset: singlePreset,
        hfToken: tokenToUse,
        projectId: props.projectId
      })
      setSingleResult(res)
    } catch (err) {
      setSingleError(err instanceof Error ? err.message : String(err))
    } finally {
      setSingleLoading(false)
    }
  }

  function handleDownloadSingleImage() {
    if (!singleResult?.dataUrl) return
    const a = document.createElement('a')
    a.href = singleResult.dataUrl
    a.download = `ai_image_${singlePreset.toLowerCase()}_${Date.now()}.jpg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  async function handleSaveSingleToProject() {
    if (!singleResult?.dataUrl || !props.projectId) return
    setSingleSaving(true)
    setSingleSaveSuccess(null)
    try {
      if (typeof window.contentFactory?.storyMedia?.saveImageToProjectScene === 'function') {
        const targetFolder = singlePreset === 'BETTER_MIND' ? 'better-mind-scenes' : 'flux-scenes'
        const res = await window.contentFactory.storyMedia.saveImageToProjectScene({
          projectId: props.projectId,
          dataUrl: singleResult.dataUrl,
          targetFolder
        })
        setSingleSaveSuccess(`✓ Đã lưu ảnh vào dự án: ${res.fileName}`)
        props.onRefreshMedia?.()
      }
    } catch (err) {
      setSingleError(`Lưu vào dự án thất bại: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSingleSaving(false)
    }
  }

  const audioDone = Boolean(props.media?.audioPath)
  const audioSegmentSupport = props.media?.audioSegmentSupport === true
  const audioSegments = props.media?.audioSegments ?? []
  const projectFlowCapture = props.googleFlowCapture?.projectId === props.projectId ? props.googleFlowCapture : null
  const flowCaptureActive = Boolean(projectFlowCapture && ['CONNECTING', 'WAITING_LOGIN', 'GENERATING', 'CAPTURING', 'BUILDING'].includes(projectFlowCapture.stage))

  const availableFlowScenes = useMemo(() => {
    const map = new Map<number, FlowSceneImageDTO>()
    if (props.media?.flowSceneImages) {
      for (const scene of props.media.flowSceneImages) {
        map.set(scene.index, scene)
      }
    }
    if (projectFlowCapture?.recentImages) {
      for (const scene of projectFlowCapture.recentImages) {
        map.set(scene.index, scene)
      }
    }
    return Array.from(map.values()).sort((a, b) => a.index - b.index)
  }, [props.media?.flowSceneImages, projectFlowCapture?.recentImages])

  useEffect(() => {
    if (lightboxSceneIndex === null) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxSceneIndex(null)
      } else if (e.key === 'ArrowLeft') {
        const currentIdx = availableFlowScenes.findIndex(s => s.index === lightboxSceneIndex)
        if (currentIdx > 0) {
          setLightboxSceneIndex(availableFlowScenes[currentIdx - 1].index)
        }
      } else if (e.key === 'ArrowRight') {
        const currentIdx = availableFlowScenes.findIndex(s => s.index === lightboxSceneIndex)
        if (currentIdx >= 0 && currentIdx < availableFlowScenes.length - 1) {
          setLightboxSceneIndex(availableFlowScenes[currentIdx + 1].index)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [lightboxSceneIndex, availableFlowScenes])

  const activeLightboxScene = lightboxSceneIndex !== null
    ? availableFlowScenes.find(s => s.index === lightboxSceneIndex) || null
    : null
  const activeLightboxIdx = activeLightboxScene
    ? availableFlowScenes.findIndex(s => s.index === activeLightboxScene.index)
    : -1
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
      <button className="secondary" onClick={() => props.onGenerateAudio(ctaTextInput)} disabled={props.busy || !canGenerateAudio}>
        {audioDone ? 'Regenerate MP3 + phân đoạn' : 'Generate MP3 + phân đoạn'}
      </button>
    </div>
    <div style={{ margin: '6px 0 12px', padding: '10px 14px', background: 'rgba(15, 23, 42, 0.7)', border: '1px solid #334155', borderRadius: '7px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: '#c7d2fe', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>📢</span> Câu CTA kết thúc video ({props.contentLanguage?.startsWith('en') ? 'Tiếng Anh' : props.contentLanguage?.startsWith('vi') ? 'Tiếng Việt' : props.contentLanguage || 'Mặc định'}):
        </label>
        <button
          type="button"
          style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => setCtaTextInput(getCtaText(props.contentLanguage))}
          title="Đặt lại câu CTA mặc định theo ngôn ngữ dự án"
        >
          ↺ Đặt lại mặc định
        </button>
      </div>
      <input
        type="text"
        value={ctaTextInput}
        onChange={e => setCtaTextInput(e.target.value)}
        style={{ width: '100%', padding: '7px 11px', borderRadius: '5px', background: '#090d16', border: '1px solid #475569', color: '#f1f5f9', fontSize: '12px', boxSizing: 'border-box' }}
        placeholder="Nhập câu kêu gọi like & đăng ký kênh ghép vào cuối video..."
      />
    </div>
    {props.media?.audioUrl && <div className="media-preview compact"><audio className="voice-player" src={props.media.audioUrl} controls /><span>Duration: {formatDuration(props.media.audioDuration)}</span></div>}
    {!!audioSegments.length && (
      <details className="audio-segments" open>
        <summary className="audio-segments-summary">
          <div className="audio-segments-summary-left">
            <span>Audio phân đoạn ({audioSegments.length} file)</span>
          </div>
          <div className="audio-segments-summary-actions" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className={`secondary small copy-all-btn ${copiedKey === 'all' ? 'copied' : ''}`}
              title="Sao chép toàn bộ text của tất cả phân đoạn"
              onClick={handleCopyAllSegmentsText}>
              {copiedKey === 'all' ? '✓ Đã copy toàn bộ text' : '📋 Copy toàn bộ text'}
            </button>
            <button
              type="button"
              className="secondary small"
              title="Mở thư mục chứa các file audio và text phân đoạn"
              onClick={() => void window.contentFactory.app.revealFile(audioSegments[0].path)}>
              📂 Mở thư mục
            </button>
          </div>
        </summary>
        <div className="audio-segment-list">
          {audioSegments.map(segment => {
            const segKey = `${segment.index}-${segment.path}`
            const isCopied = copiedKey === segKey
            const isExpanded = !!expandedSegments[segKey]
            const isLong = segment.text.length > 140
            return (
              <article className="audio-segment" key={segKey}>
                <div className="audio-segment-head">
                  <div>
                    <strong>{segment.kind === 'CTA' ? 'CTA' : `Phân đoạn ${segment.index}`}</strong>
                    <span>{formatDuration(segment.duration)}</span>
                  </div>
                  <div className="audio-segment-actions">
                    <button
                      type="button"
                      className={`secondary small copy-segment-btn ${isCopied ? 'copied' : ''}`}
                      title="Sao chép text của phân đoạn này"
                      onClick={() => void handleCopyText(segment.text, segKey)}>
                      {isCopied ? '✓ Đã copy' : '📋 Copy text'}
                    </button>
                    <button
                      type="button"
                      className="secondary small"
                      title="Mở file MP3 trong thư mục"
                      onClick={() => void window.contentFactory.app.revealFile(segment.path)}>
                      MP3
                    </button>
                    <button
                      type="button"
                      className="secondary small"
                      title="Mở file Text (.txt) của phân đoạn này"
                      onClick={() => void window.contentFactory.app.revealFile(segment.textPath || segment.path)}>
                      TXT
                    </button>
                  </div>
                </div>
                <audio className="voice-player" src={segment.url} controls preload="none" />
                <div className="audio-segment-text-wrapper">
                  <p className={`audio-segment-text ${isExpanded ? 'expanded' : ''}`}>{segment.text}</p>
                  {isLong && (
                    <button
                      type="button"
                      className="text-expand-btn"
                      onClick={() => toggleExpandSegment(segKey)}>
                      {isExpanded ? 'Thu gọn ▲' : 'Xem đầy đủ ▼'}
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </details>
    )}

    {!audioSegments.length && (
      <section className="flow-scenes-import" style={{ borderStyle: 'dashed', opacity: 0.9 }}>
        <div className="flow-scenes-heading">
          <div>
            <strong>Bước 2: Ảnh kịch bản theo phân đoạn</strong>
            <span>Chưa có audio phân đoạn</span>
          </div>
          <div className="flow-connect-actions">
            <button
              type="button"
              className="primary flux-auto-btn"
              title="Cần có audio phân đoạn trước khi tạo ảnh"
              onClick={() => void handleStartFluxClick()}
              disabled={props.busy}>
              ⚡ Tạo ảnh chi tiết (FLUX HF)
            </button>
            <button
              type="button"
              className="primary better-mind-auto-btn"
              style={{
                background: 'linear-gradient(135deg, #090d16 0%, #1e1b4b 50%, #3730a3 100%)',
                borderColor: '#6366f1',
                color: '#e0e7ff',
                boxShadow: '0 0 10px rgba(99, 102, 241, 0.4)',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title="Tự động tạo hoạt cảnh phong cách A Better Mind (Dark Minimalist, Sơ đồ tư duy, Não bộ, Silhouette)"
              onClick={() => void handleStartBetterMindClick()}
              disabled={props.busy}>
              <span>🧠</span> Tạo ảnh A Better Mind
            </button>
            <button
              type="button"
              className="secondary"
              style={{
                background: 'linear-gradient(135deg, rgba(234, 88, 12, 0.2) 0%, rgba(249, 115, 22, 0.15) 100%)',
                borderColor: '#f97316',
                color: '#fdba74',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title="Mở Studio thử nghiệm tạo 1 ảnh độc lập với Prompt tùy biến và xem kết quả ngay"
              onClick={() => void handleOpenSingleStudio('BETTER_MIND')}
              disabled={props.busy || singleLoading}>
              <span>🎨</span> Thử tạo 1 ảnh
            </button>
            <button
              type="button"
              className="secondary small"
              title="Cài đặt hoặc cập nhật Hugging Face Access Token"
              onClick={() => void handleOpenHfModal()}
              disabled={props.busy}>
              🔑 Token
            </button>
          </div>
        </div>
        <div style={{ padding: '12px 14px', background: 'rgba(30, 41, 59, 0.5)', borderRadius: '8px', fontSize: '12px', color: '#94a3b8', lineHeight: 1.6, marginTop: '8px' }}>
          💡 Hãy bấm nút <strong>"Generate Story MP3"</strong> ở Bước 1 ở trên trước. Hệ thống sẽ tự động phân tách kịch bản thành các đoạn audio nhỏ và khớp ảnh chi tiết tương ứng với từng phân đoạn. Bạn cũng có thể bấm <strong>"🔑 Token"</strong> để cài đặt sẵn Hugging Face Token ngay bây giờ!
        </div>
      </section>
    )}

    {!!audioSegments.length && props.onImportFlowSceneImages && (
      <section className="flow-scenes-import">
        <div className="flow-scenes-heading">
          <div>
            <strong>Ảnh Google Flow theo phân đoạn</strong>
            <span>{flowCaptureActive ? `${projectFlowCapture?.captured ?? availableFlowScenes.length}/${audioSegments.length} ảnh đang tạo` : `${availableFlowScenes.length}/${audioSegments.length} ảnh đã sẵn sàng`}</span>
          </div>
          <div className="flow-connect-actions">
            {flowCaptureActive ? (
              <button type="button" className="secondary" onClick={props.onCancelGoogleFlowCapture} disabled={props.googleFlowCapture?.stage === 'BUILDING'}>
                {projectFlowCapture?.stage === 'BUILDING' ? 'Đang ghép video...' : 'Dừng tạo ảnh'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="primary flux-auto-btn"
                  title="Tự động tạo ảnh chi tiết tả thực với FLUX qua Hugging Face Inference API (Miễn phí 100%)"
                  onClick={() => void handleStartFluxClick()}
                  disabled={props.busy}>
                  ⚡ Tạo ảnh chi tiết (FLUX HF)
                </button>
                <button
                  type="button"
                  className="primary better-mind-auto-btn"
                  style={{
                    background: 'linear-gradient(135deg, #090d16 0%, #1e1b4b 50%, #3730a3 100%)',
                    borderColor: '#6366f1',
                    color: '#e0e7ff',
                    boxShadow: '0 0 10px rgba(99, 102, 241, 0.4)',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title="Tự động tạo hoạt cảnh phong cách A Better Mind (Dark Minimalist, Sơ đồ tư duy, Não bộ, Silhouette) cho từng phân đoạn"
                  onClick={() => void handleStartBetterMindClick()}
                  disabled={props.busy}>
                  <span>🧠</span> Tạo ảnh A Better Mind
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{
                    background: 'linear-gradient(135deg, rgba(234, 88, 12, 0.2) 0%, rgba(249, 115, 22, 0.15) 100%)',
                    borderColor: '#f97316',
                    color: '#fdba74',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title="Mở Studio thử nghiệm tạo 1 ảnh độc lập với Prompt tùy biến và xem kết quả ngay"
                  onClick={() => void handleOpenSingleStudio('BETTER_MIND')}
                  disabled={props.busy || singleLoading}>
                  <span>🎨</span> Thử tạo 1 ảnh
                </button>
                <button
                  type="button"
                  className="secondary small"
                  title="Cài đặt hoặc cập nhật Hugging Face Access Token"
                  onClick={() => void handleOpenHfModal()}
                  disabled={props.busy}>
                  🔑 Token
                </button>
                <button type="button" className="secondary" onClick={props.onStartGoogleFlowAutomation} disabled={props.busy}>
                  Tự động bằng Flow
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
          {audioSegments.map((segment, index) => {
            const flowCopyKey = `flow-${segment.index}`
            const isFlowCopied = copiedKey === flowCopyKey
            return (
              <label className="flow-url-row" key={segment.path}>
                <div className="flow-url-row-head">
                  <span>{segment.kind === 'CTA' ? 'CTA' : `Đoạn ${segment.index}`} · {formatDuration(segment.duration)}</span>
                  <button
                    type="button"
                    className={`flow-copy-btn ${isFlowCopied ? 'copied' : ''}`}
                    title="Sao chép text phân đoạn này để dán vào prompt Google Flow"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      void handleCopyText(segment.text, flowCopyKey)
                    }}>
                    {isFlowCopied ? '✓ Đã copy' : '📋 Copy text'}
                  </button>
                </div>
                <input
                  type="url"
                  value={flowImageUrls[index] ?? ''}
                  placeholder="https://...googleusercontent.com/..."
                  disabled={props.busy}
                  onChange={event => setFlowImageUrls(current => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))}
                />
                <small title={segment.text}>{segment.text}</small>
              </label>
            )
          })}
        </div>
        <div className="flow-scenes-actions">
          {flowInputError && <span role="alert">{flowInputError}</span>}
          <button type="button" className="secondary" onClick={handleFetchFlowUrls} disabled={props.busy}>
            Tải link và ghép video
          </button>
        </div>
      </section>
    )}

    {!!availableFlowScenes.length && (
      <div className={`scene-images-gallery flow-scenes-gallery format-${props.videoFormat.toLowerCase()}`}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>🖼️ Xem trước ảnh phân đoạn ({availableFlowScenes.length}/{audioSegments.length || availableFlowScenes.length} đoạn)</span>
            {flowCaptureActive && (
              <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', border: '1px solid #0284c7', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#38bdf8', display: 'inline-block', boxShadow: '0 0 8px #38bdf8' }} />
                Đang tạo trực tiếp...
              </span>
            )}
          </h4>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            💡 Nhấp vào bất kỳ ảnh nào để xem trước cỡ lớn (Lightbox Zoom)
          </span>
        </div>
        <div className="scene-images-grid">
          {availableFlowScenes.map(scene => (
            <div
              key={scene.index}
              className="scene-image-card"
              style={{ cursor: 'pointer', transition: 'transform 0.15s ease, border-color 0.15s ease' }}
              onClick={() => setLightboxSceneIndex(scene.index)}
              title={`Nhấp để mở xem chi tiết phân đoạn ${scene.index}`}
            >
              <div className="scene-image-header">
                <span className="scene-number">{scene.kind === 'CTA' ? 'CTA' : `Đoạn ${scene.index}`}</span>
                <span className="scene-setting-tag">{formatDuration(scene.duration)}</span>
              </div>
              <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '6px' }}>
                <img src={stickSceneImageUrl(scene)} alt={`Phân đoạn ${scene.index}`} style={{ objectFit: 'contain', background: '#070a13' }} />
                <div className="card-hover-preview">
                  🔍 Xem lớn
                </div>
              </div>
              <p className="scene-text" title={scene.sectionText}>{scene.sectionText}</p>
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

    {hfModalOpen && (
      <div className="modal-backdrop" onClick={() => setHfModalOpen(false)}>
        <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '580px', width: '92%' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{activeStylePreset === 'BETTER_MIND' ? '🧠' : '⚡'}</span>
            {activeStylePreset === 'BETTER_MIND'
              ? 'Tạo hoạt cảnh Sticky Man 2D (@abettermind Style)'
              : 'Tạo ảnh chi tiết tả thực (FLUX Engine)'}
          </h3>
          <div style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: '1.6', marginBottom: '14px' }}>
            {activeStylePreset === 'BETTER_MIND' ? (
              <>
                <p style={{ margin: '0 0 10px', color: '#e2e8f0' }}>
                  Phong cách chuẩn <strong>Sticky Man (@abettermind)</strong>: Nhân vật <strong>Người que mặt tròn trắng viền đen</strong>, đầy đủ lông mày, mắt và khuôn miệng biểu cảm theo ngữ cảnh, mặc áo vest đen và cà vạt đỏ. Mỗi phân đoạn kịch bản sẽ được vẽ chi tiết hành động, biểu cảm và bối cảnh tương ứng. <em>Tuyệt đối 2D vector comic, không render 3D hay người thật.</em>
                </p>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontWeight: 600, color: '#c7d2fe', fontSize: '12px' }}>
                      ✏️ Prompt Sticky Man 2D (Bạn có thể tùy chỉnh hoặc thêm chi tiết):
                    </label>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => setBetterMindPromptInput(DEFAULT_BETTER_MIND_PROMPT)}
                    >
                      ↺ Đặt lại prompt mặc định
                    </button>
                  </div>
                  <textarea
                    value={betterMindPromptInput}
                    onChange={e => setBetterMindPromptInput(e.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', background: '#0f172a', border: '1px solid #334155', color: '#f1f5f9', fontSize: '12px', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.4 }}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', marginBottom: '12px', fontSize: '12px', color: '#fca5a5', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={cleanPreviousScenes}
                    onChange={e => setCleanPreviousScenes(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span><strong>Xóa ảnh cũ & tạo lại toàn bộ từ đầu</strong> (Khuyên chọn để loại bỏ các ảnh 3D cũ và thay bằng Người que 2D)</span>
                </label>
              </>
            ) : (
              <p style={{ margin: '0 0 8px' }}>
                Hệ thống sẽ tạo ảnh phân đoạn chi tiết, tả thực, chuẩn điện ảnh khớp 100% với từng câu thoại kịch bản.
              </p>
            )}
            <div style={{ padding: '10px 12px', background: 'rgba(15, 23, 42, 0.6)', borderRadius: '6px', marginBottom: '12px', border: '1px solid #334155' }}>
              💡 <strong>Hoàn toàn Miễn phí:</strong> Bạn có thể bấm nút màu xanh lá <strong>"⚡ Tạo ngay (Free - Không cần token)"</strong> ở dưới để chạy ngay lập tức, hoặc dán Hugging Face Token nếu muốn ưu tiên gọi model qua tài khoản HF của bạn.
            </div>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', color: '#e2e8f0' }}>
              Hugging Face Access Token (Tùy chọn, chuỗi hf_...):
            </label>
            <input
              type="password"
              value={hfTokenInput}
              onChange={e => setHfTokenInput(e.target.value)}
              placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (hoặc để trống)"
              style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', background: '#0f172a', border: '1px solid #334155', color: '#fff', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="secondary"
              style={{ color: '#34d399', borderColor: '#059669', background: 'rgba(5, 150, 105, 0.15)' }}
              onClick={handleRunWithoutToken}>
              ⚡ Tạo ngay (Free - Không cần token)
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="secondary" onClick={() => setHfModalOpen(false)}>
                Hủy
              </button>
              <button
                type="button"
                className="primary flux-auto-btn"
                onClick={() => void handleSaveHfTokenAndRun()}>
                {hfTokenInput.trim() ? '✓ Lưu HF & Bắt đầu' : 'Bắt đầu tạo'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {singleGenModalOpen && (
      <div className="modal-backdrop" onClick={() => !singleLoading && setSingleGenModalOpen(false)}>
        <div
          className="modal-card"
          onClick={e => e.stopPropagation()}
          style={{
            maxWidth: '740px',
            width: '94%',
            maxHeight: '92vh',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px 24px',
            background: 'linear-gradient(145deg, #0b1120 0%, #0f172a 100%)',
            border: '1px solid #334155',
            borderRadius: '12px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 25px rgba(99, 102, 241, 0.2)'
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #1e293b', paddingBottom: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '17px', display: 'flex', alignItems: 'center', gap: '8px', color: '#f8fafc' }}>
              <span style={{ fontSize: '20px' }}>🎨</span>
              <span>Studio Tạo Ảnh AI (Thử Prompt & Token)</span>
            </h3>
            <button
              type="button"
              disabled={singleLoading}
              onClick={() => setSingleGenModalOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '18px',
                cursor: singleLoading ? 'not-allowed' : 'pointer',
                padding: '4px 8px',
                borderRadius: '4px'
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
            {/* 1. Chọn Preset Phong cách */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '12px', color: '#cbd5e1', marginBottom: '6px' }}>
                Chọn phong cách mẫu:
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => handleSelectSinglePreset('BETTER_MIND')}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: singlePreset === 'BETTER_MIND' ? '1px solid #6366f1' : '1px solid #334155',
                    background: singlePreset === 'BETTER_MIND' ? 'rgba(99, 102, 241, 0.25)' : '#0f172a',
                    color: singlePreset === 'BETTER_MIND' ? '#c7d2fe' : '#94a3b8'
                  }}
                >
                  <span>🧠</span> Sticky Man 2D (@abettermind)
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectSinglePreset('FLUX_CINEMATIC')}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: singlePreset === 'FLUX_CINEMATIC' ? '1px solid #0284c7' : '1px solid #334155',
                    background: singlePreset === 'FLUX_CINEMATIC' ? 'rgba(2, 132, 199, 0.25)' : '#0f172a',
                    color: singlePreset === 'FLUX_CINEMATIC' ? '#bae6fd' : '#94a3b8'
                  }}
                >
                  <span>⚡</span> FLUX Cinematic tả thực
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectSinglePreset('CUSTOM')}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: singlePreset === 'CUSTOM' ? '1px solid #10b981' : '1px solid #334155',
                    background: singlePreset === 'CUSTOM' ? 'rgba(16, 185, 129, 0.25)' : '#0f172a',
                    color: singlePreset === 'CUSTOM' ? '#a7f3d0' : '#94a3b8'
                  }}
                >
                  <span>✍️</span> Tùy chỉnh tự do
                </button>
              </div>
            </div>

            {/* 2. Chọn Tỉ lệ khung hình (Aspect Ratio) */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '12px', color: '#cbd5e1', marginBottom: '6px' }}>
                Tỉ lệ ảnh (Aspect Ratio):
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['9:16', '16:9', '1:1'] as const).map(ar => (
                  <button
                    key={ar}
                    type="button"
                    onClick={() => setSingleAspect(ar)}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: singleAspect === ar ? '1px solid #f97316' : '1px solid #334155',
                      background: singleAspect === ar ? 'rgba(249, 115, 22, 0.2)' : '#0f172a',
                      color: singleAspect === ar ? '#fdba74' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>{ar === '9:16' ? '📱 9:16 (Shorts)' : ar === '16:9' ? '🖥️ 16:9 (Ngang)' : '🔲 1:1 (Vuông)'}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Prompt Input */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '12px' }}>
                  ✏️ Prompt tạo ảnh:
                </label>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => {
                    if (singlePreset === 'BETTER_MIND') setSinglePrompt(DEFAULT_BETTER_MIND_PROMPT)
                    else if (singlePreset === 'FLUX_CINEMATIC') setSinglePrompt(DEFAULT_FLUX_PROMPT)
                    else setSinglePrompt('')
                  }}
                >
                  ↺ Khôi phục Prompt mẫu
                </button>
              </div>
              <textarea
                value={singlePrompt}
                onChange={e => setSinglePrompt(e.target.value)}
                rows={3}
                placeholder="Nhập mô tả hình ảnh, hành động, biểu cảm nhân vật, bối cảnh..."
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '6px',
                  background: '#090d16',
                  border: '1px solid #334155',
                  color: '#f8fafc',
                  fontSize: '12px',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  lineHeight: 1.45
                }}
              />
            </div>

            {/* 4. Hugging Face Access Token */}
            <div style={{ marginBottom: '14px', background: 'rgba(15, 23, 42, 0.7)', padding: '10px 12px', borderRadius: '8px', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ fontWeight: 600, fontSize: '12px', color: '#cbd5e1' }}>
                  🔑 Hugging Face Token (hf_...):
                </label>
                <span style={{ fontSize: '11px', color: '#64748b' }}>
                  Để trống để dùng Free Sana Engine
                </span>
              </div>
              <input
                type="password"
                value={hfTokenInput}
                onChange={e => setHfTokenInput(e.target.value)}
                placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (tùy chọn)"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: '#090d16',
                  border: '1px solid #475569',
                  color: '#fff',
                  fontSize: '12px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Error & Success Messages */}
            {singleError && (
              <div style={{ padding: '10px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '6px', color: '#fca5a5', fontSize: '12px', marginBottom: '14px', lineHeight: 1.4 }}>
                ⚠️ <strong>Lỗi tạo ảnh:</strong> {singleError}
              </div>
            )}
            {singleSaveSuccess && (
              <div style={{ padding: '10px 12px', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '6px', color: '#6ee7b7', fontSize: '12px', marginBottom: '14px' }}>
                {singleSaveSuccess}
              </div>
            )}

            {/* Loading Indicator */}
            {singleLoading && (
              <div style={{ textAlign: 'center', padding: '24px 16px', background: 'rgba(15, 23, 42, 0.6)', borderRadius: '8px', border: '1px dashed #6366f1', marginBottom: '14px' }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>🎨 ⏳</div>
                <div style={{ color: '#c7d2fe', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                  Đang khởi tạo và vẽ hình ảnh...
                </div>
                <div style={{ color: '#94a3b8', fontSize: '12px' }}>
                  {hfTokenInput.trim() ? 'Đang gọi Hugging Face Inference API (FLUX/Turbo)...' : 'Đang gọi Free Sana Engine chất lượng cao...'}
                </div>
              </div>
            )}

            {/* Result Preview Box */}
            {singleResult && !singleLoading && (
              <div style={{ background: '#090d16', border: '1px solid #334155', borderRadius: '10px', padding: '14px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', background: singleResult.engineUsed === 'HUGGING_FACE' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(16, 185, 129, 0.2)', color: singleResult.engineUsed === 'HUGGING_FACE' ? '#a5b4fc' : '#6ee7b7', border: `1px solid ${singleResult.engineUsed === 'HUGGING_FACE' ? '#6366f1' : '#10b981'}`, padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                      {singleResult.engineUsed === 'HUGGING_FACE' ? `HF: ${singleResult.modelUsed}` : `Free: ${singleResult.modelUsed}`}
                    </span>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {singleResult.width} × {singleResult.height}px
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="secondary small"
                      onClick={handleDownloadSingleImage}
                      style={{ color: '#38bdf8', borderColor: '#0284c7', background: 'rgba(2, 132, 199, 0.15)', fontSize: '11px', padding: '4px 10px' }}
                    >
                      📥 Tải ảnh về
                    </button>
                    {props.projectId && (
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => void handleSaveSingleToProject()}
                        disabled={singleSaving}
                        style={{ color: '#34d399', borderColor: '#059669', background: 'rgba(5, 150, 105, 0.15)', fontSize: '11px', padding: '4px 10px' }}
                      >
                        {singleSaving ? 'Đang lưu...' : '💾 Lưu vào dự án'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Image Display */}
                <div style={{ display: 'flex', justifyContent: 'center', background: '#000', borderRadius: '8px', overflow: 'hidden', maxHeight: '420px', border: '1px solid #1e293b' }}>
                  <img
                    src={singleResult.dataUrl}
                    alt="AI Generated"
                    style={{
                      maxHeight: '420px',
                      maxWidth: '100%',
                      objectFit: 'contain',
                      borderRadius: '6px'
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', borderTop: '1px solid #1e293b', paddingTop: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <button
              type="button"
              className="secondary"
              style={{ color: '#34d399', borderColor: '#059669', background: 'rgba(5, 150, 105, 0.15)', fontSize: '12px' }}
              onClick={() => void handleGenerateSingleImage(true)}
              disabled={singleLoading}
            >
              ⚡ Tạo Free (Không cần token)
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="secondary"
                onClick={() => setSingleGenModalOpen(false)}
                disabled={singleLoading}
              >
                Đóng
              </button>
              <button
                type="button"
                className="primary"
                style={{
                  background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                  borderColor: '#6366f1',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onClick={() => void handleGenerateSingleImage(false)}
                disabled={singleLoading}
              >
                <span>⚡</span>
                {singleLoading ? 'Đang tạo ảnh...' : (hfTokenInput.trim() ? 'Tạo ảnh (Dùng HF Token)' : 'Tạo ảnh ngay')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {activeLightboxScene && (
      <div
        className="modal-overlay"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: 'rgba(2, 6, 23, 0.88)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}
        onClick={() => setLightboxSceneIndex(null)}
      >
        <div
          className="better-mind-lightbox"
          style={{
            maxWidth: '960px',
            width: '100%',
            maxHeight: '92vh',
            background: '#0d111c',
            border: '1px solid #334155',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 30px rgba(99, 102, 241, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative'
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0a0d18' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '15px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>🔍</span> Phân đoạn {activeLightboxScene.index} / {audioSegments.length || availableFlowScenes.length}
              </span>
              <span style={{ fontSize: '11px', padding: '3px 9px', borderRadius: '4px', background: activeLightboxScene.kind === 'CTA' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.2)', color: activeLightboxScene.kind === 'CTA' ? '#fca5a5' : '#a5b4fc', border: '1px solid currentColor', fontWeight: 600 }}>
                {activeLightboxScene.kind === 'CTA' ? 'Kêu gọi CTA' : 'Cốt truyện'} · {formatDuration(activeLightboxScene.duration)}
              </span>
            </div>
            <button
              type="button"
              style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer', padding: '6px 12px', borderRadius: '8px', lineHeight: 1 }}
              onClick={() => setLightboxSceneIndex(null)}
              title="Đóng (Esc)"
            >
              ✕
            </button>
          </div>

          {/* Body: Image with Left / Right Navigation */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#05070e', flex: 1, minHeight: '360px', maxHeight: '60vh', overflow: 'hidden', padding: '14px' }}>
            <img
              src={stickSceneImageUrl(activeLightboxScene)}
              alt={`Phân đoạn ${activeLightboxScene.index}`}
              style={{ maxWidth: '100%', maxHeight: '56vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 8px 30px rgba(0,0,0,0.6)' }}
            />

            {/* Prev button */}
            <button
              type="button"
              disabled={activeLightboxIdx <= 0}
              onClick={() => activeLightboxIdx > 0 && setLightboxSceneIndex(availableFlowScenes[activeLightboxIdx - 1].index)}
              style={{
                position: 'absolute',
                left: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(15, 23, 42, 0.85)',
                color: activeLightboxIdx > 0 ? '#fff' : '#475569',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '50%',
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: activeLightboxIdx > 0 ? 'pointer' : 'not-allowed',
                fontSize: '22px',
                backdropFilter: 'blur(6px)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                opacity: activeLightboxIdx > 0 ? 1 : 0.4
              }}
              title="Phân đoạn trước (Phím ◀)"
            >
              ‹
            </button>

            {/* Next button */}
            <button
              type="button"
              disabled={activeLightboxIdx >= availableFlowScenes.length - 1}
              onClick={() => activeLightboxIdx < availableFlowScenes.length - 1 && setLightboxSceneIndex(availableFlowScenes[activeLightboxIdx + 1].index)}
              style={{
                position: 'absolute',
                right: '16px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(15, 23, 42, 0.85)',
                color: activeLightboxIdx < availableFlowScenes.length - 1 ? '#fff' : '#475569',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '50%',
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: activeLightboxIdx < availableFlowScenes.length - 1 ? 'pointer' : 'not-allowed',
                fontSize: '22px',
                backdropFilter: 'blur(6px)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                opacity: activeLightboxIdx < availableFlowScenes.length - 1 ? 1 : 0.4
              }}
              title="Phân đoạn tiếp theo (Phím ▶)"
            >
              ›
            </button>
          </div>

          {/* Footer subtitle */}
          <div style={{ padding: '14px 20px', background: '#0a0d18', borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8' }}>
                Lời thoại câu này ({formatDuration(activeLightboxScene.duration)}):
              </span>
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                Dùng phím mũi tên ◀ ▶ để chuyển phân đoạn · Phím Esc để đóng
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: '#f1f5f9', background: 'rgba(30, 41, 59, 0.4)', padding: '10px 14px', borderRadius: '8px', borderLeft: '3px solid #6366f1' }}>
              {activeLightboxScene.sectionText}
            </p>
          </div>
        </div>
      </div>
    )}
  </div>
}
