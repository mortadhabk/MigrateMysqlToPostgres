const LogConsole = ({ logs }) => {
  const getLogColor = (level) => {
    const colors = {
      'INFO': 'text-blue-600',
      'WARN': 'text-yellow-600',
      'ERROR': 'text-red-600',
      'SUCCESS': 'text-green-600'
    }
    return colors[level] || 'text-slate-600'
  }

  return (
    <div className="bg-slate-950 border border-slate-200/60 rounded-2xl p-4 max-h-96 overflow-y-auto font-mono text-xs shadow-sm">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/60">
        <p className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Live logs</p>
        <p className="text-slate-500 text-[11px]">Streamed from migration service</p>
      </div>
      <div className="space-y-1.5">
        {logs.length === 0 ? (
          <div className="text-slate-500">Waiting for logs...</div>
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
