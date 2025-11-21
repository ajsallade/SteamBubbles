import React, { useMemo, useRef, useState, useEffect } from "react";
import * as d3 from "d3";

export type GameViz = {
  appid: number;
  name: string;
  hours: number;
  img: string;
  storeUrl: string;
  genre?: string;
};

type Props = {
  games: GameViz[];
  groupByGenre: boolean;
  searchTerm: string;
  layoutMode: "packed" | "scatter";
  shuffleSeed: number;
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

type ParentNode = {
  name: string;
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

export default function BubbleChart({
  games,
  groupByGenre,
  searchTerm,
  layoutMode,
  shuffleSeed
}: Props) {
  const width = 950;
  const height = 720;
  const outerPad = 36;

  // VISUAL ZOOM (does NOT change layout math)
  const zoom = 1.25; // tweak this only
  const cx = width / 2;
  const cy = height / 2;

  const [hovered, setHovered] = useState<GameViz | null>(null);
  const q = searchTerm.trim().toLowerCase();

  // LINEAR ONLY; keep maxR at your perfect overlap setting
  const sized: SizedGame[] = useMemo(() => {
    const values = games.map(g => g.hours);
    const maxValue = d3.max(values) ?? 1;

    // KEEP THIS at 0.15 (your perfect overlap)
    const maxR = Math.min(width, height) * 0.15;

    const rScale = d3
      .scaleSqrt()
      .domain([0, maxValue])
      .range([6, maxR]);

    return games.map(g => ({
      ...g,
      value: g.hours,
      r: rScale(g.hours)
    }));
  }, [games, width, height]);

  // PACKED layout
  const packedLayout = useMemo(() => {
    if (layoutMode !== "packed") {
      return { leaves: [] as LeafNode[], parents: [] as ParentNode[] };
    }

    const rootData = groupByGenre
      ? {
          name: "root",
          children: Array.from(
            d3.group(sized, d => d.genre || "Other"),
            ([genre, items]) => ({ name: genre, children: items })
          )
        }
      : { name: "root", children: sized };

    const root = d3
      .hierarchy(rootData as any)
      .sum((d: any) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const packed = d3
      .pack<any>()
      .size([width - outerPad * 2, height - outerPad * 2])
      .padding(5)(root);

    const leaves: LeafNode[] = packed.leaves().map((d: any) => ({
      data: d.data,
      x: d.x + outerPad,
      y: d.y + outerPad,
      r: d.r
    }));

    const parents: ParentNode[] = groupByGenre
      ? packed
          .descendants()
          .filter((d: any) => d.depth === 1)
          .map((p: any) => ({
            name: p.data.name,
            x: p.x + outerPad,
            y: p.y + outerPad,
            r: p.r
          }))
      : [];

    return { leaves, parents };
  }, [layoutMode, groupByGenre, sized, width, height, outerPad]);

  // SCATTER / BLOB (edge-to-edge, no overlaps)
  const scatterLayout = useMemo(() => {
    if (layoutMode !== "scatter") return [] as LeafNode[];

    const nodes: ScatterNode[] = sized.map(d => ({
      ...d,
      x: Math.random() * width,
      y: Math.random() * height
    }));

    nodes.forEach(n => {
      n.tx = width / 2 + (Math.random() - 0.5) * width * 0.30;
      n.ty = height / 2 + (Math.random() - 0.5) * height * 0.30;
    });

    const pad = 0.5;

    const sim1 = d3
      .forceSimulation(nodes as any)
      .alpha(1)
      .velocityDecay(0.32)
      .force("charge", d3.forceManyBody().strength(-2.5))
      .force("x", d3.forceX((d: any) => d.tx).strength(0.14))
      .force("y", d3.forceY((d: any) => d.ty).strength(0.14))
      .force(
        "collide",
        d3.forceCollide((d: any) => d.r + pad).iterations(6)
      )
      .stop();

    for (let i = 0; i < 420; i++) sim1.tick();

    const sim2 = d3
      .forceSimulation(nodes as any)
      .alpha(0.8)
      .velocityDecay(0.35)
      .force(
        "collide",
        d3.forceCollide((d: any) => d.r + pad).strength(1).iterations(10)
      )
      .stop();

    for (let i = 0; i < 520; i++) sim2.tick();

    nodes.forEach(n => {
      n.x = Math.max(n.r + outerPad, Math.min(width - n.r - outerPad, n.x));
      n.y = Math.max(n.r + outerPad, Math.min(height - n.r - outerPad, n.y));
    });

    return nodes.map(n => ({
      data: n,
      x: n.x,
      y: n.y,
      r: n.r
    }));
  }, [layoutMode, sized, width, height, outerPad, shuffleSeed]);

  const layoutLeaves =
    layoutMode === "packed" ? packedLayout.leaves : scatterLayout;

  const layoutParents =
    layoutMode === "packed" ? packedLayout.parents : [];

  // smooth movement between slider changes
  const prevPosRef = useRef<Map<number, { x: number; y: number; r: number }>>(
    new Map()
  );

  const [displayLeaves, setDisplayLeaves] = useState<LeafNode[]>([]);
  const [displayParents, setDisplayParents] = useState<ParentNode[]>([]);

  useEffect(() => {
    const prev = prevPosRef.current;
    const nextLeaves = layoutLeaves.map(l => {
      const p = prev.get(l.data.appid);
      return p ? { ...l } : l;
    });

    const newPrev = new Map<number, { x: number; y: number; r: number }>();
    nextLeaves.forEach(l =>
      newPrev.set(l.data.appid, { x: l.x, y: l.y, r: l.r })
    );
    prevPosRef.current = newPrev;

    setDisplayLeaves(nextLeaves);
    setDisplayParents(layoutParents);
  }, [layoutLeaves, layoutParents]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: "100%",
          height: "100%",
          background: "#0b0f14",
          display: "block",
          overflow: "visible" // so zoom doesn't clip
        }}
      >
        {/* VISUAL ZOOM WRAPPER */}
        <g transform={`translate(${cx},${cy}) scale(${zoom}) translate(${-cx},${-cy})`}>
          {displayParents.map((p, i) => (
            <g
              key={`parent-${p.name}-${i}`}
              style={{
                transform: `translate(${p.x}px, ${p.y}px)`,
                transition: "transform 600ms ease"
              }}
            >
              <circle
                r={p.r}
                fill="none"
                stroke="#35506b"
                strokeWidth={2}
                opacity={0.7}
              />
            </g>
          ))}

          {displayLeaves.map((l, i) => {
            const g = l.data;
            const match = q && g.name.toLowerCase().includes(q);

            return (
              <g
                key={g.appid}
                onMouseEnter={() => setHovered(g)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => window.open(g.storeUrl, "_blank")}
                style={{
                  cursor: "pointer",
                  transform: `translate(${l.x}px, ${l.y}px)`,
                  transition: "transform 600ms ease, opacity 250ms ease",
                  transformBox: "fill-box",
                  transformOrigin: "center"
                }}
              >
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
              </g>
            );
          })}
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
            color: "white"
          }}
        >
          <div style={{ fontWeight: 700 }}>{hovered.name}</div>
          <div style={{ opacity: 0.85, marginTop: 4 }}>
            {hovered.hours.toFixed(1)} hours played
          </div>
          {hovered.genre && groupByGenre && layoutMode === "packed" && (
            <div style={{ opacity: 0.75, marginTop: 4 }}>
              Genre: {hovered.genre}
            </div>
          )}
          <div style={{ opacity: 0.6, marginTop: 8 }}>
            Click bubble to open store page
          </div>
        </div>
      )}
    </div>
  );
}
