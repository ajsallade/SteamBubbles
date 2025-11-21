import React, { useEffect, useState } from "react";
import BubbleChart from "./BubbleChart";

export default function App() {
  const [me, setMe] = useState<any>(null);
  const [games, setGames] = useState<any[]>([]);
  const [error, setError] = useState("");

  // check login state on load
  useEffect(() => {
    fetch("http://localhost:5174/api/me", { credentials: "include" })
      .then(r => r.json())
      .then(setMe)
      .catch(() => setMe({ loggedIn: false }));
  }, []);

  async function loadMyGames() {
    setError("");
    const r = await fetch("http://localhost:5174/api/owned-games", {
      credentials: "include"
    });
    const data = await r.json();
    if (data?.response?.games) setGames(data.response.games);
    else setError("No games returned (profile private?)");
  }

  return (
    <div style={{ color: "white", fontFamily: "system-ui", padding: 16 }}>
      <h1>Steam Bubbles</h1>

      {!me?.loggedIn ? (
        <a href="http://localhost:5174/auth/steam">
          <button style={{ padding: 10, marginBottom: 12 }}>
            Sign in with Steam
          </button>
        </a>
      ) : (
        <div style={{ marginBottom: 12 }}>
          Logged in as: {me.user.displayName}
          <button onClick={loadMyGames} style={{ marginLeft: 10, padding: 8 }}>
            Load my games
          </button>
        </div>
      )}

      {error && <p style={{ color: "salmon" }}>{error}</p>}
      {games.length > 0 && <BubbleChart games={games} />}
    </div>
  );
}
