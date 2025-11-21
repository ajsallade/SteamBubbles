import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import passportSteam from "passport-steam";
import "dotenv/config";

const SteamStrategy = passportSteam.Strategy;
const app = express();

app.use(express.json());

// CORS for Vite + cookies
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);

// Sessions
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret",
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: "lax", secure: false },
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Steam OpenID
passport.use(
  new SteamStrategy(
    {
      returnURL: `${process.env.BACKEND_URL}/auth/steam/return`,
      realm: `${process.env.BACKEND_URL}/`,
      apiKey: process.env.STEAM_KEY,
    },
    function verify(identifier, profile, done) {
      const user = {
        steamid: profile.id,
        displayName: profile.displayName,
        avatar: profile.photos?.[2]?.value || profile.photos?.[0]?.value,
      };
      return done(null, user);
    }
  )
);

app.get("/auth/steam", passport.authenticate("steam"));

app.get(
  "/auth/steam/return",
  passport.authenticate("steam", { failureRedirect: process.env.FRONTEND_URL }),
  (req, res) => res.redirect(process.env.FRONTEND_URL)
);

// Who am I
app.get("/api/me", (req, res) => {
  if (!req.user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, user: req.user });
});

// Owned games (uses logged-in SteamID64 by default)
app.get("/api/owned-games", async (req, res) => {
  const steamid = req.query.steamid || req.user?.steamid;
  if (!steamid)
    return res.status(400).json({ error: "steamid required or login first" });

  const url =
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/` +
    `?key=${process.env.STEAM_KEY}` +
    `&steamid=${steamid}` +
    `&include_appinfo=1&include_played_free_games=1&format=json`;

  const r = await fetch(url);
  const data = await r.json();
  res.json(data);
});

/* ---------------------------
   Store appdetails + caching
   --------------------------- */

// Simple memory cache so we don't spam Steam store
const detailsCache = new Map(); // appid -> { data, expires }
const TTL_MS = 1000 * 60 * 60 * 24; // 24h

async function getAppDetails(appid) {
  const cached = detailsCache.get(appid);
  if (cached && cached.expires > Date.now()) return cached.data;

  // Unofficial Steam store endpoint that returns genres/categories
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}`;
  const r = await fetch(url);
  const raw = await r.json();

  const entry = raw?.[appid];
  const data = entry?.success ? entry.data : null;

  detailsCache.set(appid, { data, expires: Date.now() + TTL_MS });
  return data;
}

// Batch endpoint to resolve genres for many appids
app.post("/api/appdetails-batch", async (req, res) => {
  const { appids } = req.body;
  if (!Array.isArray(appids))
    return res.status(400).json({ error: "appids must be an array" });

  const out = {};
  for (const id of appids.slice(0, 500)) {
    const d = await getAppDetails(id);
    out[id] = d
      ? {
          genres: d.genres?.map(g => g.description) ?? [],
          categories: d.categories?.map(c => c.description) ?? [],
        }
      : { genres: [], categories: [] };
  }
  res.json(out);
});

app.listen(5174, () => console.log("API on http://localhost:5174"));
