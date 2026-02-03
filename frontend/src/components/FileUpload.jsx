const FileUpload = ({ onFileSelect }) => {
  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.type !== 'application/x-sql' && !file.name.endsWith('.sql')) {
        alert('Please select a .sql file')
        return
      }
      onFileSelect(file)
    }
  }

  return (
    <div className="group bg-white border-2 border-dashed border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/50 rounded-2xl p-10 text-center transition-all duration-300 cursor-pointer shadow-sm"
      onDragOver={(e) => {
        e.preventDefault()
        e.currentTarget.classList.add('border-indigo-400', 'bg-indigo-50/50')
      }}
      onDragLeave={(e) => {
        e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/50')
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/50')
        const file = e.dataTransfer.files?.[0]
        if (file && (file.type === 'application/x-sql' || file.name.endsWith('.sql'))) {
          handleFileChange({ target: { files: e.dataTransfer.files } })
        }
      }}
    >
      <input
        type="file"
        accept=".sql"
        onChange={handleFileChange}
        className="input-file"
        id="file-upload"
        style={{ display: 'none' }}
      />
      <label htmlFor="file-upload" className="cursor-pointer block">
        <p className="text-slate-900 font-semibold text-xl mb-2">Upload MySQL dump</p>
        <p className="text-slate-500 text-sm mb-6">Drag and drop your .sql file here, or browse to select it.</p>
        <span className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-indigo-700 bg-indigo-50 rounded-lg group-hover:bg-white group-hover:text-indigo-800 group-hover:shadow-sm transition">
          Choose file
        </span>
        <p className="text-slate-400 text-xs mt-4">Supports .sql files • Up to 1 GB</p>
      </label>
    </div>
  )
}

export default FileUpload
