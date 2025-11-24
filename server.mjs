import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import SteamStrategyPkg from "passport-steam";

const SteamStrategy = SteamStrategyPkg.Strategy;

const app = express();

//env
const BACKEND_URL =
  process.env.BACKEND_URL || "https://steambubbles.onrender.com";

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:5173";

const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || FRONTEND_URL;

const STEAM_API_KEY =
  process.env.STEAM_API_KEY || process.env.STEAM_KEY; // allow old name too

const STEAM_RETURN_URL =
  process.env.STEAM_RETURN_URL || `${BACKEND_URL}/auth/steam/return`;

const STEAM_REALM =
  process.env.STEAM_REALM || `${BACKEND_URL}/`;

const isProd = process.env.NODE_ENV === "production";

//middleware
app.set("trust proxy", 1);

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

//steam
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(
  new SteamStrategy(
    {
      returnURL: STEAM_RETURN_URL,
      realm: STEAM_REALM,
      apiKey: STEAM_API_KEY,
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

//helpers
function isSteamId64(x) {
  return typeof x === "string" && /^[0-9]{17}$/.test(x);
}

// links
function normalizeSteamInput(input) {
  if (!input || typeof input !== "string") return input;
  const s = input.trim();

  try {
    const u = new URL(s);
    if (u.hostname.includes("steamcommunity.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      // https://steamcommunity.com/profiles/<steamid64>/
      if (parts[0] === "profiles" && parts[1]) return parts[1];
      // https://steamcommunity.com/id/<vanityname>/
      if (parts[0] === "id" && parts[1]) return parts[1];
    }
  } catch {
    
  }

  return s.replace(/\/+$/, "");
}

async function resolveVanityToSteamId(vanity) {
  const url =
    `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/` +
    `?key=${STEAM_API_KEY}` +
    `&vanityurl=${encodeURIComponent(vanity)}`;

  const r = await fetch(url);
  const j = await r.json();
  if (j?.response?.success === 1) return j.response.steamid;
  return null;
}

//basic
app.get("/", (req, res) => {
  res.send("SteamBubbles backend is running. Try /api/me or /api/owned-games");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

//auth
app.get("/auth/steam", passport.authenticate("steam"));

app.get(
  "/auth/steam/return",
  passport.authenticate("steam", { failureRedirect: FRONTEND_URL }),
  (req, res) => res.redirect(FRONTEND_URL)
);

app.get("/auth/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => res.redirect(FRONTEND_URL));
  });
});

//Api

app.get("/api/me", (req, res) => {
  if (!req.user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, user: req.user });
});

// Manual input
app.get("/api/owned-games", async (req, res) => {
  try {
    let steamid =
      req.query.steamid ||
      req.session?.manualSteamId ||
      req.user?.steamid;

    if (!steamid) {
      return res.status(400).json({ error: "No steamid provided." });
    }

    steamid = normalizeSteamInput(steamid);

    
    if (!isSteamId64(steamid)) {
      const resolved = await resolveVanityToSteamId(steamid);
      if (!resolved) {
        return res.status(400).json({
          error: "Could not resolve vanity name. Try SteamID64."
        });
      }
      steamid = resolved;
    }

    
    if (req.query.steamid) {
      req.session.manualSteamId = steamid;
    }

    const url =
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/` +
      `?key=${STEAM_API_KEY}` +
      `&steamid=${steamid}` +
      `&include_appinfo=1` +
      `&include_played_free_games=1` +
      `&format=json`;

    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch owned games" });
  }
});


app.post("/api/appdetails-batch", async (req, res) => {
  try {
    const appids = req.body?.appids;
    if (!Array.isArray(appids) || appids.length === 0) {
      return res.status(400).json({ error: "appids must be a non-empty array" });
    }

    const out = {};
    const limited = appids.slice(0, 250);

    await Promise.all(
      limited.map(async (appid) => {
        try {
          const r = await fetch(
            `https://store.steampowered.com/api/appdetails?appids=${appid}`
          );
          const j = await r.json();
          const data = j?.[appid]?.data;

          if (!data) return;

          out[appid] = {
            name: data.name,
            genres: (data.genres || []).map((g) => g.description),
            header_image: data.header_image,
          };
        } catch {
          // ignore single failures
        }
      })
    );

    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch app details" });
  }
});

//start server
const PORT = process.env.PORT || 5174;
app.listen(PORT, () => console.log("API on port", PORT));
