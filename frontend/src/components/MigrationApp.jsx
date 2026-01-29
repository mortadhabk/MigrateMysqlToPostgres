import { useState, useRef, useEffect } from 'react'
import FileUpload from './FileUpload'
import LogConsole from './LogConsole'
import MigrationResult from './MigrationResult'
import { API_BASE_URL } from '../utils/config'

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
        throw new Error('Failed to start migration')
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
          let formattedMessage = data.message
          
          // Format based on level
          if (data.level === 'INFO') {
            formattedMessage = `▶ ${data.message}`
          } else if (data.level === 'WARN') {
            formattedMessage = `⚠ ${data.message}`
          } else if (data.level === 'ERROR') {
            formattedMessage = `✗ ${data.message}`
          }
          
          setLogs(prev => [
            ...prev,
            { timestamp, level: data.level, message: formattedMessage }
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
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-block mb-4">
            <div className="text-5xl">⚡</div>
          </div>
          <h1 className="text-5xl font-bold text-slate-900 mb-3">
            MySQL to PostgreSQL
          </h1>
          <p className="text-slate-400">
            Migrate your database with a single click
          </p>
        </div>

        {/* Main content */}
        <div className="space-y-6">
          {/* Step 1: File Upload */}
          {status === 'idle' && (
            <FileUpload onFileSelect={handleFileUpload} />
          )}

          {/* Step 2: Ready to migrate */}
          {status === 'ready' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 space-y-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-500 text-sm mb-2">File selected</p>
                  <p className="text-slate-900 font-bold text-lg">{fileName}</p>
                  <p className="text-slate-400 text-sm mt-1">{formatBytes(fileSize)}</p>
                </div>
                <div className="text-3xl">✓</div>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleStartMigration}
                  className="btn-primary flex-1"
                >
                  Launch Migration
                </button>
                <button
                  onClick={handleReset}
                  className="btn-secondary"
                >
                  Change File
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Migration in progress */}
          {(status === 'running') && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-slate-700 text-sm font-semibold">Migration in Progress</p>
                  <span className="text-blue-600 font-mono text-sm font-bold">{progress}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-blue-600 to-blue-500 h-3 rounded-full transition-all duration-500"
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
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
                <div className="flex items-start gap-4">
                  <div className="text-3xl">✕</div>
                  <div className="flex-1">
                    <h3 className="text-red-900 font-bold mb-2">Migration Failed</h3>
                    <p className="text-red-700 text-sm mb-4">{error}</p>
                    <button
                      onClick={handleReset}
                      className="btn-primary"
                    >
                      Try Again
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-16 text-slate-400 text-xs">
          <p>Built with React, Vite, Tailwind CSS • Modern Database Migration Tool</p>
        </div>
      </div>
    </div>
  )
}

export default MigrationApp
