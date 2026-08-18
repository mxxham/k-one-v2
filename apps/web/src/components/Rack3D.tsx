import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface Bin3D {
  location_code: string;
  aisle: string;
  rack: string;
  level: string;
  position: string;
  zone_code: string | null;
  is_pick_face: number;
  equipment_accessible: number;
  occupied: number;
  quantity: number;
  pallet_function: string | null;
  product_code: string | null;
  product_name: string | null;
  batch_number: string | null;
  blocked: number;
  block_reason: string | null;
}

const AISLES = ['CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG'];
const LEVEL_Y: Record<string, number> = { A: 0.95, B: 3.15, C: 5.35, D: 7.55, E: 9.75 };
const AISLE_GAP = 9;
const BAY_GAP = 2.6;
const BIN_W = 1.1;
const BIN_H = 1.9;
const BIN_D = 2.2;

export const ZONE_COLORS: Record<string, string> = {
  PICK_FAST: '#10b981',
  RESERVE: '#f59e0b',
  BULK: '#3b82f6',
  QUARANTINE: '#a855f7',
  STAGING: '#ec4899',
  UNALLOCATED: '#64748b',
};

export const FUNCTION_COLORS: Record<string, string> = {
  PICK_FACE: ZONE_COLORS.PICK_FAST,
  RESERVE: ZONE_COLORS.BULK,
  MIXED: '#7c3aed',
};

export function functionColor(fn?: string | null): string {
  return FUNCTION_COLORS[String(fn ?? '').toUpperCase()] ?? '';
}

export function zoneColor(zone?: string | null, occupied = true): string {
  if (!occupied) return '#475569';
  return ZONE_COLORS[String(zone ?? '').toUpperCase()] || '#94a3b8';
}

interface Layout {
  byCode: Record<string, [number, number, number]>;
}

export function bayNumber(rack: string): number {
  const m = /(\d+)$/.exec(rack || '');
  const n = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(n) ? n : 1;
}

export function computeLayout(bins: Bin3D[]): Layout {
  const byCode: Record<string, [number, number, number]> = {};
  const maxBayPerAisle: Record<string, number> = {};
  for (const b of bins) {
    const n = bayNumber(b.rack);
    maxBayPerAisle[b.aisle] = Math.max(maxBayPerAisle[b.aisle] ?? 1, n);
  }
  for (const b of bins) {
    const ai = AISLES.indexOf(b.aisle);
    if (ai < 0) continue;
    const bay = bayNumber(b.rack);
    const maxBay = maxBayPerAisle[b.aisle] ?? 1;
    const x = (ai - (AISLES.length - 1) / 2) * AISLE_GAP + (b.position === '01' ? -0.6 : 0.6);
    const z = (bay - (maxBay - 1) / 2) * BAY_GAP;
    const y = LEVEL_Y[b.level] ?? 0.95;
    byCode[b.location_code] = [x, y, z];
  }
  return { byCode };
}

interface BinMeshProps {
  bin: Bin3D;
  pos: [number, number, number];
  hovered: boolean;
  selected: boolean;
  onHover: (code: string | null) => void;
  onSelect: (code: string) => void;
}

const BinMesh = memo(function BinMesh({ bin, pos, hovered, selected, onHover, onSelect }: BinMeshProps) {
  const occupied = bin.occupied === 1;
  const blocked = bin.blocked === 1;
  const baseColor = blocked ? '#dc2626' : (occupied ? functionColor(bin.pallet_function) : '') || zoneColor(bin.zone_code, occupied);
  return (
    <mesh
      position={pos}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(bin.location_code);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(bin.location_code);
      }}
    >
      <boxGeometry args={[BIN_W, BIN_H, BIN_D]} />
      <meshStandardMaterial
        color={baseColor}
        emissive={selected || hovered ? baseColor : '#000000'}
        emissiveIntensity={selected ? 0.55 : hovered ? 0.35 : 0}
        transparent={!occupied && !blocked}
        opacity={occupied || blocked ? 1 : 0.12}
        depthWrite={occupied || blocked}
        roughness={0.6}
        metalness={0.05}
      />
    </mesh>
  );
});

function OrbitControlsWrapper() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.target.set(0, 4.5, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 6;
    controls.maxDistance = 140;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();
    controlsRef.current = controls;
    return () => {
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl]);

  useFrame(() => {
    controlsRef.current?.update();
  }, -1);

  return null;
}

interface Rack3DProps {
  bins: Bin3D[];
  onHover: (bin: Bin3D | null) => void;
  onSelect: (bin: Bin3D | null) => void;
  selectedKey: string | null;
}

export default function Rack3D({ bins, onHover, onSelect, selectedKey }: Rack3DProps) {
  const layout = useMemo(() => computeLayout(bins), [bins]);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const handleHover = (code: string | null) => {
    setHoverKey(code);
    onHover(code ? bins.find((b) => b.location_code === code) || null : null);
  };

  const handleSelect = (code: string) => {
    onSelect(bins.find((b) => b.location_code === code) || null);
  };

  const rendered = useMemo(() => {
    const out: Array<{ bin: Bin3D; pos: [number, number, number] }> = [];
    for (const b of bins) {
      const p = layout.byCode[b.location_code];
      if (p) out.push({ bin: b, pos: p });
    }
    return out;
  }, [bins, layout]);

  return (
    <Canvas camera={{ position: [0, 22, 52], fov: 42 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true }}>
      <color attach="background" args={['#0f172a']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[30, 70, 25]} intensity={1.15} />
      <directionalLight position={[-30, 30, -25]} intensity={0.35} />
      <OrbitControlsWrapper />
      <group>
        {rendered.map(({ bin, pos }) => (
          <BinMesh
            key={bin.location_code}
            bin={bin}
            pos={pos}
            hovered={hoverKey === bin.location_code}
            selected={selectedKey === bin.location_code}
            onHover={handleHover}
            onSelect={handleSelect}
          />
        ))}
      </group>
      <gridHelper args={[130, 44, '#334155', '#1e293b']} position={[0, -0.02, 0]} />
    </Canvas>
  );
}