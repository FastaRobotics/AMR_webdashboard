import { useState, useRef, useEffect, useCallback } from "react";

interface VirtualJoystickProps {
  onMove: (x: number, y: number) => void;
  disabled?: boolean;
}

export default function VirtualJoystick({
  onMove,
  disabled = false,
}: VirtualJoystickProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);

  const radius = 60; // Container radius
  const knobRadius = 20; // Knob radius

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging || !containerRef.current || disabled) return;

      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const deltaX = clientX - centerX;
      const deltaY = clientY - centerY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // Limit movement to container radius
      const maxDistance = radius - knobRadius;
      let x = deltaX;
      let y = deltaY;

      if (distance > maxDistance) {
        const angle = Math.atan2(deltaY, deltaX);
        x = Math.cos(angle) * maxDistance;
        y = Math.sin(angle) * maxDistance;
      }

      setPosition({ x, y });

      // Normalize values to -1 to 1 range
      const normalizedX = x / maxDistance;
      const normalizedY = -y / maxDistance; // Invert Y for intuitive control

      onMove(normalizedX, normalizedY);
    },
    [isDragging, onMove, radius, knobRadius, disabled],
  );

  const handleStart = useCallback(
    (clientX: number, clientY: number) => {
      if (disabled) return;
      setIsDragging(true);

      // set initial position immediately
      handleMove(clientX, clientY);
    },
    [disabled, handleMove],
  );

  const handleEnd = useCallback(() => {
    if (disabled) return;
    setIsDragging(false);
    setPosition({ x: 0, y: 0 });
    onMove(0, 0);
  }, [onMove, disabled]);

  // Mouse events
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
      handleEnd();
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, handleMove, handleEnd]);

  // Touch events
  useEffect(() => {
    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    };

    const handleTouchEnd = () => {
      handleEnd();
    };

    if (isDragging) {
      document.addEventListener("touchmove", handleTouchMove, {
        passive: false,
      });
      document.addEventListener("touchend", handleTouchEnd);
    }

    return () => {
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isDragging, handleMove, handleEnd]);

  // Box-shadow ring instead of border (so it does NOT shift the padding box,
  // which is what was throwing the visual center off before).
  const ringShadow = disabled
    ? "inset 0 0 0 2px rgba(55,65,81,0.9)"
    : isDragging
      ? "inset 0 0 0 2px rgba(96,165,250,0.75)"
      : "inset 0 0 0 2px rgba(107,114,128,0.7)";

  const outerShadow = disabled
    ? "inset 0 2px 8px rgba(0,0,0,0.6)"
    : isDragging
      ? "inset 0 2px 8px rgba(0,0,0,0.5), 0 0 0 3px rgba(59,130,246,0.15)"
      : "inset 0 2px 8px rgba(0,0,0,0.5), 0 10px 24px -10px rgba(0,0,0,0.85)";

  return (
    <div className="flex justify-center select-none">
      <div className="relative">
        {/* Ambient glow behind the pad */}
        <div
          className={`pointer-events-none absolute -inset-3 rounded-full blur-xl transition-opacity duration-300 ${disabled ? "opacity-0" : isDragging ? "opacity-70" : "opacity-25"
            }`}
          style={{
            background:
              "radial-gradient(circle, rgba(59,130,246,0.55) 0%, rgba(59,130,246,0) 70%)",
          }}
        />

        {/* Outer decorative ring */}
        <div
          className={`pointer-events-none absolute -inset-1.5 rounded-full border transition-colors duration-200 ${disabled
            ? "border-gray-700/40"
            : isDragging
              ? "border-blue-400/30"
              : "border-gray-500/20"
            }`}
        />

        <div
          ref={containerRef}
          data-testid="virtual-joystick"
          onMouseDown={(event) => handleStart(event.clientX, event.clientY)}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            handleStart(touch.clientX, touch.clientY);
          }}
          className={`relative w-32 h-32 rounded-full transition-shadow duration-200 ${!disabled ? "cursor-pointer" : ""
            }`}
          style={{
            background: disabled
              ? "radial-gradient(circle at 50% 32%, #374151 0%, #1f2937 68%, #111827 100%)"
              : "radial-gradient(circle at 50% 32%, #4b5563 0%, #374151 62%, #1f2937 100%)",
            boxShadow: `${ringShadow}, ${outerShadow}`,
          }}
        >
          {/* Center cross lines */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={`w-px h-[72%] rounded-full ${disabled ? "bg-gray-600/50" : "bg-gray-400/25"
                }`}
            />
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={`h-px w-[72%] rounded-full ${disabled ? "bg-gray-600/50" : "bg-gray-400/25"
                }`}
            />
          </div>

          {/* Inner guide ring (perfectly centered now) */}
          <div
            className={`pointer-events-none absolute inset-[18px] rounded-full border ${disabled ? "border-gray-600/30" : "border-gray-400/15"
              }`}
          />

          {/* Joystick knob — centered via transform */}
          <div
            ref={knobRef}
            className={`absolute w-10 h-10 rounded-full border transition-[border-color,box-shadow] duration-150 ${disabled
              ? "border-gray-500/80"
              : isDragging
                ? "border-blue-200/80"
                : "border-blue-300/60"
              }`}
            style={{
              left: `calc(50% + ${position.x}px)`,
              top: `calc(50% + ${position.y}px)`,
              transform: "translate(-50%, -50%)",
              cursor: disabled
                ? "not-allowed"
                : isDragging
                  ? "grabbing"
                  : "grab",
              background: disabled
                ? "radial-gradient(circle at 50% 50%, #6b7280 0%, #4b5563 48%, #374151 100%)"
                : isDragging
                  ? "radial-gradient(circle at 50% 50%, #bfdbfe 0%, #60a5fa 48%, #2563eb 100%)"
                  : "radial-gradient(circle at 50% 50%, #93c5fd 0%, #3b82f6 48%, #1d4ed8 100%)",
              boxShadow: disabled
                ? "0 2px 5px rgba(0,0,0,0.55)"
                : isDragging
                  ? "0 4px 14px rgba(37,99,235,0.65), inset 0 1px 2px rgba(255,255,255,0.65)"
                  : "0 4px 10px rgba(0,0,0,0.6), inset 0 1px 2px rgba(255,255,255,0.45)",
            }}
            onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
            onTouchStart={(e) => {
              e.preventDefault();
              const touch = e.touches[0];
              handleStart(touch.clientX, touch.clientY);
            }}
          >
            {/* Knob center dot */}
            <div
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${disabled ? "bg-gray-500" : "bg-white/90"
                }`}
              style={{
                boxShadow: disabled
                  ? "none"
                  : "0 0 6px rgba(255,255,255,0.55)",
              }}
            />
          </div>

          {/* Direction indicators */}
          <div className="absolute inset-0 pointer-events-none">
            <div
              className={`absolute top-1.5 left-1/2 -translate-x-1/2 text-[9px] leading-none transition-colors ${disabled
                ? "text-gray-600"
                : isDragging
                  ? "text-blue-300/80"
                  : "text-gray-400/70"
                }`}
            >
              ▲
            </div>
            <div
              className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[9px] leading-none transition-colors ${disabled
                ? "text-gray-600"
                : isDragging
                  ? "text-blue-300/80"
                  : "text-gray-400/70"
                }`}
            >
              ▼
            </div>
            <div
              className={`absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] leading-none transition-colors ${disabled
                ? "text-gray-600"
                : isDragging
                  ? "text-blue-300/80"
                  : "text-gray-400/70"
                }`}
            >
              ◀
            </div>
            <div
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] leading-none transition-colors ${disabled
                ? "text-gray-600"
                : isDragging
                  ? "text-blue-300/80"
                  : "text-gray-400/70"
                }`}
            >
              ▶
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}