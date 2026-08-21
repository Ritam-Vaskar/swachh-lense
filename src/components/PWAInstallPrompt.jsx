import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * PWAInstallPrompt – shows a subtle install banner when the browser
 * triggers the beforeinstallprompt event (Android/Desktop Chrome etc.)
 * and a separate "update ready" toast when a new service worker is waiting.
 */
export default function PWAInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showInstall, setShowInstall] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Service-worker auto-update registration
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('[PWA] Service Worker registered:', r)
    },
    onRegisterError(error) {
      console.error('[PWA] SW registration error:', error)
    },
  })

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
      if (!dismissed) setShowInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [dismissed])

  async function handleInstall() {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setShowInstall(false)
    setInstallPrompt(null)
  }

  function handleDismissInstall() {
    setShowInstall(false)
    setDismissed(true)
  }

  return (
    <>
      {/* Install Banner */}
      {showInstall && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #0d4a2e 0%, #16a34a 100%)',
          color: '#fff', borderRadius: 16, padding: '14px 20px',
          display: 'flex', alignItems: 'center', gap: 14,
          boxShadow: '0 8px 32px rgba(22,163,74,0.4)',
          zIndex: 9999, maxWidth: 380, width: 'calc(100vw - 48px)',
          animation: 'slideUp 0.3s ease',
        }}>
          <img src="/icon-72x72.png" alt="SwachhLens" style={{ width: 40, height: 40, borderRadius: 10 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Install SwachhLens</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>Add to home screen for instant access</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleInstall}
              style={{
                background: '#fff', color: '#16a34a', border: 'none',
                borderRadius: 8, padding: '6px 14px', fontWeight: 700,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Install
            </button>
            <button
              onClick={handleDismissInstall}
              style={{
                background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none',
                borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Update Toast */}
      {needRefresh && (
        <div style={{
          position: 'fixed', top: 20, right: 20,
          background: '#1e293b', color: '#fff',
          borderRadius: 12, padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          zIndex: 9999, maxWidth: 320,
          border: '1px solid rgba(22,163,74,0.4)',
        }}>
          <span style={{ fontSize: 20 }}>🔄</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Update available</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Reload to get the latest version</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => updateServiceWorker(true)}
              style={{
                background: '#16a34a', color: '#fff', border: 'none',
                borderRadius: 6, padding: '5px 12px', fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reload
            </button>
            <button
              onClick={() => setNeedRefresh(false)}
              style={{
                background: 'transparent', color: '#94a3b8', border: 'none',
                fontSize: 16, cursor: 'pointer', padding: '0 4px',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(20px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </>
  )
}
