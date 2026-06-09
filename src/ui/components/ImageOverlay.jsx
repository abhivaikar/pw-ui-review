import { useEffect } from 'react';

// Full-screen image viewer. Click anywhere or press Escape to close.
export function ImageOverlay({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <img className="overlay__img" src={src} alt={alt} />
    </div>
  );
}
