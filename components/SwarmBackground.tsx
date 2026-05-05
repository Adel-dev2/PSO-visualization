'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Particle Swarm Ball Background
 * - Particles explode from center and form a glowing spherical swarm
 * - Particles continuously move within the sphere maintaining even distribution
 * - Creates an alive, breathing effect
 */
export default function SwarmBackground() {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const container = mountRef.current;
    if (!container) return;

    // Get dimensions
    let W = window.innerWidth;
    let H = window.innerHeight;

    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 2000);
    camera.position.z = 500;

    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Configuration
    const PARTICLE_COUNT = 2500;
    const SPHERE_RADIUS = Math.min(W, H) * 0.48;
    
    // Create particle geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const targetPositions = new Float32Array(PARTICLE_COUNT * 3);
    const phases = new Float32Array(PARTICLE_COUNT);
    const sizes = new Float32Array(PARTICLE_COUNT);

    // Initialize particles - start near targets with small random offset
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Target position: evenly distributed on sphere surface using fibonacci sphere
      const phi = Math.acos(1 - 2 * (i + 0.5) / PARTICLE_COUNT);
      const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
      
      // Vary radius slightly for depth
      const r = SPHERE_RADIUS * (0.7 + Math.random() * 0.3);
      
      targetPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      targetPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      targetPositions[i * 3 + 2] = r * Math.cos(phi);

      // Start near target with a small random offset instead of center
      positions[i * 3] = targetPositions[i * 3] * 0.01 + (Math.random() - 0.5) * 10;
      positions[i * 3 + 1] = targetPositions[i * 3 + 1] * 0.01 + (Math.random() - 0.5) * 10;
      positions[i * 3 + 2] = targetPositions[i * 3 + 2] * 0.01 + (Math.random() - 0.5) * 10;

      // Initial velocity: zero (no explosion)
      velocities[i * 3] = 0;
      velocities[i * 3 + 1] = 0;
      velocities[i * 3 + 2] = 0;

      // Random phase for organic movement
      phases[i] = Math.random() * Math.PI * 2;
      
      // Random sizes
      sizes[i] = 2 + Math.random() * 3;

      // Colors: purple/white spectrum
      const brightness = 0.6 + Math.random() * 0.4;
      colors[i * 3] = brightness * 0.85;     // R (high for white-purple)
      colors[i * 3 + 1] = brightness * 0.2;  // G (low for purple)
      colors[i * 3 + 2] = brightness * 1.0;  // B (full blue)
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Create glow texture
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.15, 'rgba(200,210,255,0.9)');
    gradient.addColorStop(0.4, 'rgba(140,150,255,0.5)');
    gradient.addColorStop(0.7, 'rgba(100,110,230,0.15)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);

    // Shader material for better control
    const material = new THREE.ShaderMaterial({
      uniforms: {
        pointTexture: { value: texture },
        time: { value: 0 },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        
        void main() {
          vColor = color;
          vAlpha = 0.85;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (400.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D pointTexture;
        varying vec3 vColor;
        varying float vAlpha;
        
        void main() {
          vec4 texColor = texture2D(pointTexture, gl_PointCoord);
          gl_FragColor = vec4(vColor, vAlpha) * texColor;
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    // Animation state
    let startTime = Date.now();
    let animationId: number;

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      
      const elapsed = (Date.now() - startTime) / 1000;
      
      const posAttr = geometry.attributes.position as THREE.BufferAttribute;
      const colAttr = geometry.attributes.color as THREE.BufferAttribute;
      
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        
        // Swarm phase: particles orbit and breathe
        
        // Orbital movement around target position
        const orbitSpeed = 0.3 + (i % 10) * 0.02;
        const orbitRadius = 8 + Math.sin(elapsed * 0.5 + phases[i]) * 4;
        const orbitAngle = elapsed * orbitSpeed + phases[i];
        
        // Calculate orbital offset
        const orbX = Math.cos(orbitAngle) * orbitRadius;
        const orbY = Math.sin(orbitAngle * 0.7 + phases[i]) * orbitRadius;
        const orbZ = Math.sin(orbitAngle * 0.5) * orbitRadius * 0.5;
        
        // Target with orbital offset
        const targetX = targetPositions[i3] + orbX;
        const targetY = targetPositions[i3 + 1] + orbY;
        const targetZ = targetPositions[i3 + 2] + orbZ;
        
        // Smooth movement toward orbital target
        positions[i3] += (targetX - positions[i3]) * 0.02;
        positions[i3 + 1] += (targetY - positions[i3 + 1]) * 0.02;
        positions[i3 + 2] += (targetZ - positions[i3 + 2]) * 0.02;
        
        // Breathing sphere effect - subtle radius pulsing
        const breathe = 1 + Math.sin(elapsed * 0.8) * 0.02;
        const currentDist = Math.sqrt(
          positions[i3] * positions[i3] + 
          positions[i3 + 1] * positions[i3 + 1] + 
          positions[i3 + 2] * positions[i3 + 2]
        );
        const targetDist = Math.sqrt(
          targetPositions[i3] * targetPositions[i3] + 
          targetPositions[i3 + 1] * targetPositions[i3 + 1] + 
          targetPositions[i3 + 2] * targetPositions[i3 + 2]
        ) * breathe;
        
        if (currentDist > 0.1) {
          const scale = (targetDist / currentDist - 1) * 0.01;
          positions[i3] += positions[i3] * scale;
          positions[i3 + 1] += positions[i3 + 1] * scale;
          positions[i3 + 2] += positions[i3 + 2] * scale;
        }
        
        // Color pulsing - creates twinkling effect
        const pulse = 0.6 + Math.sin(elapsed * 2 + phases[i] * 3) * 0.2;
        const brightness = pulse;
        
        colors[i3] = brightness * 0.85;
        colors[i3 + 1] = brightness * 0.2;
        colors[i3 + 2] = brightness * 1.0;
      }
      
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      
      // Gentle rotation of the whole sphere
      particles.rotation.y = elapsed * 0.05;
      particles.rotation.x = Math.sin(elapsed * 0.1) * 0.1;
      
      // Update shader time
      material.uniforms.time.value = elapsed;
      
      renderer.render(scene, camera);
    };

    animate();

    // Handle resize
    const handleResize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
