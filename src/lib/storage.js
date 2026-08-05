const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

export async function uploadEvidence(file, prefix = 'report') {
	const ext = file.name?.split('.').pop() || 'jpg'
	const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
	const dataUrl = await fileToDataUrl(file)
	const response = await fetch(`${API_BASE}/api/storage/upload`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			bucket: 'swachhlens-evidence',
			path,
			dataUrl,
			mimeType: file.type || `image/${ext}`,
			size: file.size || 0,
			name: file.name || path.split('/').pop() || path,
		}),
	})
	const payload = await response.json().catch(() => ({}))
	if (!response.ok) return { error: new Error(payload.error || 'Upload failed') }
	return { url: payload.data?.publicUrl || dataUrl, path }
}

function fileToDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result || ''))
		reader.onerror = () => reject(reader.error || new Error('Could not read file'))
		reader.readAsDataURL(file)
	})
}
