try {
  const response = await fetch('http://127.0.0.1:8000/health', { signal: AbortSignal.timeout(5000) })
  const body = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body}`)
  console.log('CapCut bridge OK:', body)
} catch (error) {
  console.error('CapCut bridge chưa chạy hoặc không phản hồi:', error instanceof Error ? error.message : error)
  process.exit(1)
}
