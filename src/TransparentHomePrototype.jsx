import React, { useEffect, useRef, useState } from 'react';

export default function App() {
  const videoRef = useRef(null);
  const [zoom, setZoom] = useState(2.8);
  const [offsetX, setOffsetX] = useState(-8);
  const [offsetY, setOffsetY] = useState(-14);
  const [showCalibrator, setShowCalibrator] = useState(true);
  const [status, setStatus] = useState('Starting camera...');

  useEffect(() => {
    let stream = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment', // Smooth fallback on iOS multi-lens setups
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        const video = videoRef.current;
        if (video) {
          // 1. Force WebKit properties directly on the DOM node
          video.muted = true;
          video.defaultMuted = true;
          video.playsInline = true;
          video.setAttribute('playsinline', '');
          video.setAttribute('webkit-playsinline', '');
          video.setAttribute('muted', '');

          // 2. Attach stream
          video.srcObject = stream;

          // 3. Force play once metadata loads
          video.onloadedmetadata = async () => {
            try {
              await video.play();
              setStatus('');
            } catch (playErr) {
              setStatus('Tap anywhere to start video feed');
            }
          };
        }
      } catch (err) {
        setStatus('Camera error: ' + err.message);
      }
    }

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Fallback tap handler in case iOS Low Power Mode blocks autoplay
  const handleScreenTap = () => {
    if (videoRef.current && videoRef.current.paused) {
      videoRef.current.play();
      setStatus('');
    }
    setShowCalibrator(!showCalibrator);
  };

  const apps = [
    { name: 'Phone', icon: '📞', url: 'tel://' },
    { name: 'Messages', icon: '💬', url: 'sms://' },
    { name: 'WhatsApp', icon: '🟢', url: 'whatsapp://' },
    { name: 'Spotify', icon: '🎵', url: 'spotify://' },
    { name: 'YouTube', icon: '▶️', url: 'youtube://' },
    { name: 'Instagram', icon: '📸', url: 'instagram://' },
    { name: 'Maps', icon: '🗺️', url: 'maps://' },
    { name: 'Settings', icon: '⚙️', url: 'App-Prefs://' },
  ];

  return (
    <div
      onClick={handleScreenTap}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        overflow: 'hidden',
        backgroundColor: '#000',
        userSelect: 'none',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      {/* Live Calibrated Camera Feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${zoom}) translate(${offsetX}%, ${offsetY}%)`,
          transformOrigin: 'center center',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />

      {/* Debug / Low Power Mode Prompt */}
      {status && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 30,
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: '16px',
            fontSize: '14px',
          }}
        >
          {status}
        </div>
      )}

      {/* UI Overlay Layer */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
          padding: '48px 24px 32px',
          boxSizing: 'border-box',
        }}
      >
        {/* App Icons Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '20px',
          }}
        >
          {apps.map((app) => (
            <a
              key={app.name}
              href={app.url}
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
                textDecoration: 'none',
              }}
            >
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '16px',
                  background: 'rgba(255, 255, 255, 0.18)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: '1px solid rgba(255, 255, 255, 0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '26px',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
                }}
              >
                {app.icon}
              </div>
              <span
                style={{
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 500,
                  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                }}
              >
                {app.name}
              </span>
            </a>
          ))}
        </div>

        {/* Optical Calibration Sliders */}
        {showCalibrator && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '16px',
              borderRadius: '24px',
              background: 'rgba(15, 15, 15, 0.65)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ fontWeight: 600, opacity: 0.85 }}>
              Optical Calibration (Tap empty space to hide)
            </div>
            <label>
              FOV Zoom ({zoom}x)
              <input
                type="range"
                min="1"
                max="5"
                step="0.05"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
            <label>
              Lens Offset X ({offsetX}%)
              <input
                type="range"
                min="-35"
                max="35"
                step="0.5"
                value={offsetX}
                onChange={(e) => setOffsetX(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
            <label>
              Lens Offset Y ({offsetY}%)
              <input
                type="range"
                min="-35"
                max="35"
                step="0.5"
                value={offsetY}
                onChange={(e) => setOffsetY(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}