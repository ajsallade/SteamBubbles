import React, { useEffect, useMemo, useState } from "react";
import BubbleChart from "./BubbleChart";
import type { GameViz } from "./BubbleChart";

const BACKEND = "http://localhost:5174";

export default function App() {
  const [me, setMe] = useState<any>(null);
  const [rawGames, setRawGames] = useState<any[]>([]);
  const [games, setGames] = useState<GameViz[]>([]);
  const [error, setError] = useState("");

  // Top-N slider debounce
  const [topNInput, setTopNInput] = useState<number>(100);
  const [topN, setTopN] = useState<number>(100);

  const [showAll, setShowAll] = useState<boolean>(false);
  const [groupByGenre, setGroupByGenre] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");

  const [layoutMode, setLayoutMode] = useState<"packed" | "scatter">("packed");

  // shuffle seed for scatter randomness
  const [shuffleSeed, setShuffleSeed] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setTopN(topNInput), 120);
    return () => clearTimeout(id);
  }, [topNInput]);

  // check login state
  useEffect(() => {
    fetch(`${BACKEND}/api/me`, { credentials: "include" })
      .then(r => r.json())
      .then(setMe)
      .catch(() => setMe({ loggedIn: false }));
  }, []);

  async function loadMyGames() {
    setError("");
    setRawGames([]);
    setGames([]);

    const r = await fetch(`${BACKEND}/api/owned-games`, {
      credentials: "include"
    });
    const data = await r.json();

    const list = data?.response?.games ?? [];
    if (!list.length) {
      setError(
        "No games returned. Your Steam 'Game Details' privacy must be Public."
      );
      return;
    }
    setRawGames(list);
  }

  // build viz objects safely + optional genre enrichment
  useEffect(() => {
    if (!rawGames.length) return;

    const base: GameViz[] = rawGames
      .filter(g => g && g.appid && g.name)
      .map(g => {
        const minutes = Number(g.playtime_forever ?? 0);
        const hours = Number.isFinite(minutes) ? minutes / 60 : 0;
        return {
          appid: g.appid,
          name: g.name,
          hours,
          img: `https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
          storeUrl: `https://store.steampowered.com/app/${g.appid}/`
        };
      });

    // scatter layout ignores genre clustering
    if (!groupByGenre || layoutMode === "scatter") {
      setGames(base);
      return;
    }

    (async () => {
      try {
        const appids = base.map(b => b.appid);
        const r = await fetch(`${BACKEND}/api/appdetails-batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appids })
        });
        const details = await r.json();

        const withGenres = base.map(b => {
          const d = details?.[b.appid];
          const primary = d?.genres?.[0] || "Other";
          return { ...b, genre: primary };
        });

        setGames(withGenres);
      } catch {
        setError("Genre lookup failed, showing ungrouped bubbles.");
        setGames(base);
      }
    })();
  }, [rawGames, groupByGenre, layoutMode]);

  const filtered = useMemo(() => {
    const sorted = [...games].sort((a, b) => b.hours - a.hours);
    if (showAll) return sorted;
    return sorted.slice(0, Math.max(5, topN));
  }, [games, topN, showAll]);

  function downloadSvg() {
    const svg = document.querySelector("svg");
    if (!svg) return;
    const serializer = new XMLSerializer();
    const str = serializer.serializeToString(svg);
    const blob = new Blob([str], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "steam-bubbles.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      style={{
        color: "white",
        fontFamily: "system-ui",
        background: "#0b0f14",
        height: "100vh",
        display: "flex",
        flexDirection: "column"
      }}
    >
      {/* Header / controls */}
      <div style={{ padding: 16 }}>
        <h1 style={{ marginBottom: 8 }}>Steam Bubbles</h1>

        {!me?.loggedIn ? (
          <a href={`${BACKEND}/auth/steam`}>
            <button style={{ padding: 10, marginBottom: 12 }}>
              Sign in with Steam
            </button>
          </a>
        ) : (
          <div style={{ marginBottom: 12 }}>
            Logged in as: <b>{me.user.displayName}</b>
            <button
              onClick={loadMyGames}
              style={{ marginLeft: 10, padding: 8 }}
            >
              Load my games
            </button>
          </div>
        )}

        {games.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              alignItems: "center",
              marginBottom: 12,
              padding: 10,
              background: "#111820",
              border: "1px solid #233447",
              borderRadius: 10
            }}
          >
            <label>
              Top N:
              <input
                type="range"
                min={10}
                max={300}
                step={10}
                value={topNInput}
                onChange={e => setTopNInput(Number(e.target.value))}
                disabled={showAll}
                style={{ marginLeft: 8 }}
              />
              <span style={{ marginLeft: 8 }}>
                {showAll ? "All" : topNInput}
              </span>
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={showAll}
                onChange={e => setShowAll(e.target.checked)}
              />
              Show all games
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={groupByGenre}
                onChange={e => setGroupByGenre(e.target.checked)}
                disabled={layoutMode === "scatter"}
                title={
                  layoutMode === "scatter"
                    ? "Genre clustering only applies to Packed layout."
                    : ""
                }
              />
              Cluster by genre
            </label>

            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Layout:
              <select
                value={layoutMode}
                onChange={e => setLayoutMode(e.target.value as any)}
              >
                <option value="packed">Packed</option>
                <option value="scatter">Blob / Scatter</option>
              </select>
            </label>

            {/* Shuffle for scatter */}
            <button
              onClick={() => setShuffleSeed(s => s + 1)}
              disabled={layoutMode !== "scatter"}
              style={{ padding: "6px 10px" }}
              title={
                layoutMode !== "scatter"
                  ? "Shuffle only affects Blob/Scatter"
                  : "Shuffle blob layout"
              }
            >
              Shuffle
            </button>

            <input
              placeholder="Search a game..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                padding: 6,
                minWidth: 220,
                borderRadius: 6,
                border: "1px solid #2a475e",
                background: "#0b0f14",
                color: "white"
              }}
            />

            <button onClick={downloadSvg} style={{ padding: "6px 10px" }}>
              Download SVG
            </button>
          </div>
        )}

        {error && (
          <p style={{ color: "salmon", marginTop: 6, marginBottom: 10 }}>
            {error}
          </p>
        )}
      </div>

      {/* Chart area fills remaining screen */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {filtered.length > 0 && (
          <BubbleChart
            games={filtered}
            groupByGenre={groupByGenre && layoutMode === "packed"}
            searchTerm={searchTerm}
            layoutMode={layoutMode}
            shuffleSeed={shuffleSeed}
          />
        )}
      </div>
    </div>
  );
}
