import React, { useEffect, useRef, useState } from 'react';

export default function TransparentHomePrototype() {
  const videoRef = useRef(null);
  // Calibration states to dial in your specific phone's lens & arm distance
  const [zoom, setZoom] = useState(2.8);
  const [offsetX, setOffsetX] = useState(-8);
  const [offsetY, setOffsetY] = useState(-14);
  const [showCalibrator, setShowCalibrator] = useState(true);

  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { exact: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Camera access error:', err);
      }
    }
    startCamera();
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none">
      {/* Calibrated Rear Camera Layer */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          transform: `scale(${zoom}) translate(${offsetX}%, ${offsetY}%)`,
          transformOrigin: 'center center',
        }}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      />

      {/* Mock Home Screen UI Layer */}
      <div
        onClick={() => setShowCalibrator(!showCalibrator)}
        className="relative z-10 flex flex-col justify-between w-full h-full p-6"
      >
        {/* Top Widgets / Icons Grid */}
        <div className="grid grid-cols-4 gap-4 mt-8">
          {['Phone', 'Messages', 'Safari', 'Music', 'Camera', 'Maps', 'Files', 'Settings'].map((app) => (
            <div key={app} className="flex flex-col items-center gap-1">
              <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 shadow-lg flex items-center justify-center text-white text-xs font-medium">
                {app[0]}
              </div>
              <span className="text-[11px] text-white/90 drop-shadow">{app}</span>
            </div>
          ))}
        </div>

        {/* Live Calibration Controls (Tap screen to hide once aligned!) */}
        {showCalibrator && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="p-4 rounded-3xl bg-black/60 backdrop-blur-xl border border-white/15 text-white text-xs space-y-3"
          >
            <div className="font-semibold text-white/80">Optical Calibration (Tap screen to hide)</div>
            <label className="block">
              FOV Zoom ({zoom}x)
              <input
                type="range" min="1" max="5" step="0.05" value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="block">
              Lens Offset X ({offsetX}%)
              <input
                type="range" min="-30" max="30" step="0.5" value={offsetX}
                onChange={(e) => setOffsetX(parseFloat(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="block">
              Lens Offset Y ({offsetY}%)
              <input
                type="range" min="-30" max="30" step="0.5" value={offsetY}
                onChange={(e) => setOffsetY(parseFloat(e.target.value))}
                className="w-full"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}