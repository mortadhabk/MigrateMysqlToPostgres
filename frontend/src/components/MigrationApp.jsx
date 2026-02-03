import { useState, useRef, useEffect } from 'react'
import FileUpload from './FileUpload'
import LogConsole from './LogConsole'
import MigrationResult from './MigrationResult'
import { API_BASE_URL, readErrorMessage } from '../utils/config'

const MigrationApp = () => {
  const [migrationId, setMigrationId] = useState(null)
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [status, setStatus] = useState('idle') // idle, uploading, ready, running, completed, failed
  const [logs, setLogs] = useState([])
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [outputFile, setOutputFile] = useState(null)
  const logsEndRef = useRef(null)

  // Auto-scroll to latest log
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  /**
   * Handle file upload
   */
  const handleFileUpload = async (file) => {
    if (!file) return

    setStatus('uploading')
    setError('')
    setLogs([])
    setMigrationId(null)
    setFileName(file.name)
    setFileSize(file.size)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Upload failed')
      }

      const data = await response.json()
      setMigrationId(data.migrationId)
      setStatus('ready')
    } catch (err) {
      setStatus('failed')
      setError(err.message)
    }
  }

  /**
   * Start migration
   */
  const handleStartMigration = async () => {
    if (!migrationId) return

    setStatus('running')
    setError('')
    setLogs([])
    setProgress(0)

    try {
      const response = await fetch(`${API_BASE_URL}/migrate/${migrationId}`, {
        method: 'POST'
      })

    if (!response.ok) {
      const msg = await readErrorMessage(response);
      throw new Error(msg);
    }

      // Stream logs via SSE
      streamLogs()
    } catch (err) {
      setStatus('failed')
      setError(err.message)
    }
  }

  /**
   * Stream logs from backend
   */
  const streamLogs = () => {
    const eventSource = new EventSource(`${API_BASE_URL}/migrate/${migrationId}/logs`)

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        if (data.type === 'log') {
          // Add log from server
          const timestamp = new Date(data.timestamp).toLocaleTimeString()
          setLogs(prev => [
            ...prev,
            { timestamp, level: data.level, message: data.message }
          ])
        } else if (data.type === 'status') {
          const migrationStatus = data.data.status
          setProgress(data.data.progress)

          if (migrationStatus === 'completed') {
            setStatus('completed')
            setOutputFile(data.data.outputFile)
            eventSource.close()
            // Small delay to ensure UI updates
            setTimeout(() => {}, 100)
          } else if (migrationStatus === 'failed') {
            setStatus('failed')
            setError(data.data.error || 'Migration failed')
            eventSource.close()
          }
        }
      } catch (err) {
        console.error('Error parsing log:', err)
      }
    }

    eventSource.onerror = (error) => {
      console.error('SSE Error:', error)
      setStatus('failed')
      setError('Connection lost')
      eventSource.close()
    }
  }

  /**
   * Format bytes
   */
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  /**
   * Handle download
   */
  const handleDownload = async () => {
    if (!migrationId || !outputFile) return

    try {
      const response = await fetch(`${API_BASE_URL}/download/${migrationId}`)
      if (!response.ok) throw new Error('Download failed')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = outputFile
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError(`Download failed: ${err.message}`)
    }
  }

  /**
   * Reset application
   */
  const handleReset = () => {
    setMigrationId(null)
    setFileName('')
    setFileSize(0)
    setStatus('idle')
    setLogs([])
    setError('')
    setProgress(0)
    setOutputFile(null)
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Migration toolkit
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold text-slate-900">
            MySQL to PostgreSQL Migration
          </h1>
          <p className="text-slate-500 max-w-2xl mx-auto">
            Upload a MySQL dump, run the migration, and download a PostgreSQL-ready file with clear, real-time feedback.
          </p>
        </div>

        {/* Main content */}
        <div className="space-y-6">
          {/* Step 1: File Upload */}
          {status === 'idle' && (
            <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-6">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Step 1</p>
                  <h2 className="text-2xl font-semibold text-slate-900 mt-2">Upload SQL dump</h2>
                  <p className="text-slate-500 text-sm mt-2">
                    Provide a MySQL .sql file to start the migration workflow.
                  </p>
                </div>
                <div className="md:text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Accepted format</p>
                  <p className="text-sm text-slate-600 mt-1">.sql • UTF-8 preferred</p>
                </div>
              </div>
              <FileUpload onFileSelect={handleFileUpload} />
            </div>
          )}

          {/* Step 2: Ready to migrate */}
          {status === 'ready' && (
            <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div className="space-y-2">
                  <p className="text-slate-500 text-sm">File ready</p>
                  <p className="text-slate-900 font-semibold text-lg">{fileName}</p>
                  <p className="text-slate-400 text-sm">{formatBytes(fileSize)}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-600">
                  Next step: start the migration to stream logs in real time.
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-6">
                <button
                  onClick={handleStartMigration}
                  className="btn-primary flex-1"
                >
                  Start migration
                </button>
                <button
                  onClick={handleReset}
                  className="btn-secondary"
                >
                  Replace file
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Migration in progress */}
          {(status === 'running') && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                  <div>
                    <p className="text-slate-500 text-sm">Step 2</p>
                    <p className="text-slate-900 text-lg font-semibold">Migration in progress</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Progress</p>
                    <p className="text-blue-600 font-mono text-sm font-bold">{progress}%</p>
                  </div>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
              <LogConsole logs={logs} />
              <div ref={logsEndRef} />
            </div>
          )}

          {/* Step 4: Migration completed */}
          {status === 'completed' && (
            <div className="space-y-4">
              <LogConsole logs={logs} />
              <MigrationResult
                outputFile={outputFile}
                onDownload={handleDownload}
                onNewMigration={handleReset}
              />
            </div>
          )}

          {/* Step 5: Migration failed */}
          {status === 'failed' && (
            <div className="space-y-4">
              {logs.length > 0 && <LogConsole logs={logs} />}
              <div className="bg-rose-50/60 border border-rose-200 rounded-3xl p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="h-10 w-10 rounded-full bg-white border border-rose-200 flex items-center justify-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-rose-900 font-semibold mb-2">Migration failed</h3>
                    <p className="text-rose-800/90 text-sm mb-4">{error}</p>
                    <button
                      onClick={handleReset}
                      className="btn-primary"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-slate-400 text-xs">
          <p>React · Vite · Tailwind CSS • Internal migration console</p>
        </div>
      </div>
    </div>
  )
}

export default MigrationApp
