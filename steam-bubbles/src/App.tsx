import { useEffect, useMemo, useState } from "react";
import BubbleChart from "./BubbleChart";
import type { GameViz } from "./BubbleChart";

const BACKEND =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:5174";

type MergeMap = Record<number, number>;
type ManualGame = {
  appid: number;
  hours: number;
  name?: string;
  img?: string;
};


// Accept SteamID64, vanity, or steamcommunity link
function normalizeSteamInput(input: string) {
  const s = input.trim();
  if (!s) return s;

  try {
    const u = new URL(s);
    if (u.hostname.includes("steamcommunity.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] === "profiles" && parts[1]) return parts[1];
      if (parts[0] === "id" && parts[1]) return parts[1];
    }
  } catch {
    // not a URL
  }

  return s.replace(/\/+$/, "");
}

export default function App() {
  const [me, setMe] = useState<any>(null);
  const [rawGames, setRawGames] = useState<any[]>([]);
  const [unmergedGames, setUnmergedGames] = useState<GameViz[]>([]);
  const [games, setGames] = useState<GameViz[]>([]);
  const [error, setError] = useState("");

  const [topNInput, setTopNInput] = useState<number>(100);
  const [topN, setTopN] = useState<number>(100);

  const [showAll, setShowAll] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>("");

  const [layoutMode, setLayoutMode] =
    useState<"packed" | "scatter">("scatter");

  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [showHoursLabels, setShowHoursLabels] = useState(false);


  // manual input
  const [steamIdInput, setSteamIdInput] = useState(() => {
    try {
      return localStorage.getItem("manualSteamId") || "";
    } catch {
      return "";
    }
  });
  const [manualLoading, setManualLoading] = useState(false);

  // Hidden games persisted in localStorage
  const [hiddenAppids, setHiddenAppids] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem("hiddenAppids");
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.map(Number));
      return new Set();
    } catch {
      return new Set();
    }
  });

  const [selectedHiddenAppid, setSelectedHiddenAppid] = useState<number | "">("");

  // Merge map persisted in localStorage
  const [mergeMap, setMergeMap] = useState<MergeMap>(() => {
    try {
      const raw = localStorage.getItem("mergeMap");
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  });

  const [mergeFrom, setMergeFrom] = useState<number | "">("");
  const [mergeTo, setMergeTo] = useState<number | "">("");

  // Manual games persisted in localStorage
  const [manualGames, setManualGames] = useState<ManualGame[]>(() => {
    try {
      const raw = localStorage.getItem("manualGames");
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  });

  const [manualAppidInput, setManualAppidInput] = useState("");
  const [manualHoursInput, setManualHoursInput] = useState("");

  const [showManualMarkers, setShowManualMarkers] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("hiddenAppids", JSON.stringify([...hiddenAppids]));
    } catch {}
  }, [hiddenAppids]);

  useEffect(() => {
    try {
      localStorage.setItem("mergeMap", JSON.stringify(mergeMap));
    } catch {}
  }, [mergeMap]);

  useEffect(() => {
    try {
      localStorage.setItem("manualGames", JSON.stringify(manualGames));
    } catch {}
  }, [manualGames]);

  function toggleHide(appid: number) {
    setHiddenAppids(prev => {
      const next = new Set(prev);
      if (next.has(appid)) next.delete(appid);
      else next.add(appid);
      return next;
    });
  }

  function clearHidden() {
    setHiddenAppids(new Set());
    setSelectedHiddenAppid("");
  }

  function findMergeRoot(appid: number, map: MergeMap) {
    const seen = new Set<number>();
    let cur = appid;
    while (map[cur] != null && !seen.has(cur)) {
      seen.add(cur);
      cur = map[cur];
    }
    return cur;
  }

  function addMerge() {
    if (mergeFrom === "" || mergeTo === "" || mergeFrom === mergeTo) return;

    const rootTo = findMergeRoot(mergeTo, {
      ...mergeMap,
      [mergeFrom]: mergeTo
    });
    if (rootTo === mergeFrom) {
      setError("That merge would create a loop.");
      return;
    }

    setMergeMap(prev => ({ ...prev, [mergeFrom]: mergeTo }));
    setMergeFrom("");
    setMergeTo("");
  }

  function removeMerge(fromAppid: number) {
    setMergeMap(prev => {
      const next = { ...prev };
      delete next[fromAppid];
      return next;
    });
  }

  function clearMerges() {
    setMergeMap({});
    setMergeFrom("");
    setMergeTo("");
  }

  async function addManualGame() {
    setError("");
    const appid = Number(manualAppidInput.trim());
    const hours = Number(manualHoursInput.trim());

    if (!Number.isFinite(appid) || appid <= 0) {
      setError("Enter a valid AppID.");
      return;
    }
    if (!Number.isFinite(hours) || hours < 0) {
      setError("Enter valid hours.");
      return;
    }

    let name = `App ${appid}`;
    let img = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;

    try {
      const r = await fetch(`${BACKEND}/api/appdetails-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appids: [appid] })
      });
      const j = await r.json();
      const d = j?.[appid];
      if (d?.name) name = d.name;
      if (d?.header_image) img = d.header_image;
    } catch {
      // ignore
    }

    setManualGames(prev => {
      const next = [...prev];
      const idx = next.findIndex(m => m.appid === appid);
      if (idx >= 0) next[idx] = { appid, hours, name, img };
      else next.push({ appid, hours, name, img });
      return next;
    });

    setManualAppidInput("");
    setManualHoursInput("");
  }

  function removeManualGame(appid: number) {
    setManualGames(prev => prev.filter(m => m.appid !== appid));
  }

  function clearManualGames() {
    setManualGames([]);
  }

  useEffect(() => {
    const id = setTimeout(() => setTopN(topNInput), 120);
    return () => clearTimeout(id);
  }, [topNInput]);

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
        "No games returned. Steam 'Game Details' must be Public."
      );
      return;
    }
    setRawGames(list);
  }

  async function loadGamesById() {
    const normalized = normalizeSteamInput(steamIdInput);
    if (!normalized) return;

    setManualLoading(true);
    setError("");
    setRawGames([]);
    setGames([]);

    try {
      const r = await fetch(
        `${BACKEND}/api/owned-games?steamid=${encodeURIComponent(normalized)}`,
        { credentials: "include" }
      );
      const data = await r.json();

      if (!r.ok) {
        setError(data?.error || "Failed to load games for that ID.");
        return;
      }

      const list = data?.response?.games ?? [];
      if (!list.length) {
        setError(
          "No games returned. That user's 'Game Details' must be Public."
        );
        return;
      }

      setRawGames(list);
      try {
        localStorage.setItem("manualSteamId", normalized);
      } catch {}
    } catch {
      setError("Failed to load games.");
    } finally {
      setManualLoading(false);
    }
  }

  useEffect(() => {
    if (!rawGames.length && manualGames.length === 0) return;

    // owned games
    const owned: GameViz[] = rawGames
      .filter(g => g && g.appid && g.name)
      .map(g => {
        const minutes = Number(g.playtime_forever ?? 0);
        const hoursRaw = Number.isFinite(minutes) ? minutes / 60 : 0;
        const hours =
          Number.isFinite(hoursRaw) && hoursRaw >= 0 ? hoursRaw : 0;

        return {
          appid: g.appid,
          name: g.name,
          hours,
          img: `https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
          storeUrl: `https://store.steampowered.com/app/${g.appid}/`,
          manual: false
        };
      });

    // manual games (can overlap appids, merge later)
    const manualList: GameViz[] = manualGames.map(m => ({
      appid: m.appid,
      name: m.name || `App ${m.appid}`,
      hours: m.hours,
      img: m.img || `https://cdn.akamai.steamstatic.com/steam/apps/${m.appid}/header.jpg`,
      storeUrl: `https://store.steampowered.com/app/${m.appid}/`,
      manual: true
    }));

    const base = [...owned, ...manualList];
    setUnmergedGames(base);

  
    const metaLookup = new Map<number, GameViz>();
    for (const g of base) {
      if (!metaLookup.has(g.appid)) metaLookup.set(g.appid, g);
      else {
        const cur = metaLookup.get(g.appid)!;
        if (cur.manual && !g.manual) metaLookup.set(g.appid, g);
      }
    }

    // apply merges & also combine duplicate appids
    const merged = new Map<number, GameViz>();

    for (const g of base) {
      const root = findMergeRoot(g.appid, mergeMap);
      const meta = metaLookup.get(root) || g;

      const existing = merged.get(root);
      if (existing) {
        existing.hours += g.hours;
        existing.manual = existing.manual || g.manual;
      } else {
        merged.set(root, {
          ...meta,
          hours: g.hours,
          manual: g.manual
        });
      }
    }

    setGames([...merged.values()]);
  }, [rawGames, manualGames, mergeMap]);

  const hiddenGamesList = useMemo(
    () => games.filter(g => hiddenAppids.has(g.appid)),
    [games, hiddenAppids]
  );

  const visibleGames = useMemo(
    () => games.filter(g => !hiddenAppids.has(g.appid)),
    [games, hiddenAppids]
  );

  // selection stays "top by hours" like now
  const selection = useMemo(() => {
    const sorted = [...visibleGames].sort((a, b) => b.hours - a.hours);
    if (showAll) return sorted;
    return sorted.slice(0, Math.max(5, topN));
  }, [visibleGames, topN, showAll]);


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

  const allForMerge = useMemo(
    () => [...unmergedGames].sort((a, b) => a.name.localeCompare(b.name)),
    [unmergedGames]
  );

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
      <div style={{ padding: 16 }}>
        <h1 style={{ marginBottom: 8 }}>Steam Bubbles</h1>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
          {!me?.loggedIn ? (
            <a href={`${BACKEND}/auth/steam`}>
              <button style={{ padding: 10 }}>
                Sign in with Steam
              </button>
            </a>
          ) : (
            <div>
              Logged in as: <b>{me.user.displayName}</b>
              <button
                onClick={loadMyGames}
                style={{ marginLeft: 10, padding: 8 }}
              >
                Load my games
              </button>
            </div>
          )}

          <div style={{ opacity: 0.7, fontWeight: 700 }}>OR</div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              placeholder="SteamID64, vanity, or Steam link"
              value={steamIdInput}
              onChange={(e) => setSteamIdInput(e.target.value)}
              style={{
                padding: 8,
                minWidth: 280,
                borderRadius: 6,
                border: "1px solid #2a475e",
                background: "#0b0f14",
                color: "white"
              }}
            />
            <button
              onClick={loadGamesById}
              disabled={!steamIdInput.trim() || manualLoading}
              style={{ padding: "8px 12px" }}
            >
              {manualLoading ? "Loading..." : "Load by ID"}
            </button>
          </div>
        </div>

        <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 12 }}>
          Manual ID works only if the user's Steam "Game Details" privacy is public.
        </div>

        {/* Merge UI */}
        {unmergedGames.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              marginBottom: 12,
              padding: 10,
              background: "#111820",
              border: "1px solid #233447",
              borderRadius: 10
            }}
          >
            <div style={{ fontWeight: 700, marginRight: 6 }}>
              Merge games:
            </div>

            <select
              value={mergeFrom}
              onChange={(e) =>
                setMergeFrom(e.target.value === "" ? "" : Number(e.target.value))
              }
              style={{
                padding: 6,
                borderRadius: 6,
                border: "1px solid #2a475e",
                background: "#0b0f14",
                color: "white",
                minWidth: 220
              }}
            >
              <option value="">From (playtest)</option>
              {allForMerge.map(g => (
                <option key={g.appid} value={g.appid}>
                  {g.name}
                </option>
              ))}
            </select>

            <select
              value={mergeTo}
              onChange={(e) =>
                setMergeTo(e.target.value === "" ? "" : Number(e.target.value))
              }
              style={{
                padding: 6,
                borderRadius: 6,
                border: "1px solid #2a475e",
                background: "#0b0f14",
                color: "white",
                minWidth: 220
              }}
            >
              <option value="">Into (full game)</option>
              {allForMerge
                .filter(g => g.appid !== mergeFrom)
                .map(g => (
                  <option key={g.appid} value={g.appid}>
                    {g.name}
                  </option>
                ))}
            </select>

            <button
              onClick={addMerge}
              disabled={mergeFrom === "" || mergeTo === ""}
              style={{ padding: "6px 10px" }}
            >
              Merge
            </button>

            {Object.keys(mergeMap).length > 0 && (
              <button
                onClick={clearMerges}
                style={{ padding: "6px 10px" }}
              >
                Clear merges
              </button>
            )}

            {Object.keys(mergeMap).length > 0 && (
              <div style={{ width: "100%", marginTop: 6, fontSize: 13, opacity: 0.8 }}>
                {Object.entries(mergeMap).map(([fromStr, toNum]) => {
                  const from = Number(fromStr);
                  const fromName = unmergedGames.find(g => g.appid === from)?.name || fromStr;
                  const toName = unmergedGames.find(g => g.appid === toNum)?.name || String(toNum);
                  return (
                    <div key={from} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span>
                        {fromName} → {toName}
                      </span>
                      <button
                        onClick={() => removeMerge(from)}
                        style={{ padding: "2px 6px", fontSize: 12 }}
                      >
                        X
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Manual add UI */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            marginBottom: 12,
            padding: 10,
            background: "#111820",
            border: "1px solid #233447",
            borderRadius: 10
          }}
        >
          <div style={{ fontWeight: 700 }}>Manually add a game:</div>

          <input
            placeholder="AppID"
            value={manualAppidInput}
            onChange={(e) => setManualAppidInput(e.target.value)}
            style={{
              padding: 6,
              width: 110,
              borderRadius: 6,
              border: "1px solid #2a475e",
              background: "#0b0f14",
              color: "white"
            }}
          />

          <input
            placeholder="Hours"
            value={manualHoursInput}
            onChange={(e) => setManualHoursInput(e.target.value)}
            style={{
              padding: 6,
              width: 90,
              borderRadius: 6,
              border: "1px solid #2a475e",
              background: "#0b0f14",
              color: "white"
            }}
          />

          <button onClick={addManualGame} style={{ padding: "6px 10px" }}>
            Add
          </button>

          {manualGames.length > 0 && (
            <button onClick={clearManualGames} style={{ padding: "6px 10px" }}>
              Clear manual games
            </button>
          )}

          <label style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 10 }}>
            <input
              type="checkbox"
              checked={showManualMarkers}
              onChange={e => setShowManualMarkers(e.target.checked)}
            />
            Mark manual games
          </label>

          <div style={{ width: "100%", opacity: 0.7, fontSize: 12 }}>
            Find AppIDs here:{" "}
            <a
              href="https://steamdb.info/apps/"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#8ab4f8" }}
            >
              steamdb.info/apps
            </a>
          </div>

          {manualGames.length > 0 && (
            <div
              style={{
                width: "100%",
                marginTop: 6,
                fontSize: 13,
                opacity: 0.85,
              }}
            >
              {manualGames.map((m) => (
                <div
                  key={m.appid}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <span>
                    {m.name || `App ${m.appid}`} ({m.appid}) — {m.hours}h
                  </span>
                  <button
                    onClick={() => removeManualGame(m.appid)}
                    style={{ padding: "2px 6px", fontSize: 12 }}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          )}

        </div>

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
              Layout:
              <select
                value={layoutMode}
                onChange={e => setLayoutMode(e.target.value as any)}
              >
                <option value="scatter">Blob / Scatter</option>
                <option value="packed">Packed</option>
              </select>
            </label>

            <button
              onClick={() => setShuffleSeed(s => s + 1)}
              disabled={layoutMode !== "scatter"}
              style={{ padding: "6px 10px" }}
              title="Shuffle blob layout"
            >
              Shuffle
            </button>


            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={showHoursLabels}
                onChange={e => setShowHoursLabels(e.target.checked)}
              />
              Show hours on bubbles
            </label>

            {hiddenGamesList.length > 0 && (
              <>
                <select
                  value={selectedHiddenAppid}
                  onChange={e =>
                    setSelectedHiddenAppid(
                      e.target.value === "" ? "" : Number(e.target.value)
                    )
                  }
                  style={{
                    padding: 6,
                    borderRadius: 6,
                    border: "1px solid #2a475e",
                    background: "#0b0f14",
                    color: "white",
                    minWidth: 220
                  }}
                >
                  <option value="">Hidden games...</option>
                  {hiddenGamesList.map(g => (
                    <option key={g.appid} value={g.appid}>
                      {g.name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => {
                    if (selectedHiddenAppid !== "") {
                      toggleHide(selectedHiddenAppid);
                      setSelectedHiddenAppid("");
                    }
                  }}
                  disabled={selectedHiddenAppid === ""}
                  style={{ padding: "6px 10px" }}
                >
                  Unhide
                </button>

                <button
                  onClick={clearHidden}
                  style={{ padding: "6px 10px" }}
                >
                  Clear hidden ({hiddenGamesList.length})
                </button>
              </>
            )}

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

        {games.length > 0 && (
          <div style={{ opacity: 0.65, fontSize: 13, marginBottom: 6 }}>
            Tip: Right-click or Shift-click a bubble to hide it.
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {selection.length > 0 && (
          <BubbleChart
            games={selection}
            searchTerm={searchTerm}
            layoutMode={layoutMode}
            shuffleSeed={shuffleSeed}
            showHoursLabels={showHoursLabels}
            showManualMarkers={showManualMarkers}
            onToggleHide={toggleHide}
          />
        )}
      </div>
    </div>
  );
}
