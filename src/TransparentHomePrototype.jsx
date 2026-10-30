import React, { useEffect, useRef, useState } from 'react';

export default function App() {
  const videoRef = useRef(null);
  const sheenRef = useRef(null);
  const trackingCanvasRef = useRef(null);

  // Optical Calibration State
  const [baseZoom, setBaseZoom] = useState(2.85);
  const [baseOffsetX, setBaseOffsetX] = useState(-9.5);
  const [baseOffsetY, setBaseOffsetY] = useState(-14.5);
  const [tiltSensitivity, setTiltSensitivity] = useState(0.55);
  const [glassRefraction, setGlassRefraction] = useState(0.8);

  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [opticalLock, setOpticalLock] = useState(true);
  const [showCalibrator, setShowCalibrator] = useState(false);
  const [status, setStatus] = useState('Initializing Glass Optics...');

  // 60fps Physics & Optical State Refs
  const current = useRef({ x: -9.5, y: -14.5, zoom: 2.85, rotX: 0, rotY: 0, sheenX: 50, sheenY: 50 });
  const target = useRef({ x: -9.5, y: -14.5, zoom: 2.85, rotX: 0, rotY: 0, sheenX: 50, sheenY: 50 });
  const baselineAngles = useRef({ beta: null, gamma: null });
  const opticalAnchor = useRef(null);

  const configRef = useRef({ baseZoom, baseOffsetX, baseOffsetY, tiltSensitivity, opticalLock });
  useEffect(() => {
    configRef.current = { baseZoom, baseOffsetX, baseOffsetY, tiltSensitivity, opticalLock };
  }, [baseZoom, baseOffsetX, baseOffsetY, tiltSensitivity, opticalLock]);

  // 1. Start High-Framerate Rear Camera Stream
  useEffect(() => {
    let stream = null;
    async function initCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 },
          },
          audio: false,
        });

        const video = videoRef.current;
        if (video) {
          video.muted = true;
          video.defaultMuted = true;
          video.playsInline = true;
          video.setAttribute('playsinline', '');
          video.setAttribute('webkit-playsinline', '');
          video.srcObject = stream;

          video.onloadedmetadata = async () => {
            try {
              await video.play();
              setStatus('');
            } catch {
              setStatus('Tap glass to activate optical feed');
            }
          };
        }
      } catch (err) {
        setStatus('Camera error: ' + err.message);
      }
    }
    initCamera();
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // 2. Real-Time Optical Contrast Centroid Tracker + 60fps Render Loop
  useEffect(() => {
    let rafId;
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    trackingCanvasRef.current = { canvas, ctx };

    const lerp = (a, b, t) => a + (b - a) * t;

    const renderLoop = () => {
      const { baseZoom, baseOffsetX, baseOffsetY, opticalLock } = configRef.current;
      const video = videoRef.current;

      // Optical Feature Tracking (Tracks high-contrast desk edges in real time)
      if (video && video.readyState >= 2 && opticalLock && trackingEnabled) {
        ctx.drawImage(video, 0, 0, 48, 48);
        const frame = ctx.getImageData(0, 0, 48, 48).data;

        let sumX = 0, sumY = 0, totalWeight = 0, edgeSpread = 0;

        for (let y = 2; y < 46; y += 2) {
          for (let x = 2; x < 46; x += 2) {
            const i = (y * 48 + x) * 4;
            const lum = frame[i] * 0.299 + frame[i + 1] * 0.587 + frame[i + 2] * 0.114;
            const lumRight = frame[i + 4] * 0.299 + frame[i + 5] * 0.587 + frame[i + 6] * 0.114;
            const lumDown = frame[i + 192] * 0.299 + frame[i + 193] * 0.587 + frame[i + 194] * 0.114;

            // Detect sharp physical edges (keyboard keys, desk mat, book edges)
            const gradient = Math.abs(lum - lumRight) + Math.abs(lum - lumDown);
            if (gradient > 45) {
              sumX += x * gradient;
              sumY += y * gradient;
              totalWeight += gradient;
            }
          }
        }

        if (totalWeight > 2000) {
          const centerX = sumX / totalWeight;
          const centerY = sumY / totalWeight;

          // Estimate feature spread (scale/distance proxy)
          for (let y = 4; y < 44; y += 4) {
            for (let x = 4; x < 44; x += 4) {
              const i = (y * 48 + x) * 4;
              const grad = Math.abs(frame[i] - frame[i + 4]);
              if (grad > 45) {
                edgeSpread += Math.hypot(x - centerX, y - centerY) * grad;
              }
            }
          }
          const avgSpread = edgeSpread / totalWeight;

          if (!opticalAnchor.current) {
            opticalAnchor.current = { x: centerX, y: centerY, spread: avgSpread };
          } else {
            const dx = (centerX - opticalAnchor.current.x) * 0.38;
            const dy = (centerY - opticalAnchor.current.y) * 0.38;
            const scaleRatio = opticalAnchor.current.spread / Math.max(4, avgSpread);
            const clampedRatio = Math.min(1.25, Math.max(0.8, scaleRatio));

            // Blend optical flow with gyro target
            target.current.x = lerp(target.current.x, baseOffsetX - dx, 0.25);
            target.current.y = lerp(target.current.y, baseOffsetY - dy, 0.25);
            target.current.zoom = lerp(target.current.zoom, baseZoom * clampedRatio, 0.15);
          }
        }
      } else if (!trackingEnabled) {
        target.current.x = baseOffsetX;
        target.current.y = baseOffsetY;
        target.current.zoom = baseZoom;
        target.current.rotX = 0;
        target.current.rotY = 0;
      }

      // Smooth 60fps Damping
      current.current.x = lerp(current.current.x, target.current.x, 0.2);
      current.current.y = lerp(current.current.y, target.current.y, 0.2);
      current.current.zoom = lerp(current.current.zoom, target.current.zoom, 0.15);
      current.current.rotX = lerp(current.current.rotX, target.current.rotX, 0.18);
      current.current.rotY = lerp(current.current.rotY, target.current.rotY, 0.18);
      current.current.sheenX = lerp(current.current.sheenX, target.current.sheenX, 0.15);
      current.current.sheenY = lerp(current.current.sheenY, target.current.sheenY, 0.15);

      if (video) {
        const { x, y, zoom, rotX, rotY } = current.current;
        video.style.transform = `
          perspective(900px)
          rotateX(${rotX.toFixed(2)}deg)
          rotateY(${rotY.toFixed(2)}deg)
          scale(${zoom.toFixed(4)})
          translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, 0)
        `;
      }

      if (sheenRef.current) {
        const { sheenX, sheenY } = current.current;
        sheenRef.current.style.background = `
          radial-gradient(
            circle at ${sheenX.toFixed(1)}% ${sheenY.toFixed(1)}%,
            rgba(255, 255, 255, ${0.22 * glassRefraction}) 0%,
            rgba(255, 255, 255, ${0.06 * glassRefraction}) 35%,
            transparent 70%
          )
        `;
      }

      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [trackingEnabled, glassRefraction]);

  // 3. Activate iOS Sensors & Lock Zero Point
  const engageGlassLock = async (e) => {
    e.stopPropagation();
    try {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') {
          setStatus('Gyroscope permission required for glass refraction');
          return;
        }
      }
      baselineAngles.current = { beta: null, gamma: null };
      opticalAnchor.current = null;
      setTrackingEnabled(true);
    } catch (err) {
      setStatus('Sensor error: ' + err.message);
    }
  };

  // 4. Gyroscope Orientation Listener
  useEffect(() => {
    if (!trackingEnabled) return;

    const onOrientation = (e) => {
      const { beta, gamma } = e;
      if (beta === null || gamma === null) return;

      if (baselineAngles.current.beta === null) {
        baselineAngles.current = { beta, gamma };
      }

      const dBeta = beta - baselineAngles.current.beta;
      const dGamma = gamma - baselineAngles.current.gamma;
      const { baseOffsetX, baseOffsetY, tiltSensitivity } = configRef.current;

      // Shift X/Y and 3D plane tilt to match glass refraction physics
      target.current.x = baseOffsetX - dGamma * tiltSensitivity;
      target.current.y = baseOffsetY - dBeta * tiltSensitivity;
      target.current.rotX = Math.max(-12, Math.min(12, dBeta * 0.22));
      target.current.rotY = Math.max(-12, Math.min(12, -dGamma * 0.22));

      // Move overhead light reflection across the glass slab
      target.current.sheenX = Math.max(0, Math.min(100, 50 + dGamma * 2.2));
      target.current.sheenY = Math.max(0, Math.min(100, 35 + dBeta * 2.2));
    };

    window.addEventListener('deviceorientation', onOrientation, true);
    return () => window.removeEventListener('deviceorientation', onOrientation, true);
  }, [trackingEnabled]);

  const recenterGlass = (e) => {
    e.stopPropagation();
    baselineAngles.current = { beta: null, gamma: null };
    opticalAnchor.current = null;
  };

  const apps = [
    { name: 'Phone', icon: '📞', url: 'tel://' },
    { name: 'Messages', icon: '💬', url: 'sms://' },
    { name: 'Safari', icon: '🧭', url: 'https://google.com' },
    { name: 'Spotify', icon: '🎵', url: 'spotify://' },
    { name: 'YouTube', icon: '▶️', url: 'youtube://' },
    { name: 'Instagram', icon: '📸', url: 'instagram://' },
    { name: 'Maps', icon: '🗺️', url: 'maps://' },
    { name: 'Settings', icon: '⚙️', url: 'App-Prefs://' },
  ];

  return (
    <div
      onClick={() => {
        if (videoRef.current && videoRef.current.paused) {
          videoRef.current.play();
          setStatus('');
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        overflow: 'hidden',
        backgroundColor: '#000',
        userSelect: 'none',
        fontFamily: "'Sora', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* 1. Optical Camera Pass-Through Layer */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transformOrigin: 'center center',
          willChange: 'transform',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />

      {/* 2. Physical Glass Slab Edge Bevel & Chromatic Rim Layer */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          pointerEvents: 'none',
          borderRadius: '44px',
          boxShadow: `
            inset 0 0 0 1.5px rgba(255, 255, 255, ${0.42 * glassRefraction}),
            inset 0 0 18px rgba(255, 255, 255, ${0.18 * glassRefraction}),
            inset 4px 0 12px rgba(56, 189, 248, ${0.12 * glassRefraction}),
            inset -4px 0 12px rgba(244, 63, 94, ${0.12 * glassRefraction})
          `,
        }}
      />

      {/* 3. Dynamic Gyro Specular Light Reflection Layer */}
      <div
        ref={sheenRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 3,
          pointerEvents: 'none',
          mixBlendMode: 'screen',
        }}
      />

      {status && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 40,
            background: 'rgba(15, 18, 25, 0.55)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            color: '#fff',
            padding: '12px 22px',
            borderRadius: '999px',
            border: '1px solid rgba(255,255,255,0.28)',
            fontSize: '13px',
          }}
        >
          {status}
        </div>
      )}

      {/* 4. Ultra-Clear See-Through Home Screen UI */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
          padding: '50px 22px 24px',
          boxSizing: 'border-box',
        }}
      >
        {/* Top Section: See-Through Glass Widgets + App Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* Top Translucent Widgets Row (Matches Video Layout) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div
              style={{
                padding: '16px',
                borderRadius: '26px',
                background: 'linear-gradient(145deg, rgba(255,255,255,0.14), rgba(255,255,255,0.03))',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                border: '1px solid rgba(255,255,255,0.28)',
                boxShadow: '0 10px 25px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.35)',
                color: '#fff',
              }}
            >
              <div style={{ fontSize: '11px', opacity: 0.8, fontWeight: 600 }}>FRIDAY</div>
              <div style={{ fontSize: '32px', fontWeight: 700, lineHeight: 1.1 }}>30</div>
              <div style={{ fontSize: '11px', marginTop: '8px', opacity: 0.85 }}>No events today</div>
            </div>

            <div
              style={{
                padding: '16px',
                borderRadius: '26px',
                background: 'linear-gradient(145deg, rgba(255,255,255,0.14), rgba(255,255,255,0.03))',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                border: '1px solid rgba(255,255,255,0.28)',
                boxShadow: '0 10px 25px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.35)',
                color: '#fff',
              }}
            >
              <div style={{ fontSize: '11px', opacity: 0.8, fontWeight: 600 }}>OPTICAL SLAB</div>
              <div style={{ fontSize: '28px', fontWeight: 700, lineHeight: 1.15 }}>29°</div>
              <div style={{ fontSize: '11px', marginTop: '8px', opacity: 0.85 }}>Clear Refraction</div>
            </div>
          </div>

          {/* Ultra-Transparent App Icons Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '18px',
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
                    width: '58px',
                    height: '58px',
                    borderRadius: '18px',
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.03))',
                    backdropFilter: 'blur(3px)',
                    WebkitBackdropFilter: 'blur(3px)',
                    border: '1px solid rgba(255, 255, 255, 0.34)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '25px',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.18), inset 0 1px 1px rgba(255,255,255,0.45)',
                  }}
                >
                  {app.icon}
                </div>
                <span
                  style={{
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: 500,
                    textShadow: '0 1px 4px rgba(0,0,0,0.9)',
                  }}
                >
                  {app.name}
                </span>
              </a>
            ))}
          </div>
        </div>

        {/* Bottom Section: Calibrator Drawer + Liquid Glass Capsule Dock */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {showCalibrator && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                padding: '16px',
                borderRadius: '26px',
                background: 'rgba(10, 14, 20, 0.55)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.24)',
                color: '#fff',
                fontSize: '11.5px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setOpticalLock(!opticalLock)}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: '999px',
                    background: opticalLock ? 'rgba(16, 185, 129, 0.35)' : 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.3)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '11px',
                  }}
                >
                  {opticalLock ? 'Optical Flow: ON' : 'Optical Flow: OFF'}
                </button>
                <button
                  onClick={recenterGlass}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: '999px',
                    background: 'rgba(255,255,255,0.16)',
                    border: '1px solid rgba(255,255,255,0.3)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '11px',
                  }}
                >
                  Recenter Anchor
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <label>
                  Zoom ({baseZoom.toFixed(2)}x)
                  <input
                    type="range" min="1.2" max="4.5" step="0.05" value={baseZoom}
                    onChange={(e) => setBaseZoom(parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </label>
                <label>
                  Glass Sheen ({glassRefraction.toFixed(1)})
                  <input
                    type="range" min="0" max="1.5" step="0.1" value={glassRefraction}
                    onChange={(e) => setGlassRefraction(parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <label>
                  Offset X ({baseOffsetX}%)
                  <input
                    type="range" min="-35" max="35" step="0.5" value={baseOffsetX}
                    onChange={(e) => setBaseOffsetX(parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </label>
                <label>
                  Offset Y ({baseOffsetY}%)
                  <input
                    type="range" min="-35" max="35" step="0.5" value={baseOffsetY}
                    onChange={(e) => setBaseOffsetY(parseFloat(e.target.value))}
                    style={{ width: '100%' }}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Bottom Floating Liquid Glass Capsule Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              borderRadius: '999px',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.04))',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              border: '1px solid rgba(255,255,255,0.32)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.22), inset 0 1px 1px rgba(255,255,255,0.45)',
            }}
          >
            {!trackingEnabled ? (
              <button
                onClick={engageGlassLock}
                style={{
                  padding: '8px 16px',
                  borderRadius: '999px',
                  background: 'rgba(255,255,255,0.22)',
                  border: '1px solid rgba(255,255,255,0.4)',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                Activate Glass Physics
              </button>
            ) : (
              <button
                onClick={recenterGlass}
                style={{
                  padding: '8px 14px',
                  borderRadius: '999px',
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                Lock Zero Point
              </button>
            )}

            <button
              onClick={() => setShowCalibrator(!showCalibrator)}
              style={{
                padding: '8px 14px',
                borderRadius: '999px',
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 500,
              }}
            >
              {showCalibrator ? 'Hide Optics' : 'Tune Optics'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}