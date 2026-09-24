import { useLayoutEffect, useRef, useState } from 'react';
/** Presentation only. Never used for editable fields or as an authoritative data value. */
export function RefreshingText({ text }: { text: string }) {
  const [visible, setVisible] = useState(text),
    previous = useRef(text);
  useLayoutEffect(() => {
    if (previous.current === text) return;
    const from = Array.from(previous.current),
      to = Array.from(text);
    previous.current = text;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const frame = requestAnimationFrame(() => setVisible(text));
      return () => cancelAnimationFrame(frame);
    }
    let common = 0;
    while (common < from.length && common < to.length && from[common] === to[common]) common++;
    let frame = 0,
      start = 0;
    const tick = (time: number) => {
      if (!start) start = time;
      if (window.getSelection()?.toString()) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const progress = time - start;
      if (progress < 90) {
        const keep = from.length - Math.floor(((from.length - common) * progress) / 90);
        setVisible(from.slice(0, keep).join(''));
      } else if (progress < 280) {
        const count = common + Math.ceil(((to.length - common) * (progress - 90)) / 190);
        setVisible(to.slice(0, count).join(''));
      } else {
        setVisible(text);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return (
    <span data-selectable>
      {matchMedia('(prefers-reduced-motion: reduce)').matches ? text : visible}
    </span>
  );
}
