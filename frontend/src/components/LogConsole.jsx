const LogConsole = ({ logs, containerRef, onScroll }) => {
  const getLogColor = (level) => {
    const colors = {
      'INFO': 'text-indigo-300',
      'WARN': 'text-amber-300',
      'ERROR': 'text-rose-300',
      'SUCCESS': 'text-emerald-300'
    }
    return colors[level] || 'text-slate-600'
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="bg-slate-950/95 border border-slate-800/70 rounded-2xl p-4 max-h-96 overflow-y-auto font-mono text-xs shadow-sm"
    >
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/70">
        <p className="text-indigo-200 text-xs font-semibold uppercase tracking-wide">Logs en direct</p>
        <p className="text-slate-500 text-[11px]">Flux temporaire (session uniquement)</p>
      </div>
      <div className="space-y-1.5">
        {logs.length === 0 ? (
          <div className="text-slate-400">En attente des logs...</div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="flex gap-3">
              <span className="text-slate-500 flex-shrink-0 w-16">{log.timestamp}</span>
              <span className={`flex-shrink-0 w-14 font-bold ${getLogColor(log.level)}`}>
                [{log.level}]
              </span>
              <span className="text-slate-200 flex-1 break-words">
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default LogConsole
