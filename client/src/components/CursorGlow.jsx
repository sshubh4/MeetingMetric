import { useEffect, useRef } from 'react';

export default function CursorGlow() {
  const glowRef = useRef();

  useEffect(() => {
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let currentX = mouseX;
    let currentY = mouseY;
    let rafId;

    const onMouseMove = (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const animate = () => {
      currentX += (mouseX - currentX) * 0.06;
      currentY += (mouseY - currentY) * 0.06;
      if (glowRef.current) {
        glowRef.current.style.left = currentX + 'px';
        glowRef.current.style.top = currentY + 'px';
      }
      rafId = requestAnimationFrame(animate);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    rafId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={glowRef}
      style={{
        position: 'fixed',
        width: '700px',
        height: '700px',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, rgba(251,191,36,0.10) 0%, transparent 70%)',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 1,
        mixBlendMode: 'screen',
        willChange: 'left, top',
      }}
    />
  );
}
