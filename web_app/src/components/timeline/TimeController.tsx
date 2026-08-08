import { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

interface Props {
  forecastOpen?: boolean;
}

export default function TimeController({ forecastOpen = false }: Props) {
  const { selectedTimestamp, setTimestamp } = useAppStore();
  const [isPlaying, setIsPlaying] = useState(false);

  // Auto-play loop
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying) {
      interval = setInterval(() => {
        setTimestamp((prev) => {
          if (prev >= 3) {
            setIsPlaying(false);
            return 3;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, setTimestamp]);

  const timeLabels = ['T−3', 'T−2', 'T−1', 'Today', 'T+1', 'T+2', 'T+3'];

  const labelFor = (ts: number) => {
    if (ts === 0) return 'Today';
    if (ts < 0)  return `T${ts}d`;
    return `T+${ts}d`;
  };

  return (
    <div
      className={`
        absolute bottom-5 z-10
        w-[520px]
        transition-all duration-300 ease-in-out
        ${forecastOpen ? 'left-4' : 'left-1/2 -translate-x-1/2'}
      `}
    >
      <div
        className="
          w-full
          bg-[#0a0a0a]/60 backdrop-blur-xl border border-white/[0.06]
          rounded-[20px] shadow-[0_8px_32px_rgba(0,0,0,0.4)]
          px-4 py-3
          flex flex-col gap-3
        "
      >
        {/* Controls row */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            {/* Play / Pause */}
            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className="
                flex items-center justify-center
                w-7 h-7 rounded-full
                bg-[#1769d1] text-white
                hover:bg-[#1a7de8] transition
              "
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            </button>

            {/* Reset */}
            <button
              type="button"
              onClick={() => { setIsPlaying(false); setTimestamp(0); }}
              className="
                flex items-center justify-center
                w-7 h-7 rounded-full
                bg-[#1a1a1a] border border-[#2a2a2a]
                text-[#6f6f6f] hover:text-[#cccccc] transition
              "
            >
              <RotateCcw size={13} />
            </button>
          </div>

          {/* Current label */}
          <span className="text-[13px] font-medium text-[#eeeeee]">
            {labelFor(selectedTimestamp)}
          </span>

          {/* Horizon badge */}
          <span className="text-[10px] text-[#6f6f6f] px-2 py-0.5 rounded-full border border-[#2a2a2a] bg-[#161616]">
            7-day window
          </span>
        </div>

        {/* Slider */}
        <input
          type="range"
          min="-3"
          max="3"
          step="1"
          value={selectedTimestamp}
          onChange={(e) => { setIsPlaying(false); setTimestamp(Number(e.target.value)); }}
          className="w-full h-1 rounded-full appearance-none cursor-pointer accent-[#4285f4]"
          style={{ background: `linear-gradient(to right, #4285f4 ${((selectedTimestamp + 3) / 6) * 100}%, #2a2a2a ${((selectedTimestamp + 3) / 6) * 100}%)` }}
        />

        {/* Tick labels */}
        <div className="flex justify-between text-[9px] text-[#555555] px-0.5">
          {timeLabels.map((label, idx) => {
            const val = idx - 3;
            return (
              <span
                key={label}
                className={`transition-colors ${selectedTimestamp === val ? 'text-[#4285f4] font-medium' : ''}`}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
