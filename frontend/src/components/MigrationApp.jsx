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
  const logContainerRef = useRef(null)
  const shouldAutoScrollRef = useRef(true)

  const migrationSteps = [
    { id: 'connect', label: 'Connexion en cours…', threshold: 0 },
    { id: 'schema', label: 'Analyse du schéma…', threshold: 20 },
    { id: 'migrate', label: 'Migration…', threshold: 45 },
    { id: 'validate', label: 'Validation…', threshold: 85 },
    { id: 'done', label: 'Terminé', threshold: 100 }
  ]

  const activeStepIndex = (() => {
    if (status === 'completed') return migrationSteps.length - 1
    if (status !== 'running') return -1
    return migrationSteps.reduce((acc, step, index) => (
      progress >= step.threshold ? index : acc
    ), 0)
  })()

  const currentStepLabel = activeStepIndex >= 0
    ? migrationSteps[activeStepIndex].label
    : 'Préparation…'

  const handleLogScroll = () => {
    const container = logContainerRef.current
    if (!container) return
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    shouldAutoScrollRef.current = distanceToBottom < 48
  }

  // Auto-scroll to latest log only when user stays at the bottom
  useEffect(() => {
    const container = logContainerRef.current
    if (!container || !shouldAutoScrollRef.current) return
    container.scrollTop = container.scrollHeight
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
        throw new Error(err.error || 'Échec du téléversement')
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
    shouldAutoScrollRef.current = true

    try {
      const response = await fetch(`${API_BASE_URL}/migrate/${migrationId}`, {
        method: 'POST'
      })

      if (!response.ok) {
        const msg = await readErrorMessage(response)
        throw new Error(msg)
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
            setError(data.data.error || 'Échec de la migration')
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
      setError('Connexion perdue')
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
      if (!response.ok) throw new Error('Téléchargement impossible')

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
      setError(`Téléchargement impossible : ${err.message}`)
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
        <div className="text-center space-y-4 fade-up">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            Migration guidée
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold text-slate-900">
            Migration MySQL → PostgreSQL
          </h1>
          <p className="text-slate-500 max-w-2xl mx-auto">
            Importez un dump MySQL, lancez la migration, puis téléchargez un dump PostgreSQL prêt à l’emploi.
          </p>
        </div>

        <div className="bg-indigo-50 border border-indigo-100 rounded-3xl p-6 shadow-sm fade-up">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-indigo-900">Sécurité & confidentialité</p>
              <p className="text-xs uppercase tracking-wide text-indigo-400 mt-1">Session temporaire</p>
            </div>
            <div className="text-xs text-indigo-700/80 md:text-right">
              Traitement éphémère, suppression automatique des fichiers temporaires.
            </div>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-indigo-900/90">
            <li>Nous ne sauvegardons ni la base source ni la base cible.</li>
            <li>Aucune donnée n’est conservée après la migration.</li>
            <li>Les identifiants sont utilisés uniquement pour exécuter la migration puis sont supprimés de la session.</li>
          </ul>
        </div>

        {/* Main content */}
        <div className="space-y-6">
          {/* Step 1: File Upload */}
          {status === 'idle' && (
            <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm fade-up">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-6">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Étape 1</p>
                  <h2 className="text-2xl font-semibold text-slate-900 mt-2">Importer le dump SQL</h2>
                  <p className="text-slate-500 text-sm mt-2">
                    Fournissez un fichier MySQL .sql pour démarrer la migration.
                  </p>
                </div>
                <div className="md:text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Format accepté</p>
                  <p className="text-sm text-slate-600 mt-1">.sql • UTF-8 recommandé</p>
                </div>
              </div>
              <FileUpload onFileSelect={handleFileUpload} />
            </div>
          )}

          {status === 'uploading' && (
            <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm fade-up">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-900">Téléversement en cours…</p>
                  <p className="text-slate-500 text-sm">
                    Le fichier est chargé temporairement pour préparer la session de migration.
                  </p>
                </div>
                <div className="h-10 w-10 rounded-full border border-indigo-200 flex items-center justify-center bg-indigo-50">
                  <span className="h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Ready to migrate */}
          {status === 'ready' && (
            <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm fade-up">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div className="space-y-2">
                  <p className="text-slate-500 text-sm">Fichier prêt</p>
                  <p className="text-slate-900 font-semibold text-lg">{fileName}</p>
                  <p className="text-slate-400 text-sm">{formatBytes(fileSize)}</p>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-600">
                  Prochaine étape : démarrer la migration et suivre les logs en temps réel.
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-6">
                <button
                  onClick={handleStartMigration}
                  className="btn-primary flex-1"
                >
                  Démarrer la migration
                </button>
                <button
                  onClick={handleReset}
                  className="btn-secondary"
                >
                  Remplacer le fichier
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Migration in progress */}
          {(status === 'running') && (
            <div className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm fade-up">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                  <div>
                    <p className="text-slate-500 text-sm">Étape 2</p>
                    <p className="text-slate-900 text-lg font-semibold">Migration en cours</p>
                    <p className="text-slate-500 text-sm mt-1">
                      Processus éphémère : aucun stockage permanent, fichiers temporaires supprimés en fin de session.
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Progression</p>
                    <p className="text-indigo-600 font-mono text-sm font-bold">{progress}%</p>
                  </div>
                </div>
                <div className="w-full bg-slate-200/70 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-indigo-500 via-blue-500 to-teal-400 h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-3 text-sm text-slate-500">
                  Étape actuelle : <span className="font-semibold text-slate-700">{currentStepLabel}</span>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {migrationSteps.map((step, index) => {
                    const isComplete = activeStepIndex > -1 && index < activeStepIndex
                    const isActive = activeStepIndex > -1 && index === activeStepIndex
                    const baseStyle = 'border-slate-200 text-slate-500'
                    const activeStyle = 'border-indigo-200 bg-indigo-50 text-indigo-900'
                    const completeStyle = 'border-emerald-200 bg-emerald-50 text-emerald-800'

                    return (
                      <div
                        key={step.id}
                        className={`flex items-center gap-3 rounded-xl border p-3 text-xs transition-all duration-300 ${
                          isActive ? activeStyle : isComplete ? completeStyle : baseStyle
                        }`}
                      >
                        <div
                          className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                            isComplete ? 'bg-emerald-500 text-white' : isActive ? 'bg-indigo-500 text-white' : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold">{step.label}</p>
                          {isActive && <p className="text-[11px] text-indigo-600 mt-0.5">En cours</p>}
                          {isComplete && <p className="text-[11px] text-emerald-600 mt-0.5">OK</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <LogConsole
                logs={logs}
                containerRef={logContainerRef}
                onScroll={handleLogScroll}
              />
            </div>
          )}

          {/* Step 4: Migration completed */}
          {status === 'completed' && (
            <div className="space-y-4">
              <LogConsole
                logs={logs}
                containerRef={logContainerRef}
                onScroll={handleLogScroll}
              />
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
              {logs.length > 0 && (
                <LogConsole
                  logs={logs}
                  containerRef={logContainerRef}
                  onScroll={handleLogScroll}
                />
              )}
              <div className="bg-rose-50/80 border border-rose-200/80 rounded-3xl p-6 shadow-sm fade-up">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className="h-10 w-10 rounded-full bg-white border border-rose-200 flex items-center justify-center shadow-sm">
                    <div className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-rose-900 font-semibold mb-2">Migration interrompue</h3>
                    <p className="text-rose-800/90 text-sm mb-4">{error}</p>
                    <button
                      onClick={handleReset}
                      className="btn-primary"
                    >
                      Réessayer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm fade-up">
            <h3 className="text-lg font-semibold text-slate-900">Mini-FAQ sécurité & confidentialité</h3>
            <div className="mt-4 space-y-4 text-sm text-slate-600">
              <div>
                <p className="font-semibold text-slate-900">Où transitent mes données ?</p>
                <p>En mémoire quand possible et via des fichiers temporaires supprimés automatiquement.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Les identifiants sont-ils conservés ?</p>
                <p>Non. Ils servent uniquement à exécuter la migration et ne sont jamais stockés après la session.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Le dump PostgreSQL est-il gardé ?</p>
                <p>Uniquement jusqu’au téléchargement ou expiration de la session (30 minutes max).</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Que contiennent les logs ?</p>
                <p>Des statuts techniques sans données sensibles ni credentials.</p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">Que se passe-t-il en cas d’échec ?</p>
                <p>Les fichiers temporaires sont supprimés automatiquement.</p>
              </div>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm fade-up">
            <h3 className="text-lg font-semibold text-slate-900">Engagements de transparence</h3>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
                <span>Traitement guidé, clair et progressif pour éviter toute ambiguïté.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
                <span>Suppression automatique des fichiers temporaires après la migration.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
                <span>Pas de stockage des bases, ni d’extraits de données persistants.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
                <span>Logs minimaux et pensés pour le débogage sans exposer d’informations sensibles.</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="text-center text-slate-400 text-xs">
          <p>React · Vite · Tailwind CSS • Console de migration éphémère</p>
        </div>
      </div>
    </div>
  )
}

export default MigrationApp
