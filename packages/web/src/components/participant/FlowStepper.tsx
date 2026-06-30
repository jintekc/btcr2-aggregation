import { useParticipant } from '../../stores/participant';
import { FLOW_STEPS, type StepStatus } from '../../lib/types';
import { SectionTitle, StatusDot } from '../../ui/primitives';

const DOT_TONE: Record<StepStatus, 'neutral' | 'accent' | 'good' | 'bad'> = {
  idle: 'neutral',
  active: 'accent',
  done: 'good',
  failed: 'bad',
};

const LABEL_CLASS: Record<StepStatus, string> = {
  idle: 'text-faint',
  active: 'text-ink',
  done: 'text-good',
  failed: 'text-bad',
};

/** Vertical 4-step tracker driven by the participant runner's lifecycle events. */
export function FlowStepper() {
  const steps = useParticipant((s) => s.steps);

  return (
    <div className="space-y-3">
      <SectionTitle>Protocol</SectionTitle>
      <ol className="relative space-y-5">
        {FLOW_STEPS.map((step, i) => {
          const st = steps[step.key];
          const isLast = i === FLOW_STEPS.length - 1;
          return (
            <li key={step.key} className="relative flex gap-3">
              {!isLast && (
                <span
                  className={`absolute left-[5px] top-5 h-full w-px ${st === 'done' ? 'bg-good/50' : 'bg-edge'}`}
                />
              )}
              <span className="relative z-10 mt-1">
                <StatusDot tone={DOT_TONE[st]} pulse={st === 'active'} />
              </span>
              <div className="pb-1">
                <div className={`text-sm font-semibold ${LABEL_CLASS[st]}`}>
                  {step.label}
                  {st === 'active' && <span className="ml-2 text-xs font-normal text-accent">in progress</span>}
                  {st === 'done' && <span className="ml-2 text-xs font-normal text-good">done</span>}
                </div>
                <div className="text-xs text-faint">{step.hint}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
