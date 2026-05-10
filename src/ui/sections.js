// SECTIONS - UI configuration. Pure data: array of panels, each with
// a title and a list of blocks. Each block declares a `type` that the
// builder registry in builders.js knows how to render. To add, remove,
// or reorder panels, edit this file; no other module needs to change.
//
// Block ordering convention: every "data block" (table, chart, image
// grid, panel) is preceded by a `heading` block so each chunk of
// content is labelled. The only exceptions are sections whose section
// title (h2) already covers the single primary block (HF, VHF band
// tables) and the alert blocks, which speak for themselves.
//
// CREDITS drives the footer attribution block. Each entry carries a
// label, an upstream URL, and a short note (license / nature of use).
// See /licenses.html for the authoritative policy text.

export const SECTIONS = [

  // -------------------------------------------------------------
  //  0. ABOUT, short intro for first-time visitors. Static copy,
  //  no live data. Sits at the very top of the page above the
  //  alerts strip and band tables. Hosts the methodology-paper
  //  link inline (previously in the credits-lead).
  // -------------------------------------------------------------
  {
    id: "about",
    title: "About",
    blocks: [
      {
        type: "intro",
        paragraphs: [
          "Amateur radio operators planning an operating session need to answer a deceptively simple question: which bands are open right now, and how reliably for the station they are actually using? Existing tools serve fragments of the problem. VOACAP delivers rigorous P.533 predictions but runs as a batch tool with no real-time inputs. Solar-condition tables key on Kp and SFI without path geometry. MUF maps draw observed contours without an SNR context. ionocast was built to occupy the intersection: real-time, physics-grounded, station-aware, and privacy-preserving.",
          "The tool runs entirely in the browser. Live solar, geomagnetic, and ionospheric measurements are passed through an ITU-R P.533 link budget and mapped onto an ITU-R P.842 reliability bucket: excellent, good, fair, poor, or closed. The verdict reflects the operator's own station, not a generic reference receiver, and every refresh rederives the budget against the most recent observations.",
          "Every output is the deterministic result of explicit physical equations applied to the published data feeds. There are no machine-learning components anywhere in the prediction path. Validation is honest about its scope: the offline harness is intended for regression detection during model development, not as a production-grade reliability claim. ionocast is free, non-commercial, and runs without advertising or third-party telemetry.",
          {
            parts: [
              "The complete model is documented in the ",
              { url: "/paper/ionocast-methodology.pdf", text: "ionocast methodology paper" },
              ", including every constant, equation, calibration anchor, and known limitation."
            ]
          },
          "Development is AI-assisted: the codebase and calibration sweeps are produced in extensive collaboration with large language models. All physics, data sources, and validation methodology are operator-reviewed; AI accelerates implementation without replacing the domain judgment that anchors the model's calibration and limitations."
        ]
      }
    ]
  },

  // -------------------------------------------------------------
  //  1. ACTIVE ALERTS, flares, storms, blackouts in flight
  //  Per-band detail moved into HF and VHF sections below; this
  //  section renders silently when nothing is wrong, surfaces an
  //  alert strip at the top of the page when something is off.
  // -------------------------------------------------------------
  {
    id: "alerts",
    title: "Active Alerts",
    blocks: [
      // Single block now: alert-lines renders SWPC bulletins and the
      // model-derived soft alerts in one wrap so the inter-stack gap
      // matches the per-stack 8 px alert-line spacing instead of the
      // 22 px section-block rhythm.
      { type: "alert-lines", url: "/api/swpc-alerts",
        interp: "Two streams: SWPC's official bulletins (top 4 most recent, lagged hours behind real events) plus model-derived live alerts triggered by current conditions. Pill color carries severity (INFO gray, WATCH yellow, ALERT red, EXTREME deep red); click the pill for the tier definition. Body text describes the topic, underlined phrases (R-scale flares, G/S-scale events, Bz, Dst, D-RAP, HSS, forecast σ, storm main/recovery) are individually clickable for topic-specific detail." }
    ]
  },

  // -------------------------------------------------------------
  //  2. HF, per-band predicted verdict + measured activity
  // -------------------------------------------------------------
  {
    id: "hf",
    title: "HF",
    blocks: [
      {
        type: "band-table",
        source: "bands-hf",
        scope: "hf",
        interp: "Per-band predicted tier, SNR margin, propagation mode, and best destination from the physics model, alongside live WSPR median SNR + spot counts (last 60 min), the f/MUF ratio on the best path, and modeled D-region absorption at the band frequency."
      }
    ]
  },

  // -------------------------------------------------------------
  //  3. VHF, per-band predicted verdict + measured activity
  // -------------------------------------------------------------
  {
    id: "vhf",
    title: "VHF",
    blocks: [
      {
        type: "band-table",
        source: "bands-vhf",
        scope: "vhf",
        interp: "Per-band predicted tier, SNR margin, propagation mode (Es / aurora-E / meteor scatter), and best destination from the physics model, alongside foEs from the nearest digisonde, the Es-MUF / band ratio, OVATION aurora hemispheric power, and tropospheric refractivity gradient. Above 2 m is line-of-sight / tropospheric only."
      },
      // Hepburn-class tropo forecast heatmap.  GFS-derived, refreshed
      // 4× daily on the GFS cycle (00 / 06 / 12 / 18 z + 5 h).  Lives
      // inside the VHF section since the band-table column for tropo
      // dN/dh is the per-station summary and this is the global view.
      { type: "tropo-map" }
    ]
  },

  // -------------------------------------------------------------
  //  4. UPCOMING DISRUPTIONS, 72-h to 27-day forecast
  //  Sits next to the HF and VHF tables so operators planning ahead
  //  see "what's coming" before drilling into ionospheric / solar
  //  drivers further down.
  // -------------------------------------------------------------
  {
    id: "outlook",
    title: "Upcoming Disruptions",
    blocks: [
      // Layout flows by time horizon: next 72 h -> currently brewing
      // -> long range -> always-on. The 27-day list and meteor list go
      // full-width so the long lists don't get squashed into half a
      // column.
      { type: "row", cols: [
        [
          { type: "heading", text: "R / S / G probability (next 72 h)" },
          { type: "prob-table", source: "swpc-3day-prob",
            interp: "SWPC 3-day probabilities for radio blackouts (R), radiation storms (S), and geomagnetic storms (G)." }
        ],
        [
          { type: "heading", text: "Kp forecast (3-hour periods)" },
          { type: "outlook-kp", source: "swpc-kp-forecast",
            interp: "Predicted Kp by 3-h period. Orange = G1 threshold (Kp 5); red = G2 (Kp 6)." }
        ]
      ]},

      // Two columns of two stacked panels each. Left column: CMEs +
      // meteor showers (both event-style lists). Right column: active
      // regions + 27-day outlook (both ongoing/forward-looking). The
      // 27-day list is the longest of the four; pairing it under
      // Active solar regions means the empty space below the shorter
      // panels collapses into the same column-bottom rather than
      // sprawling across an extra full row.
      { type: "row", cols: [
        [
          { type: "heading", text: "Earth-directed CMEs" },
          { type: "outlook-list", source: "donki-cme",
            interp: "Earth-directed coronal mass ejections from the NASA DONKI catalog with predicted arrival times." },
          { type: "caption", text: "Preliminary NASA CCMC DONKI research data, not for operational use." },
          { type: "heading", text: "Active meteor showers" },
          { type: "outlook-list", source: "imo-showers",
            interp: "Currently active meteor showers from the IMO calendar; relevant for 6 m/2 m meteor scatter." }
        ],
        [
          { type: "heading", text: "Active solar regions" },
          { type: "outlook-list", source: "swpc-regions",
            interp: "Top active regions by X-class flare probability from the SWPC daily report." },
          { type: "heading", text: "27-day SFI / Ap outlook" },
          { type: "outlook-list", source: "ises-27day",
            interp: "Predicted daily F10.7 (SFI) and planetary Ap for the next 27 days from the ISES weekly outlook. Use to anticipate when conditions will favor the upper bands and when geomagnetic disturbance is expected." }
        ]
      ]}
    ]
  },

  // -------------------------------------------------------------
  //  5. IONOSPHERE, what HF actually depends on
  // -------------------------------------------------------------
  {
    id: "iono",
    title: "Ionosphere",
    blocks: [
      { type: "row", cols: [
        [
          { type: "heading", text: "Local ionosphere (digisonde + GNSS TEC)" },
          { type: "iono-panels",
            interp: "Direct ionospheric measurements: nearest GIRO digisonde (foF2/foEs/hmF2), GNSS-derived total electron content, and 30 MHz cosmic-noise absorption." }
        ],
        [
          { type: "heading", text: "Reference paths from QTH" },
          { type: "path-table", source: "paths",
            interp: "MUF on a radial basket of paths sampled relative to QTH: 12 bearings × 6 distance rings (2.5 / 4 / 6 / 9 / 12 / 16 Mm), 72 paths total. The shortest ring sits at the geometric minimum for a single F2 hop; below that propagation is NVIS-mode (handled separately) rather than F2-hop. The longest-viable ring per bearing is shown here for readability; the band-table's per-band best-path selector consumes the full basket. Midpoint MUF from the kc2g IRI-assimilated grid. f/MUF ≤ 0.85 = stable (FOT), ≤ 1.0 = marginal, > 1.0 = no F2 support." }
        ]
      ]},

      { type: "heading", text: "Global ionospheric maps" },
      { type: "grid", layout: "grid",
        images: [
          { url: "https://prop.kc2g.com/renders/current/fof2-normal-now.svg",
            alt: "foF2 critical frequency map", caption: "foF2 critical frequency, real-time ionospheric density (kc2g)",
            interp: "Maximum frequency reflecting straight up. NVIS operators: use frequencies below this value. MUF per-path is in the table above." },
          { url: "https://services.swpc.noaa.gov/images/animations/glotec/100asm_urt/latest.png",
            alt: "GloTEC total electron content", caption: "GloTEC, global total electron content (NOAA SWPC)",
            interp: "Higher TEC = denser ionosphere = higher MUF. Low TEC regions have poor HF propagation." }
        ]
      }
    ]
  },

  // -------------------------------------------------------------
  //  6. GEOMAGNETIC -- Earth's magnetic state, downstream of the Sun.
  //  Solar wind at L1 lives in the Solar section now since it is a
  //  sunward observation; this section is strictly geomagnetic.
  // -------------------------------------------------------------
  {
    id: "spacewx",
    title: "Geomagnetic",
    blocks: [
      { type: "row", cols: [
        [
          { type: "heading", text: "Geomagnetic indices" },
          { type: "drivers-row", group: "geomag",
            interp: "Real-time planetary geomagnetic state. Kp is the standard 3-h index; Hp30/Sym-H/AE catch substorms that Kp averages out." },
          { type: "caption", text: "Dst: WDC Kyoto, quicklook / provisional, non-commercial." }
        ],
        [
          { type: "heading", text: "Kp trend (last 7 days)" },
          { type: "kp-trend",
            url: "/api/swpc-kpap",
            interp: "Planetary Kp index, last 7 days." },
          { type: "heading", text: "D-region absorption (D-RAP)" },
          { type: "grid", layout: "grid",
            images: [
              { url: "https://services.swpc.noaa.gov/images/animations/d-rap/global/latest.png",
                alt: "D-RAP", caption: "D-RAP, D-region HF absorption (global)",
                interp: "Red/orange = HF signals absorbed in the D-layer before reaching the F-layer. Avoid those paths." }
            ]
          }
        ]
      ]},

      { type: "heading", text: "Aurora" },
      { type: "grid", layout: "grid",
        images: [
          { url: "https://services.swpc.noaa.gov/images/animations/ovation/north/latest.jpg",
            alt: "aurora north", caption: "OVATION aurora forecast (Northern hemisphere)",
            interp: "Larger oval = HF disruption on polar paths; VHF aurora propagation possible at K≥5." },
          { url: "https://services.swpc.noaa.gov/images/animations/ovation/south/latest.jpg",
            alt: "aurora south", caption: "OVATION aurora forecast (Southern hemisphere)",
            interp: "Same model, southern hemisphere. Aurora HP scalar is in the VHF table; CME arrivals are in the Outlook section." }
        ]
      }
    ]
  },

  // -------------------------------------------------------------
  //  7. SOLAR, the ultimate driver, furthest from your antenna
  // -------------------------------------------------------------
  {
    id: "solar",
    title: "Solar",
    blocks: [
      // Two-column row pairing the canonical "what the Sun is doing
      // right now" panels: indices (radiation / X-ray class / proton
      // flux numbers) on the left, DSCOVR/ACE solar-wind delivery
      // (Bz / Vsw / density) on the right. Both are sunward state
      // observations; pairing them keeps the section compact.
      { type: "row", cols: [
        [
          { type: "heading", text: "Solar indices" },
          { type: "drivers-row", group: "solar",
            interp: "Solar radio flux, EUV, and X-ray output. F10.7 is the canonical IRI ionospheric driver; X-ray flux drives D-region absorption; protons drive polar-cap absorption." }
        ],
        [
          { type: "heading", text: "Solar wind at L1 (DSCOVR / ACE)" },
          { type: "dscovr",
            magUrl:    "/api/swpc-bz",
            plasmaUrl: "/api/swpc-plasma",
            interp:    "Real-time solar wind at L1 (~1 hour upstream of Earth). Southward Bz (negative) is the empirical storm trigger; sustained > 500 km/s solar-wind speed signals a coronal-hole stream." }
        ]
      ]},

      { type: "heading", text: "Solar imagery (SDO)" },
      {
        type: "grid", layout: "grid3",
        images: [
          { url: "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIF.jpg",
            alt: "SDO HMI visible", caption: "HMI visible, sunspots (white light)",
            interp: "Dark spots = sunspots = active regions. More spots generally mean better HF." },
          { url: "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg",
            alt: "SDO 193 Å", caption: "193 Å, corona & coronal holes",
            interp: "Dark patches are coronal holes - fast solar wind that disturbs HF in 2-3 days." },
          { url: "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0304.jpg",
            alt: "SDO 304 Å", caption: "304 Å, chromosphere & prominences",
            interp: "Bright arcs are filaments/prominences. Erupting ones can launch CMEs toward Earth." }
        ]
      },
      { type: "caption", text: "Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams." }
    ]
  },

  // -------------------------------------------------------------
  //  8. CREDITS, required attribution for the upstream data sources.
  //  Kept on-page because several licenses (GIRO CC-BY-NC-SA, SILSO
  //  CC-BY-NC, GFZ CC-BY, WDC Kyoto, NASA/SDO) require
  //  visible acknowledgement where their data is displayed. The full
  //  policy (rate limits, exact required strings, non-commercial
  //  clauses) lives in /licenses.html.
  // -------------------------------------------------------------
  {
    id: "links",
    title: "Credits",
    blocks: [
      { type: "credits-lead" },
      {
        // Heading omitted: the section's own h2 ("Credits") makes a
        // separate "Data sources" subhead redundant when the section
        // contains a single link group.
        type: "link-groups",
        groups: [
          { credits: true }
        ]
      }
    ]
  }
];

