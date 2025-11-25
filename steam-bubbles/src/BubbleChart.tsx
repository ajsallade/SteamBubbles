import React, { useMemo, useRef, useState, useEffect } from "react";
import * as d3 from "d3";

export type GameViz = {
  appid: number;
  name: string;
  hours: number;
  img: string;
  storeUrl: string;
  manual?: boolean;
};

type Props = {
  games: GameViz[];
  searchTerm: string;
  layoutMode: "packed" | "scatter";
  shuffleSeed: number;
  showHoursLabels: boolean;
  showManualMarkers?: boolean; // NEW
  onToggleHide: (appid: number) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
};

type SizedGame = GameViz & {
  value: number;
  r: number;
};

type LeafNode = {
  data: SizedGame;
  x: number;
  y: number;
  r: number;
};

type ScatterNode = SizedGame & {
  x: number;
  y: number;
  tx?: number;
  ty?: number;
};

// deterministic RNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngForApp(appid: number, seed: number) {
  const combined = (appid * 2654435761 + seed * 1013904223) >>> 0;
  return mulberry32(combined);
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export default function BubbleChart({
  games,
  searchTerm,
  layoutMode,
  shuffleSeed,
  showHoursLabels,
  onProcessingChange,
  showManualMarkers = false,
  onToggleHide,
}: Props) {
  const width = 950;
  const height = 720;
  const outerPad = 36;

  const baseZoom = 1.25;
  const cx = width / 2;
  const cy = height / 2;

  const [hovered, setHovered] = useState<GameViz | null>(null);
  const q = searchTerm.trim().toLowerCase();

  // attempt to prevent reshuffle
  // not sure if actually doing anything
  const scatterPosRef = useRef<Map<number, { x: number; y: number }>>(
    new Map()
  );

  const scatterMaxRRef = useRef<number | null>(null);

  // pan & zoom
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [userZoom, setUserZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    dragging: boolean;
    lastX: number;
    lastY: number;
  }>({ dragging: false, lastX: 0, lastY: 0 });

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * width;
    const my = ((e.clientY - rect.top) / rect.height) * height;

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = clamp(userZoom * zoomFactor, 0.5, 4);

    const k = newZoom / userZoom;
    const newPanX = mx - k * (mx - pan.x);
    const newPanY = my - k * (my - pan.y);

    setUserZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    dragRef.current.dragging = true;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current.dragging) return;
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();

    const dxPx = e.clientX - dragRef.current.lastX;
    const dyPx = e.clientY - dragRef.current.lastY;

    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;

    const dx = (dxPx / rect.width) * width;
    const dy = (dyPx / rect.height) * height;

    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    dragRef.current.dragging = false;
    svg.releasePointerCapture(e.pointerId);
  };

  const resetView = () => {
    setUserZoom(1);
    setPan({ x: 0, y: 0 });
  };

  //size
  const sized: SizedGame[] = useMemo(() => {
    const values = games.map((g) =>
      Number.isFinite(g.hours) && g.hours > 0 ? g.hours : 0
    );
    const maxValue = d3.max(values) ?? 1;

    // for whatever reason .15 fixed collisions
    const maxR = Math.min(width, height) * 0.15;

    const rScale = d3.scaleSqrt().domain([0, maxValue]).range([6, maxR]);

    return games.map((g) => {
      const h = Number.isFinite(g.hours) && g.hours >= 0 ? g.hours : 0;
      return {
        ...g,
        value: h,
        r: rScale(h),
      };
    });
  }, [games, width, height]);

  //packed
  const packedLayout = useMemo(() => {
    if (layoutMode !== "packed") return [] as LeafNode[];

    const ordered = [...sized].sort(
      (a, b) => b.value - a.value || a.appid - b.appid
    );

    const rootData = { name: "root", children: ordered };
    const root = d3
      .hierarchy(rootData as unknown as any)
      .sum((d: any) => d.value || 0);

    const packed = d3
      .pack<any>()
      .size([width - outerPad * 2, height - outerPad * 2])
      .padding(5)(root);

    return packed.leaves().map((d: any) => ({
      data: d.data,
      x: d.x + outerPad,
      y: d.y + outerPad,
      r: d.r,
    }));
  }, [layoutMode, sized, width, height, outerPad]);

  // scatter / blob
  const [scatterLayout, setScatterLayout] = useState<LeafNode[]>([]);

  useEffect(() => {
    if (layoutMode !== "scatter") {
      setScatterLayout([]);
      onProcessingChange?.(false);
    } else {
      onProcessingChange?.(true);

      async function compute() {
        const nodes = await computeNodesAsync();
        setScatterLayout(nodes);
        onProcessingChange?.(false);
      }
      setTimeout(() => {
      compute();
      }, 10);

    }
  }, [layoutMode, sized, width, height, outerPad, shuffleSeed, cx, cy]);

  function computeNodesAsync(/* params */): Promise<LeafNode[]> {
    return new Promise((resolve) => {
      const prevMaxR = scatterMaxRRef.current;
      const maxRNow = d3.max(sized.map((s) => s.r)) ?? 1;

      const significantRadiusChange =
        prevMaxR != null && Math.abs(maxRNow - prevMaxR) / prevMaxR > 0.2;

      let prev = scatterPosRef.current;
      if (significantRadiusChange) prev = new Map();

      const n = sized.length;
      const blobRadius = Math.min(width, height) * 0.32;
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));

      const nodes: ScatterNode[] = sized.map((d, i) => {
        const old = prev.get(d.appid);
        const rng = rngForApp(d.appid, shuffleSeed);

        // bias targets
        const t = n <= 1 ? 0 : i / (n - 1);
        const angle = i * goldenAngle;
        const spiralR = blobRadius * Math.sqrt(t);

        const tx =
          cx + Math.cos(angle) * spiralR + (rng() - 0.5) * width * 0.06;
        const ty =
          cy + Math.sin(angle) * spiralR + (rng() - 0.5) * height * 0.06;

        // start positions
        const startX =
          old?.x ?? tx + (rng() - 0.5) * width * 0.18 + (rng() - 0.5) * 30;
        const startY =
          old?.y ?? ty + (rng() - 0.5) * height * 0.18 + (rng() - 0.5) * 30;

        return { ...d, x: startX, y: startY, tx, ty };
      });

      const pad = 0.9;

      const runTicks = (sim: d3.Simulation<any, any>, ticks: number) => {
        for (let i = 0; i < ticks; i++) sim.tick();
      };

      // scale tick counts by number of bubbles
      // for freezes hopefuuly
      const t1 = clamp(180 + n * 1.5, 220, 520);
      const t2 = clamp(240 + n * 2.0, 320, 720);

      // pull to center and collide
      const sim1 = d3
        .forceSimulation(nodes as any)
        .alpha(1)
        .alphaDecay(0.05)
        .velocityDecay(0.32)
        .force("x", d3.forceX((d: any) => d.tx).strength(0.06))
        .force("y", d3.forceY((d: any) => d.ty).strength(0.06))
        .force("collide", d3.forceCollide((d: any) => d.r + pad).iterations(9))
        .stop();

      runTicks(sim1, t1);

      // stronger collide
      const sim2 = d3
        .forceSimulation(nodes as any)
        .alpha(0.9)
        .alphaDecay(0.03)
        .velocityDecay(0.45)
        .force(
          "collide",
          d3
            .forceCollide((d: any) => d.r + pad)
            .strength(1)
            .iterations(14)
        )
        .stop();

      runTicks(sim2, t2);

      // clamp to bounds
      nodes.forEach((node) => {
        node.x = Math.max(
          node.r + outerPad,
          Math.min(width - node.r - outerPad, node.x)
        );
        node.y = Math.max(
          node.r + outerPad,
          Math.min(height - node.r - outerPad, node.y)
        );
      });

      // tiny cleanup only for smaller N
      if (n <= 140) {
        let overlaps = 0;
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const a = nodes[i],
              b = nodes[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist < a.r + b.r + pad - 0.5) overlaps++;
            if (overlaps > 6) break;
          }
          if (overlaps > 6) break;
        }

        if (overlaps > 0) {
          const sim3 = d3
            .forceSimulation(nodes as any)
            .alpha(0.6)
            .alphaDecay(0.06)
            .velocityDecay(0.5)
            .force("centerX", d3.forceX(cx).strength(0.02))
            .force("centerY", d3.forceY(cy).strength(0.02))
            .force(
              "collide",
              d3
                .forceCollide((d: any) => d.r + pad)
                .strength(1)
                .iterations(18)
            )
            .stop();

          runTicks(sim3, 260);
        }
      }

      const next = new Map<number, { x: number; y: number }>();
      nodes.forEach((node) => next.set(node.appid, { x: node.x, y: node.y }));
      scatterPosRef.current = next;
      scatterMaxRRef.current = maxRNow;

      resolve(
        nodes.map((node) => ({
          data: node,
          x: node.x,
          y: node.y,
          r: node.r,
        }))
      );
    });
  }
  const layoutLeaves = layoutMode === "packed" ? packedLayout : scatterLayout;

  //smooth transitions hopefully
  const prevPosRef = useRef<Map<number, { x: number; y: number; r: number }>>(
    new Map()
  );
  const [displayLeaves, setDisplayLeaves] = useState<LeafNode[]>([]);

  useEffect(() => {
    const prevMap = prevPosRef.current;

    const nextLeaves = layoutLeaves.map((l) => {
      const p = prevMap.get(l.data.appid);
      return p ? { ...l } : l;
    });

    const newPrev = new Map<number, { x: number; y: number; r: number }>();
    nextLeaves.forEach((l) =>
      newPrev.set(l.data.appid, { x: l.x, y: l.y, r: l.r })
    );
    prevPosRef.current = newPrev;

    setDisplayLeaves(nextLeaves);
  }, [layoutLeaves]);

  const baseTransform = `translate(${cx},${cy}) scale(${baseZoom}) translate(${-cx},${-cy})`;
  const userTransform = `translate(${pan.x},${pan.y}) scale(${userZoom})`;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={resetView}
        style={{
          width: "100%",
          height: "100%",
          background: "#0b0f14",
          display: "block",
          overflow: "visible",
          touchAction: "none",
          cursor: dragRef.current.dragging ? "grabbing" : "grab",
        }}>
        <g transform={baseTransform}>
          <g transform={userTransform}>
            {displayLeaves.map((l, i) => {
              const g = l.data;
              const match = q && g.name.toLowerCase().includes(q);
              const labelSize = Math.max(8, Math.min(18, l.r / 3));

              return (
                <g
                  key={g.appid}
                  onMouseEnter={() => setHovered(g)}
                  onMouseLeave={() => setHovered(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onToggleHide(g.appid);
                  }}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      e.preventDefault();
                      onToggleHide(g.appid);
                      return;
                    }
                    window.open(g.storeUrl, "_blank");
                  }}
                  style={{
                    cursor: "pointer",
                    transform: `translate(${l.x}px, ${l.y}px)`,
                    transition: "transform 600ms ease, opacity 250ms ease",
                    transformBox: "fill-box",
                    transformOrigin: "center",
                  }}>
                  <defs>
                    <clipPath id={`clip-${layoutMode}-${i}`}>
                      <circle r={l.r} />
                    </clipPath>
                  </defs>

                  <circle
                    r={l.r}
                    fill="#1b2838"
                    stroke={match ? "#ffd166" : "#2a475e"}
                    strokeWidth={match ? 4 : 1.5}
                  />

                  <image
                    href={g.img}
                    x={-l.r}
                    y={-l.r}
                    width={2 * l.r}
                    height={2 * l.r}
                    clipPath={`url(#clip-${layoutMode}-${i})`}
                    preserveAspectRatio="xMidYMid slice"
                    opacity={0.92}
                  />

                  {showHoursLabels && g.hours > 0 && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={labelSize}
                      fill="white"
                      stroke="black"
                      strokeWidth={2}
                      paintOrder="stroke"
                      style={{ pointerEvents: "none", userSelect: "none" }}>
                      {g.hours.toFixed(1)}h
                    </text>
                  )}

                  {/* NEW: manual marker */}
                  {showManualMarkers && g.manual && (
                    <circle
                      cx={l.r * 0.62}
                      cy={-l.r * 0.62}
                      r={Math.max(2.5, l.r * 0.12)}
                      fill="#ffd166"
                      stroke="rgba(0,0,0,0.7)"
                      strokeWidth={1}
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {hovered && (
        <div
          style={{
            position: "absolute",
            right: 12,
            top: 12,
            background: "#111820",
            border: "1px solid #2a475e",
            padding: "10px 12px",
            borderRadius: 8,
            width: 260,
            color: "white",
          }}>
          <div style={{ fontWeight: 700 }}>{hovered.name}</div>
          <div style={{ opacity: 0.85, marginTop: 4 }}>
            {hovered.hours.toFixed(1)} hours played
          </div>

          <button
            onClick={() => onToggleHide(hovered.appid)}
            style={{
              marginTop: 8,
              padding: "6px 8px",
              background: "#0b0f14",
              color: "white",
              border: "1px solid #2a475e",
              borderRadius: 6,
              cursor: "pointer",
            }}>
            Hide this game
          </button>

          <div style={{ opacity: 0.6, marginTop: 8 }}>
            Scroll: zoom
            <br />
            Drag: pan
            <br />
            Double-click: reset view
          </div>
        </div>
      )}
    </div>
  );
}
