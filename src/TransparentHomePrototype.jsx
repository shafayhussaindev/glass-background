import React, { useEffect, useRef, useState } from 'react';

export default function App() {
  const videoRef = useRef(null);

  // Base Optical Calibration (Static hardware lens offset)
  const [baseZoom, setBaseZoom] = useState(2.75);
  const [baseOffsetX, setBaseOffsetX] = useState(-9);
  const [baseOffsetY, setBaseOffsetY] = useState(-14);

  // Real-Time Tracking Multipliers (How aggressively it reacts to tilt/motion)
  const [tiltSensitivity, setTiltSensitivity] = useState(0.45);
  const [depthSensitivity, setDepthSensitivity] = useState(0.08);
  const [trackingEnabled, setTrackingEnabled] = useState(false);

  const [showCalibrator, setShowCalibrator] = useState(true);
  const [status, setStatus] = useState('Initializing optics...');

  // Refs for 60fps physics interpolation without React re-render lag
  const currentTransform = useRef({ x: -9, y: -14, zoom: 2.75 });
  const targetTransform = useRef({ x: -9, y: -14, zoom: 2.75 });
  const baselineAngles = useRef({ beta: null, gamma: null });
  const velocityZ = useRef(0);
  const depthOffset = useRef(0);

  // Keep refs synced when user drags sliders
  const calibrationRef = useRef({
    baseZoom,
    baseOffsetX,
    baseOffsetY,
    tiltSensitivity,
    depthSensitivity,
  });

  useEffect(() => {
    calibrationRef.current = {
      baseZoom,
      baseOffsetX,
      baseOffsetY,
      tiltSensitivity,
      depthSensitivity,
    };
  }, [baseZoom, baseOffsetX, baseOffsetY, tiltSensitivity, depthSensitivity]);

  // 1. Start Rear Camera Stream
  useEffect(() => {
    let stream = null;

    async function startCamera() {
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
              setStatus('Tap screen to engage optical feed');
            }
          };
        }
      } catch (err) {
        setStatus('Camera error: ' + err.message);
      }
    }

    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // 2. 60fps Smooth Lerp Render Loop (Directly updates DOM for zero lag)
  useEffect(() => {
    let rafId;
    const lerp = (start, end, factor) => start + (end - start) * factor;

    const updateViewport = () => {
      const { baseZoom, baseOffsetX, baseOffsetY } = calibrationRef.current;

      if (!trackingEnabled) {
        targetTransform.current.x = baseOffsetX;
        targetTransform.current.y = baseOffsetY;
        targetTransform.current.zoom = baseZoom;
      }

      // Smooth interpolation (0.18 damping prevents hand-shake jitter)
      currentTransform.current.x = lerp(currentTransform.current.x, targetTransform.current.x, 0.18);
      currentTransform.current.y = lerp(currentTransform.current.y, targetTransform.current.y, 0.18);
      currentTransform.current.zoom = lerp(currentTransform.current.zoom, targetTransform.current.zoom, 0.15);

      if (videoRef.current) {
        const { x, y, zoom } = currentTransform.current;
        videoRef.current.style.transform = `scale(${zoom.toFixed(4)}) translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, 0)`;
      }

      rafId = requestAnimationFrame(updateViewport);
    };

    rafId = requestAnimationFrame(updateViewport);
    return () => cancelAnimationFrame(rafId);
  }, [trackingEnabled]);

  // 3. Request iOS Gyroscope & Accelerometer Permissions + Bind Sensors
  const enableRealTimeTracking = async (e) => {
    e.stopPropagation();
    try {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') {
          setStatus('Gyroscope permission denied by iOS');
          return;
        }
      }

      if (
        typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function'
      ) {
        await DeviceMotionEvent.requestPermission();
      }

      // Reset baseline to current holding angle
      baselineAngles.current = { beta: null, gamma: null };
      depthOffset.current = 0;
      setTrackingEnabled(true);
    } catch (err) {
      setStatus('Sensor error: ' + err.message);
    }
  };

  // 4. Listen to Orientation (X/Y Parallax) & Motion (Z-Depth Zoom)
  useEffect(() => {
    if (!trackingEnabled) return;

    const handleOrientation = (event) => {
      const { beta, gamma } = event; // beta: front-back tilt, gamma: left-right tilt
      if (beta === null || gamma === null) return;

      // Capture initial holding angle as the "Zero Point"
      if (baselineAngles.current.beta === null) {
        baselineAngles.current = { beta, gamma };
      }

      const deltaBeta = beta - baselineAngles.current.beta;
      const deltaGamma = gamma - baselineAngles.current.gamma;

      const { baseOffsetX, baseOffsetY, tiltSensitivity } = calibrationRef.current;

      // Counter-shift the camera viewport opposite to angular hand tilt
      targetTransform.current.x = baseOffsetX - deltaGamma * tiltSensitivity;
      targetTransform.current.y = baseOffsetY - deltaBeta * tiltSensitivity;
    };

    const handleMotion = (event) => {
      const accZ = event.acceleration?.z;
      if (accZ === null || accZ === undefined) return;

      const { baseZoom, depthSensitivity } = calibrationRef.current;

      // Deadzone filter to ignore micro hand tremors
      if (Math.abs(accZ) > 0.12) {
        velocityZ.current += accZ * 0.016;
        depthOffset.current += velocityZ.current;
      } else {
        velocityZ.current *= 0.8; // Friction decay
      }

      // Gently spring back toward center calibration over time to prevent IMU drift
      depthOffset.current *= 0.96;

      // Adjust zoom dynamically as phone moves closer/further from desk
      const dynamicZoom = Math.min(
        5.0,
        Math.max(1.2, baseZoom + depthOffset.current * depthSensitivity * 10)
      );
      targetTransform.current.zoom = dynamicZoom;
    };

    window.addEventListener('deviceorientation', handleOrientation, true);
    window.addEventListener('devicemotion', handleMotion, true);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
      window.removeEventListener('devicemotion', handleMotion, true);
    };
  }, [trackingEnabled]);

  // Recenter zero-point angle at any time
  const recenterZeroPoint = (e) => {
    e.stopPropagation();
    baselineAngles.current = { beta: null, gamma: null };
    depthOffset.current = 0;
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
      onClick={() => {
        if (videoRef.current && videoRef.current.paused) {
          videoRef.current.play();
          setStatus('');
        }
        setShowCalibrator(!showCalibrator);
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
      {/* Hardware-Accelerated 60fps Camera Layer */}
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
          transformOrigin: 'center center',
          willChange: 'transform',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />

      {status && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 30,
            background: 'rgba(20, 20, 25, 0.7)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            color: '#fff',
            padding: '12px 22px',
            borderRadius: '999px',
            border: '1px solid rgba(255,255,255,0.2)',
            fontSize: '13px',
          }}
        >
          {status}
        </div>
      )}

      {/* Foreground Glass Home UI */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
          padding: '52px 24px 28px',
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
                  borderRadius: '18px',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.26), rgba(255,255,255,0.08))',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: '1px solid rgba(255, 255, 255, 0.32)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '26px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.22), inset 0 1px 1px rgba(255,255,255,0.4)',
                }}
              >
                {app.icon}
              </div>
              <span
                style={{
                  color: '#fff',
                  fontSize: '11px',
                  fontWeight: 500,
                  textShadow: '0 1px 4px rgba(0,0,0,0.85)',
                }}
              >
                {app.name}
              </span>
            </a>
          ))}
        </div>

        {/* Real-Time Optical & Gyroscope Calibrator */}
        {showCalibrator && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '18px',
              borderRadius: '28px',
              background: 'rgba(15, 18, 24, 0.65)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              border: '1px solid rgba(255,255,255,0.22)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
              color: '#fff',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            {/* Action Capsule Buttons */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
              {!trackingEnabled ? (
                <button
                  onClick={enableRealTimeTracking}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '999px',
                    background: 'linear-gradient(135deg, rgba(56,189,248,0.85), rgba(59,130,246,0.85))',
                    border: '1px solid rgba(255,255,255,0.4)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '12px',
                  }}
                >
                  Enable 60fps Gyro Tracking
                </button>
              ) : (
                <button
                  onClick={recenterZeroPoint}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '999px',
                    background: 'rgba(255,255,255,0.18)',
                    border: '1px solid rgba(255,255,255,0.3)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '12px',
                  }}
                >
                  Recenter Holding Angle
                </button>
              )}
            </div>

            <label>
              Base Zoom ({baseZoom.toFixed(2)}x)
              <input
                type="range"
                min="1"
                max="4.5"
                step="0.05"
                value={baseZoom}
                onChange={(e) => setBaseZoom(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label>
                Offset X ({baseOffsetX}%)
                <input
                  type="range"
                  min="-35"
                  max="35"
                  step="0.5"
                  value={baseOffsetX}
                  onChange={(e) => setBaseOffsetX(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </label>
              <label>
                Offset Y ({baseOffsetY}%)
                <input
                  type="range"
                  min="-35"
                  max="35"
                  step="0.5"
                  value={baseOffsetY}
                  onChange={(e) => setBaseOffsetY(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label>
                Tilt Parallax ({tiltSensitivity})
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={tiltSensitivity}
                  onChange={(e) => setTiltSensitivity(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </label>
              <label>
                Z-Depth Zoom ({depthSensitivity})
                <input
                  type="range"
                  min="0"
                  max="0.3"
                  step="0.01"
                  value={depthSensitivity}
                  onChange={(e) => setDepthSensitivity(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}