const MigrationResult = ({ outputFile, onDownload, onNewMigration }) => {
  return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-8">
      <div className="flex items-start gap-4">
        <div className="text-4xl">✓</div>
        <div className="flex-1">
          <h3 className="text-green-900 font-bold mb-4 text-xl">
            Migration Completed Successfully!
          </h3>
          {outputFile && (
            <div className="bg-slate-100 rounded-xl p-4 mb-6">
              <p className="text-slate-600 text-xs mb-2 font-semibold">Generated PostgreSQL dump:</p>
              <p className="text-slate-900 font-mono text-sm break-all">{outputFile}</p>
            </div>
          )}
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={onDownload}
              className="btn-primary"
            >
              ⬇️ Download Dump
            </button>
            <button
              onClick={onNewMigration}
              className="btn-secondary"
            >
              Migrate Another
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MigrationResult
