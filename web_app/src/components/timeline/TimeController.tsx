import { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import {
  useAirshedStore,
  SLOT_TIMES,
  SLOT_LABELS,
  TOTAL_STEPS,
  stepToDayOffset,
  stepToSlot,
} from '../../store/airshedStore';
import { getHazardStyle } from '../../lib/airshedSelectors';

interface Props {
  forecastOpen?: boolean;
  layerOpen?: boolean;
}

const DAY_TICKS = ['T−3', 'T−2', 'T−1', 'Today', 'T+1', 'T+2', 'T+3'];

export default function TimeController({ forecastOpen = false, layerOpen = false }: Props) {
  const { selectedSubStep, setSubStep, selectedCityId, payload } = useAirshedStore();
  const [isPlaying, setIsPlaying] = useState(false);

  const dayOffset = stepToDayOffset(selectedSubStep);
  const slot = stepToSlot(selectedSubStep);
  const dayIdx = dayOffset + 3;
  const step = payload?.time_steps[selectedSubStep];
  const isObserved = step?.is_observed ?? selectedSubStep < 24;
  const node = step?.nodes[selectedCityId];
  const cascadeCount = step?.active_cascade_pulses.length ?? 0;
  const chhi = node?.chhi_score ?? 35;
  const hazard = getHazardStyle(chhi);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setSubStep(Math.min(selectedSubStep + 1, TOTAL_STEPS - 1));
      if (selectedSubStep >= TOTAL_STEPS - 1) setIsPlaying(false);
    }, 600);
    return () => clearInterval(id);
  }, [isPlaying, selectedSubStep, setSubStep]);

  const fillPct = (selectedSubStep / (TOTAL_STEPS - 1)) * 100;
  const stamp = step ? `${step.date_formatted} • ${step.hour_ist} IST` : `${SLOT_TIMES[slot]} IST`;

  return (
    <div
      className={`
        absolute bottom-5 z-10
        transition-all duration-300 ease-in-out
        ${forecastOpen
          ? layerOpen
            ? 'left-[238px] right-[508px] w-auto min-w-[420px]'
            : 'left-4 right-[508px] w-auto min-w-[420px]'
          : 'left-1/2 -translate-x-1/2 w-[620px]'}
      `}
    >
      <div className="
        w-full bg-[#000]/60 backdrop-blur-xl
        border border-white/[0.06]
        rounded-[20px] shadow-[0_8px_32px_rgba(0,0,0,0.4)]
        px-4 py-3 flex flex-col gap-2
      ">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPlaying((p) => !p)}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-[#1769d1] text-white hover:bg-[#1a7de8] transition"
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button
              type="button"
              onClick={() => { setIsPlaying(false); setSubStep(18); }}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] text-[#6f6f6f] hover:text-[#ccc] transition"
            >
              <RotateCcw size={13} />
            </button>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-[13px] font-medium text-white leading-none font-mono">
              {stamp}
            </span>
            <span className="text-[10px] mt-0.5 leading-none" style={{ color: isObserved ? '#79c7a2' : '#4285f4' }}>
              {isObserved ? 'OBSERVED HISTORICAL' : 'AI PREDICTED FORECAST'}
              &nbsp;·&nbsp; {SLOT_LABELS[slot]}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {cascadeCount > 0 && (
              <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap text-[#f97316] bg-[#f97316]/15 border border-[#f97316]/40">
                {cascadeCount} cascade{cascadeCount === 1 ? '' : 's'}
              </span>
            )}
            <span
              className="text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
              style={{
                color: hazard.color,
                background: `${hazard.color}18`,
                border: `1px solid ${hazard.color}44`,
              }}
            >
              CHHI&nbsp;{chhi.toFixed(0)}&nbsp;·&nbsp;{hazard.label}
            </span>
            <span className="text-[10px] text-[#6f6f6f] px-2 py-0.5 rounded-full border border-[#2a2a2a] bg-[#161616] whitespace-nowrap font-mono">
              {dayOffset === 0 ? 'T' : dayOffset > 0 ? `T+${dayOffset}d` : `T${dayOffset}d`} / {SLOT_TIMES[slot]}
            </span>
          </div>
        </div>

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

        <div className="flex justify-between px-0 text-[9px]">
          {DAY_TICKS.map((label, i) => {
            const dayStep = i * 6;
            const isActiveDay = dayIdx === i;
            return (
              <div key={label} className="flex flex-col items-center gap-0.5" style={{ width: `${100 / 7}%` }}>
                <div className="flex gap-[2px]">
                  {[0, 1, 2, 3, 4, 5].map((s) => {
                    const stepIdx = dayStep + s;
                    const isActive = stepIdx === selectedSubStep;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSubStep(stepIdx)}
                        className="rounded-full transition-all"
                        style={{
                          width: isActive ? 6 : 4,
                          height: isActive ? 6 : 4,
                          background: isActive ? '#4285f4' : isActiveDay ? '#555' : '#333',
                          marginTop: isActive ? 0 : 1,
                        }}
                      />
                    );
                  })}
                </div>
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
