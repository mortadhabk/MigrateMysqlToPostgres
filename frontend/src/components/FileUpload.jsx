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
    <div className="bg-white border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50 rounded-2xl p-12 text-center transition-all duration-300 cursor-pointer shadow-sm"
      onDragOver={(e) => {
        e.preventDefault()
        e.currentTarget.classList.add('border-blue-500', 'bg-blue-50')
      }}
      onDragLeave={(e) => {
        e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
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
        <div className="text-5xl mb-4">📋</div>
        <p className="text-slate-900 font-bold text-lg mb-2">Drop your MySQL dump here</p>
        <p className="text-slate-500 text-sm">or click to browse your files</p>
        <p className="text-slate-400 text-xs mt-3">Supports .sql files • Max 1 GB</p>
      </label>
    </div>
  )
}

export default FileUpload
