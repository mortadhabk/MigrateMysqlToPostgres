const MigrationResult = ({ outputFile, onDownload, onNewMigration }) => {
  return (
    <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-8 shadow-sm">
      <div className="flex items-start gap-6">
        <div className="h-12 w-12 rounded-full bg-white border border-emerald-200 flex items-center justify-center">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </div>
        <div className="flex-1 space-y-4">
          <div>
            <h3 className="text-emerald-900 font-semibold text-xl">
              Migration completed
            </h3>
            <p className="text-emerald-800/80 text-sm">
              Your PostgreSQL dump is ready for download.
            </p>
          </div>
          {outputFile && (
            <div className="bg-white rounded-xl p-4 border border-emerald-100">
              <p className="text-slate-500 text-xs mb-2 font-semibold uppercase tracking-wide">Output file</p>
              <p className="text-slate-900 font-mono text-sm break-all">{outputFile}</p>
            </div>
          )}
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={onDownload}
              className="btn-primary"
            >
              Download dump
            </button>
            <button
              onClick={onNewMigration}
              className="btn-secondary"
            >
              Start new migration
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MigrationResult