export const CREDITS = [
  { label: "NOAA / SWPC",                  url: "https://www.swpc.noaa.gov/",                       note: "space weather products (public domain)" },
  { label: "NASA CCMC DONKI",              url: "https://kauai.ccmc.gsfc.nasa.gov/DONKI/",          note: "CME + HSS catalogs, preliminary research, not operational" },
  { label: "Andrew Rodland (KC2G)",        url: "https://prop.kc2g.com/",                           note: "real-time ionospheric map" },
  { label: "GIRO / Lowell Digisonde",      url: "http://giro.uml.edu/",                             note: "ionograms, CC-BY-NC-SA 4.0; requires per-station operator credit" },
  { label: "wspr.live",                    url: "https://wspr.live/",                               note: "WSPR spot database (non-commercial); data from wsprnet.org" },
  { label: "WDC Kyoto",                    url: "https://wdc.kugi.kyoto-u.ac.jp/",                  note: "Dst index, quicklook / provisional (non-commercial)" },
  { label: "SIDC SILSO",                   url: "https://www.sidc.be/SILSO/",                       note: "sunspot number, Royal Observatory of Belgium (DOI 10.24414/qnza-ac80, CC-BY-NC 4.0)" },
  { label: "GFZ Potsdam",                  url: "https://kp.gfz.de/",                               note: "Kp / Hp30 (DOI 10.5880/Kp.0001, CC-BY 4.0)" },
  { label: "University of Wyoming",        url: "https://weather.uwyo.edu/upperair/sounding.html",  note: "radiosonde soundings, Dept. of Atmospheric Science" },
  { label: "NASA / SDO",                   url: "https://sdo.gsfc.nasa.gov/",                       note: "courtesy of NASA/SDO and the AIA, EVE, and HMI science teams" },
  { label: "International Meteor Organization",
                                           url: "https://www.imo.net/",                             note: "meteor-shower calendar" },
  { label: "NOAA NCEP / NOMADS",           url: "https://nomads.ncep.noaa.gov/",                    note: "GFS 0.25° forecast (public domain) for the global tropospheric ducting heatmap" },
  { label: "Natural Earth",                url: "https://www.naturalearthdata.com/",                note: "coastline / country / state-province outlines (public domain)" },
  { label: "MapLibre GL JS",               url: "https://maplibre.org/",                            note: "WebGL pan-zoom renderer (BSD-3-Clause), vendored locally" },
  { label: "d3-contour, d3-array",         url: "https://d3js.org/",                                note: "marching-squares contour generation (ISC), vendored locally" },
];
