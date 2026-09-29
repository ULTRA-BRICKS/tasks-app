import './keycap.css';
import { Fragment } from 'react';
import {
  devicePlatform,
  keycapLabels,
  parseBinding,
  spokenBinding,
  type Platform,
} from '../lib/commands';
/**
 * Visible keycaps for a canonical binding (`Mod+K`, `G I`). Glyphs are hidden from assistive
 * technology, which reads the spoken form instead ("Command K", "G then I").
 */
export function Keycaps({
  binding,
  platform = devicePlatform,
}: {
  binding: string;
  platform?: Platform;
}) {
  const parsed = parseBinding(binding);
  if (!parsed) return null;
  return (
    <span className="keycaps">
      <span className="keycaps-visual" aria-hidden="true">
        {keycapLabels(parsed, platform).map((step, index) => (
          <Fragment key={`${index}:${step.join('+')}`}>
            {index > 0 && <span className="keycaps-then">then</span>}
            {step.map((label) => (
              <kbd key={label} className="keycap">
                {label}
              </kbd>
            ))}
          </Fragment>
        ))}
      </span>
      <span className="sr-only">{spokenBinding(parsed, platform)}</span>
    </span>
  );
}
