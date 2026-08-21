import { useEffect, useRef, useState } from 'react'
import { Icon } from './ui'

export default function CameraCaptureModal({ isOpen, onClose, onCapture, title = 'Take Photo' }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [cameraError, setCameraError] = useState(null)
  const [facingMode, setFacingMode] = useState('environment') // 'environment' (back) or 'user' (front)
  const [capturedImage, setCapturedImage] = useState(null)
  const [isStarting, setIsStarting] = useState(true)
  const [flashEffect, setFlashEffect] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      stopCamera()
      setCapturedImage(null)
      setCameraError(null)
      return
    }

    startCamera()

    return () => {
      stopCamera()
    }
  }, [isOpen, facingMode])

  async function startCamera() {
    setIsStarting(true)
    setCameraError(null)
    stopCamera()

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera is not supported on this browser or device.')
      }

      const constraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      }

      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch {
        // Fallback without exact facingMode constraint
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch (err) {
      console.error('Camera access error:', err)
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission was denied. Please allow camera access in your browser settings.')
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No camera device found.')
      } else {
        setCameraError(err.message || 'Unable to access camera.')
      }
    } finally {
      setIsStarting(false)
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  function toggleCamera() {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
  }

  function takeSnapshot() {
    if (!videoRef.current || !canvasRef.current) return

    setFlashEffect(true)
    setTimeout(() => setFlashEffect(false), 200)

    const video = videoRef.current
    const canvas = canvasRef.current

    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480

    const ctx = canvas.getContext('2d')
    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `waste_photo_${Date.now()}.jpg`, { type: 'image/jpeg' })
        const previewUrl = URL.createObjectURL(blob)
        setCapturedImage({ file, previewUrl })
        stopCamera()
      },
      'image/jpeg',
      0.92
    )
  }

  function handleRetake() {
    if (capturedImage?.previewUrl) {
      URL.revokeObjectURL(capturedImage.previewUrl)
    }
    setCapturedImage(null)
    startCamera()
  }

  function handleConfirm() {
    if (capturedImage?.file) {
      onCapture(capturedImage.file)
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" style={{ zIndex: 1200 }}>
      <div className="modal camera-modal" style={{ maxWidth: 560, width: '100%', overflow: 'hidden' }}>
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="Camera" size={18} />
            {title}
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: 0, background: '#000', position: 'relative', minHeight: 340, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {flashEffect && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: '#fff',
                zIndex: 10,
                opacity: 0.8,
                transition: 'opacity 0.2s ease',
              }}
            />
          )}

          {capturedImage ? (
            <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 340, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img
                src={capturedImage.previewUrl}
                alt="Captured waste"
                style={{ width: '100%', maxHeight: 420, objectFit: 'contain' }}
              />
              <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.65)', color: '#fff', padding: '4px 10px', borderRadius: 20, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="CheckCircle2" size={14} color="#4ade80" />
                <span>Photo captured</span>
              </div>
            </div>
          ) : cameraError ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#fff' }}>
              <Icon name="CameraOff" size={44} color="#f87171" style={{ marginBottom: 12 }} />
              <h4 style={{ margin: '0 0 8px 0', fontSize: 16, color: '#fca5a5' }}>Camera Unavailable</h4>
              <p style={{ fontSize: 13, color: '#cbd5e1', maxWidth: 360, margin: '0 auto 20px', lineHeight: 1.5 }}>
                {cameraError}
              </p>
              <button className="btn btn-primary btn-sm" onClick={startCamera}>
                <Icon name="RefreshCw" size={14} /> Retry Camera
              </button>
            </div>
          ) : (
            <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 340, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {isStarting && (
                <div style={{ position: 'absolute', zIndex: 5, color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                  <div className="spinner" style={{ borderTopColor: '#4ade80' }} />
                  <span style={{ fontSize: 13 }}>Initializing camera…</span>
                </div>
              )}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  maxHeight: 420,
                  objectFit: 'cover',
                  transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                }}
              />

              {/* Viewfinder crosshairs */}
              {!isStarting && (
                <div
                  style={{
                    position: 'absolute',
                    inset: '15%',
                    border: '2px dashed rgba(255,255,255,0.45)',
                    borderRadius: 16,
                    pointerEvents: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 8,
                  }}
                >
                  <span style={{ fontSize: 11, background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.85)', padding: '2px 8px', borderRadius: 4 }}>
                    Align waste inside box
                  </span>
                </div>
              )}

              {/* Switch camera button */}
              {!isStarting && (
                <button
                  type="button"
                  onClick={toggleCamera}
                  title="Switch camera"
                  style={{
                    position: 'absolute',
                    top: 14,
                    right: 14,
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.6)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Icon name="SwitchCamera" size={18} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px' }}>
          {capturedImage ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={handleRetake}>
                <Icon name="RefreshCw" size={14} /> Retake
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={handleConfirm}>
                  <Icon name="Check" size={15} /> Use this Photo
                </button>
              </div>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              {!cameraError && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={takeSnapshot}
                  disabled={isStarting}
                  style={{
                    padding: '8px 24px',
                    fontWeight: 600,
                    borderRadius: 99,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 14,
                  }}
                >
                  <Icon name="Camera" size={18} /> Capture Photo
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
