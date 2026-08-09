import { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import {
  useAppStore,
  SLOT_TIMES,
  SLOT_LABELS,
  TOTAL_STEPS,
  stepToDayOffset,
  stepToSlot,
} from '../../store/appStore';

interface Props {
  forecastOpen?: boolean;
}

// Day labels for the 7 tick marks
const DAY_TICKS = ['T−3', 'T−2', 'T−1', 'Today', 'T+1', 'T+2', 'T+3'];

// Date strings matching pune_data.json
const DAY_DATES = ['Aug 6', 'Aug 7', 'Aug 8', 'Aug 9', 'Aug 10', 'Aug 11', 'Aug 12'];

export default function TimeController({ forecastOpen = false }: Props) {
  const { selectedSubStep, setSubStep } = useAppStore();
  const [isPlaying, setIsPlaying] = useState(false);

  const dayOffset = stepToDayOffset(selectedSubStep); // -3 … +3
  const slot      = stepToSlot(selectedSubStep);       // 0 … 5
  const dayIdx    = dayOffset + 3;                     // 0 … 6
  const isObserved = selectedSubStep < 24;             // steps 0–23 = T-3..T (4 days × 6)

  // Auto-play: advance every 600 ms
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setSubStep(Math.min(selectedSubStep + 1, TOTAL_STEPS - 1));
      if (selectedSubStep >= TOTAL_STEPS - 1) setIsPlaying(false);
    }, 600);
    return () => clearInterval(id);
  }, [isPlaying, selectedSubStep, setSubStep]);

  const fillPct = (selectedSubStep / (TOTAL_STEPS - 1)) * 100;

  return (
    <div
      className={`
        absolute bottom-5 z-10 w-[560px]
        transition-all duration-300 ease-in-out
        ${forecastOpen ? 'left-4' : 'left-1/2 -translate-x-1/2'}
      `}
    >
      <div className="
        w-full bg-[#000]/60 backdrop-blur-xl
        border border-white/[0.06]
        rounded-[20px] shadow-[0_8px_32px_rgba(0,0,0,0.4)]
        px-4 py-3 flex flex-col gap-2
      ">

        {/* ── Top row: controls + active timestamp ── */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Play / Pause */}
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-[#1769d1] text-white hover:bg-[#1a7de8] transition"
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            </button>
            {/* Reset */}
            <button
              type="button"
              onClick={() => { setIsPlaying(false); setSubStep(18); }}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-[#6f6f6f] hover:text-[#ccc] transition"
            >
              <RotateCcw size={13} />
            </button>
          </div>

          {/* Active timestamp */}
          <div className="flex flex-col items-center">
            <span className="text-[13px] font-medium text-white leading-none">
              {DAY_DATES[dayIdx]}, 2026 &nbsp;·&nbsp; {SLOT_TIMES[slot]} IST
            </span>
            <span className="text-[10px] mt-0.5 leading-none" style={{ color: isObserved ? '#79c7a2' : '#4285f4' }}>
              {isObserved ? 'OBSERVED HISTORICAL' : 'AI PREDICTED FORECAST'}
              &nbsp;·&nbsp; {SLOT_LABELS[slot]}
            </span>
          </div>

          {/* Horizon badge */}
          <span className="text-[10px] text-[#6f6f6f] px-2 py-0.5 rounded-full border border-[#2a2a2a] bg-[#161616] whitespace-nowrap">
            {dayOffset === 0 ? 'T' : dayOffset > 0 ? `T+${dayOffset}d` : `T${dayOffset}d`} / {SLOT_TIMES[slot]}
          </span>
        </div>

        {/* ── Slider ── */}
        <input
          type="range"
          min={0}
          max={TOTAL_STEPS - 1}
          step={1}
          value={selectedSubStep}
          onChange={(e) => { setIsPlaying(false); setSubStep(Number(e.target.value)); }}
          className="w-full h-1 rounded-full appearance-none cursor-pointer accent-[#4285f4]"
          style={{
            background: `linear-gradient(to right, #4285f4 ${fillPct}%, #2a2a2a ${fillPct}%)`,
          }}
        />

        {/* ── Day tick marks with sub-tick dots ── */}
        <div className="flex justify-between px-0 text-[9px]">
          {DAY_TICKS.map((label, i) => {
            const dayStep = i * 6; // first slot of this day
            const isActiveDay = dayIdx === i;
            return (
              <div key={label} className="flex flex-col items-center gap-0.5" style={{ width: `${100 / 7}%` }}>
                {/* 6 sub-tick dots */}
                <div className="flex gap-[2px]">
                  {[0, 1, 2, 3, 4, 5].map((s) => {
                    const step = dayStep + s;
                    const isActive = step === selectedSubStep;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSubStep(step)}
                        className="rounded-full transition-all"
                        style={{
                          width:  isActive ? 6 : 4,
                          height: isActive ? 6 : 4,
                          background: isActive ? '#4285f4' : isActiveDay ? '#555' : '#333',
                          marginTop: isActive ? 0 : 1,
                        }}
                      />
                    );
                  })}
                </div>
                {/* Day label */}
                <span className={`transition-colors ${isActiveDay ? 'text-[#4285f4] font-medium' : 'text-[#555]'}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
