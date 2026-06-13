import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';

function Orb({ position, color, speed, size = 1 }) {
  const mesh = useRef();

  useFrame((state) => {
    if (!mesh.current) return;
    mesh.current.position.y =
      position[1] + Math.sin(state.clock.elapsedTime * speed) * 0.5;
    mesh.current.rotation.x += 0.003;
    mesh.current.rotation.y += 0.005;
  });

  return (
    <mesh ref={mesh} position={position}>
      <sphereGeometry args={[size, 32, 32]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.18}
        roughness={0.1}
        metalness={0.8}
        wireframe={false}
      />
    </mesh>
  );
}

export default function FloatingOrbs() {
  return (
    <Canvas
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
      camera={{ position: [0, 0, 8] }}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} color="#fbbf24" intensity={3} />
      <pointLight position={[-10, -10, -5]} color="#fb923c" intensity={1.5} />
      <pointLight position={[0, 5, 5]} color="#f59e0b" intensity={1} />

      <Orb position={[-3.5, 1.5, -2]} color="#fbbf24" speed={0.7} size={1.4} />
      <Orb position={[3.5, -1, -3]} color="#fb923c" speed={0.5} size={1.1} />
      <Orb position={[0.5, 2.5, -5]} color="#f59e0b" speed={0.9} size={1.8} />
      <Orb position={[-1, -2, -4]} color="#fcd34d" speed={0.6} size={0.8} />
      <Orb position={[2.5, 1, -6]} color="#fb923c" speed={0.8} size={1.2} />
    </Canvas>
  );
}
