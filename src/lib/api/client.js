import { generateReferenceCode, generateTaskCode } from './constants.js'

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || 'http://localhost:3001'
const SESSION_KEY = 'swachhlens-session-v1'
const authListeners = new Set()
const channelListeners = new Set()

async function request(path, options = {}) {
	const response = await fetch(`${API_BASE}${path}`, {
		headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
		...options,
	})
	const data = await response.json().catch(() => ({}))
	if (!response.ok) throw new Error(data.error || 'Request failed')
	return data
}

function readSession() {
	try {
		return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
	} catch {
		return null
	}
}

function writeSession(session) {
	if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
	else localStorage.removeItem(SESSION_KEY)
}

function emitAuth(event, session) {
	authListeners.forEach((listener) => listener(event, session))
}

function emitChannel(change) {
	channelListeners.forEach((listener) => listener(change))
}

class QueryBuilder {
	constructor(table) {
		this.table = table
		this.mode = 'select'
		this.columns = '*'
		this.selectOptions = {}
		this.filters = []
		this.ordering = null
		this.singleMode = null
		this.payload = null
	}

	select(columns = '*', options = {}) {
		this.mode = this.mode === 'insert' || this.mode === 'update' || this.mode === 'delete' ? this.mode : 'select'
		this.columns = columns
		this.selectOptions = options
		return this
	}

	eq(field, value) {
		this.filters.push({ type: 'eq', field, value })
		return this
	}

	in(field, values) {
		this.filters.push({ type: 'in', field, values })
		return this
	}

	order(field, options = {}) {
		this.ordering = { field, ascending: options.ascending !== false }
		return this
	}

	insert(payload) {
		this.mode = 'insert'
		this.payload = Array.isArray(payload) ? payload : [payload]
		return this
	}

	update(payload) {
		this.mode = 'update'
		this.payload = payload
		return this
	}

	delete() {
		this.mode = 'delete'
		return this
	}

	maybeSingle() {
		this.singleMode = 'maybe'
		return this
	}

	single() {
		this.singleMode = 'single'
		return this
	}

	then(resolve, reject) {
		return this.execute().then(resolve, reject)
	}

	catch(reject) {
		return this.execute().catch(reject)
	}

	finally(handler) {
		return this.execute().finally(handler)
	}

	async execute() {
		try {
			const result = await request('/api/query', {
				method: 'POST',
				body: JSON.stringify({
					table: this.table,
					action: this.mode,
					columns: this.columns,
					filters: this.filters,
					order: this.ordering,
					payload: this.payload,
					selectOptions: this.selectOptions,
				}),
			})

			if (this.mode === 'insert' || this.mode === 'update' || this.mode === 'delete') {
				emitChannel({ eventType: this.mode === 'insert' ? 'INSERT' : this.mode === 'update' ? 'UPDATE' : 'DELETE', table: this.table })
				return { data: result.data, error: null }
			}

			if (this.selectOptions.head) return result

			let data = result.data || []
			if (this.singleMode === 'single') {
				if (data.length !== 1) throw new Error(data.length === 0 ? 'No rows returned' : 'Multiple rows returned')
				data = data[0]
			} else if (this.singleMode === 'maybe') {
				data = data[0] || null
			}
			return { data, error: null }
		} catch (error) {
			return { data: null, error: error instanceof Error ? error : new Error(String(error)) }
		}
	}
}

function makeAuthApi() {
	return {
		async getSession() {
			return { data: { session: readSession() } }
		},
		onAuthStateChange(callback) {
			authListeners.add(callback)
			return {
				data: {
					subscription: {
						unsubscribe() {
							authListeners.delete(callback)
						},
					},
				},
			}
		},
		async signUp({ email, password, role, full_name, phone, zone, latitude, longitude }) {
			const result = await request('/api/auth/signup', {
				method: 'POST',
				body: JSON.stringify({ email, password, role, full_name, phone, zone, latitude, longitude }),
			})
			return { data: result, error: null }
		},
		async ensureUser({ email, password, role, full_name, phone, zone, latitude, longitude, is_available }) {
			const result = await request('/api/auth/ensure', {
				method: 'POST',
				body: JSON.stringify({ email, password, role, full_name, phone, zone, latitude, longitude, is_available }),
			})
			return { data: result, error: null }
		},
		async signInWithPassword({ email, password }) {
			const result = await request('/api/auth/signin', {
				method: 'POST',
				body: JSON.stringify({ email, password }),
			})
			const session = { user: result.user }
			writeSession(session)
			emitAuth('SIGNED_IN', session)
			return { data: { user: result.user, session }, error: null }
		},
		async signOut() {
			writeSession(null)
			emitAuth('SIGNED_OUT', null)
			return { error: null }
		},
	}
}

function makeStorageApi() {
	return {
		from(bucket) {
			return {
				async upload(path, file, options = {}) {
					const dataUrl = await fileToDataUrl(file)
					const result = await request('/api/storage/upload', {
						method: 'POST',
						body: JSON.stringify({
							bucket: options.bucket || bucket,
							path,
							dataUrl,
							mimeType: file.type || 'application/octet-stream',
							size: file.size || 0,
							name: file.name || path.split('/').pop() || path,
						}),
					})
					return { data: { path: result.path }, error: null }
				},
				getPublicUrl(path) {
					return { data: { publicUrl: path } }
				},
			}
		},
	}
}

function fileToDataUrl(file) {
	if (!file) return Promise.resolve('')
	if (typeof file === 'string') return Promise.resolve(file)
	return new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onload = () => resolve(String(reader.result || ''))
		reader.onerror = () => reject(reader.error || new Error('Could not read file'))
		reader.readAsDataURL(file)
	})
}

export function createApiClient() {
	return {
		auth: makeAuthApi(),
		storage: makeStorageApi(),
		from(table) {
			return new QueryBuilder(table)
		},
		channel() {
			const callbacks = []
			return {
				on(_eventType, spec, callback) {
					callbacks.push({ spec, callback })
					channelListeners.add((change) => {
						if (spec?.table && spec.table !== change.table) return
						callback({ eventType: change.eventType, new: change.new, old: change.old })
					})
					return this
				},
				subscribe() {
					return this
				},
			}
		},
		removeChannel() {
			return null
		},
	}
}

export { generateReferenceCode, generateTaskCode }
