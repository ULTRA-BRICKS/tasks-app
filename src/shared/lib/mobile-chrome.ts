import { useEffect, useState } from 'react';
export function useMobileChrome() {
  const [collapsed, setCollapsed] = useState(false),
    [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const media = matchMedia('(pointer: coarse)'),
      viewport = window.visualViewport;
    let previous = Math.max(0, window.scrollY),
      accumulated = 0,
      frame = 0;
    const focused = () =>
      document.activeElement?.matches('input,textarea,select,[contenteditable="true"]') ?? false;
    const checkKeyboard = () => {
      setKeyboard(Boolean(viewport && focused() && window.innerHeight - viewport.height > 120));
      if (focused()) setCollapsed(false);
    };
    const update = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY),
        delta = y - previous;
      previous = y;
      if (!media.matches || y < 72 || focused()) {
        accumulated = 0;
        setCollapsed(false);
        return;
      }
      if (Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      accumulated += delta;
      if (accumulated > 20) {
        setCollapsed(true);
        accumulated = 0;
      } else if (accumulated < -12) {
        setCollapsed(false);
        accumulated = 0;
      }
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', scroll, { passive: true });
    document.addEventListener('focusin', checkKeyboard);
    document.addEventListener('focusout', checkKeyboard);
    viewport?.addEventListener('resize', checkKeyboard);
    media.addEventListener('change', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scroll);
      document.removeEventListener('focusin', checkKeyboard);
      document.removeEventListener('focusout', checkKeyboard);
      viewport?.removeEventListener('resize', checkKeyboard);
      media.removeEventListener('change', update);
    };
  }, []);
  return { collapsed, keyboard };
}
